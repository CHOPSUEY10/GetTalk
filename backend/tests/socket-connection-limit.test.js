import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as createClient } from '../../frontend/node_modules/socket.io-client/build/esm/index.js';

import app from '../app.js';
import env from '../src/config/env.js';
import pool, { query } from '../src/config/database.js';
import { connectRedis, closeRedis } from '../src/config/redis.js';
import { createSocketServer } from '../src/socket/index.js';
import {
  socketConnectionLimit,
  MAX_CONCURRENT_SOCKETS,
} from '../src/socket/middleware.js';
import * as rooms from '../src/socket/rooms.js';
import { MAX_CONCURRENT_SOCKETS_EXCEEDED } from '../src/errors/error-codes.js';

let server;
let io;
let baseUrl;
let dbAvailable = true;

before(async () => {
  try {
    await query('SELECT 1');
  } catch {
    dbAvailable = false;
  }

  server = http.createServer(app);
  io = createSocketServer(server, env);
  app.set('io', io);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (io) {
    await new Promise((resolve) => io.close(resolve));
  } else if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closeRedis();
  await pool.end();
});

async function registerUser(label) {
  try {
    const redis = await connectRedis();
    const keys = await redis.keys('ratelimit:auth:register:*');
    if (keys.length > 0) await redis.del(keys);
  } catch {
    // Redis optional
  }

  const suffix = `sock${Date.now()}${Math.floor(Math.random() * 1_000_000)}${label}`;
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: suffix,
      email: `${suffix}@example.com`,
      password: 'correct-horse-battery',
    }),
  });

  if (res.status !== 201) {
    throw new Error(`register ${label} failed: ${res.status} ${await res.text()}`);
  }

  const { user } = await res.json();
  const [rawCookie] = res.headers.getSetCookie();
  const cookie = rawCookie ? rawCookie.split(';')[0] : '';
  return { user, cookie };
}

/**
 * Helper to create a Socket.IO client authenticated with a session cookie
 * and wait for either `connect` or `connect_error`.
 *
 * @param {string} cookie
 * @returns {Promise<{ client: import('socket.io-client').Socket, connected: boolean, error: any }>}
 */
function connectSocketClient(cookie) {
  return new Promise((resolve) => {
    const client = createClient(baseUrl, {
      autoConnect: false,
      reconnection: false,
      transports: ['websocket'],
      extraHeaders: {
        Cookie: cookie,
      },
    });

    const onConnect = () => {
      cleanupListeners();
      resolve({ client, connected: true, error: null });
    };

    const onConnectError = (err) => {
      cleanupListeners();
      resolve({ client, connected: false, error: err });
    };

    const cleanupListeners = () => {
      client.off('connect', onConnect);
      client.off('connect_error', onConnectError);
    };

    client.on('connect', onConnect);
    client.on('connect_error', onConnectError);
    client.connect();
  });
}

/**
 * Helper to disconnect a Socket.IO client and wait until the server room updates.
 * @param {import('socket.io-client').Socket} client
 */
function disconnectSocketClient(client) {
  return new Promise((resolve) => {
    if (!client || !client.connected) {
      client?.disconnect();
      resolve();
      return;
    }
    client.once('disconnect', () => {
      setTimeout(resolve, 25);
    });
    client.disconnect();
  });
}

describe('Socket.IO Per-Account Concurrent Connection Limit (Rule #18)', () => {
  test('unit: socketConnectionLimit middleware allows 3 sockets, rejects 4th with MAX_CONCURRENT_SOCKETS_EXCEEDED, and isolates tenants', async () => {
    assert.equal(MAX_CONCURRENT_SOCKETS, 3);

    /** @type {Map<string, Set<string>>} */
    const roomMap = new Map();
    const mockAdapter = { rooms: roomMap };

    function makeMockSocket(id, userId) {
      return {
        id,
        data: { user: { id: userId, username: `user_${userId}` } },
        handshake: { address: '127.0.0.1' },
        adapter: mockAdapter,
        join(room) {
          if (!roomMap.has(room)) roomMap.set(room, new Set());
          roomMap.get(room).add(id);
        },
        leave(room) {
          roomMap.get(room)?.delete(id);
        },
      };
    }

    function runMiddleware(socket) {
      return new Promise((resolve) => {
        socketConnectionLimit(socket, (err) => resolve(err || null));
      });
    }

    // 1. First 3 connections for user-A succeed
    const s1 = makeMockSocket('s1', '00000000-0000-0000-0000-000000000001');
    const s2 = makeMockSocket('s2', '00000000-0000-0000-0000-000000000001');
    const s3 = makeMockSocket('s3', '00000000-0000-0000-0000-000000000001');

    assert.equal(await runMiddleware(s1), null);
    assert.equal(await runMiddleware(s2), null);
    assert.equal(await runMiddleware(s3), null);
    assert.equal(
      roomMap.get(rooms.userRoom('00000000-0000-0000-0000-000000000001'))?.size,
      3
    );

    // 2. 4th connection for user-A is rejected with MAX_CONCURRENT_SOCKETS_EXCEEDED
    const s4 = makeMockSocket('s4', '00000000-0000-0000-0000-000000000001');
    const err4 = await runMiddleware(s4);
    assert.ok(err4 instanceof Error);
    assert.equal(err4.data?.code, MAX_CONCURRENT_SOCKETS_EXCEEDED);

    // 3. Different user (user-B) is unaffected and can connect
    const sb1 = makeMockSocket('sb1', '00000000-0000-0000-0000-000000000002');
    assert.equal(await runMiddleware(sb1), null);

    // 4. When s1 disconnects (leaves room), user-A can connect a new socket s5
    s1.leave(rooms.userRoom('00000000-0000-0000-0000-000000000001'));
    const s5 = makeMockSocket('s5', '00000000-0000-0000-0000-000000000001');
    assert.equal(await runMiddleware(s5), null);
  });

  test('integration: enforces max 3 concurrent WebSocket connections per user, frees slot on disconnect, and isolates other users', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL is not reachable');

    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    /** @type {import('socket.io-client').Socket[]} */
    const activeClients = [];

    try {
      // 1. 3 simultaneous connections from Alice succeed (connected: true)
      const [c1, c2, c3] = await Promise.all([
        connectSocketClient(alice.cookie),
        connectSocketClient(alice.cookie),
        connectSocketClient(alice.cookie),
      ]);
      activeClients.push(c1.client, c2.client, c3.client);

      assert.equal(c1.connected, true);
      assert.equal(c2.connected, true);
      assert.equal(c3.connected, true);
      assert.equal(c1.client.connected, true);
      assert.equal(c2.client.connected, true);
      assert.equal(c3.client.connected, true);

      const aliceRoom = io.sockets.adapter.rooms.get(rooms.userRoom(alice.user.id));
      assert.equal(aliceRoom?.size, 3);

      // 2. 4th connection from Alice is rejected with MAX_CONCURRENT_SOCKETS_EXCEEDED
      const c4 = await connectSocketClient(alice.cookie);
      activeClients.push(c4.client);

      assert.equal(c4.connected, false);
      assert.equal(c4.client.connected, false);
      assert.ok(c4.error);
      assert.equal(c4.error.data?.code, MAX_CONCURRENT_SOCKETS_EXCEEDED);

      // Verify SecurityEvent was recorded in database
      const secEvents = await query(
        `SELECT event_type, metadata FROM security_events WHERE user_id = $1 AND event_type = $2`,
        [alice.user.id, MAX_CONCURRENT_SOCKETS_EXCEEDED]
      );
      assert.ok(secEvents.rowCount >= 1);

      // 3. Another user (Bob) is NOT affected by Alice's full quota (tenant isolation)
      const [b1, b2, b3] = await Promise.all([
        connectSocketClient(bob.cookie),
        connectSocketClient(bob.cookie),
        connectSocketClient(bob.cookie),
      ]);
      activeClients.push(b1.client, b2.client, b3.client);

      assert.equal(b1.connected, true);
      assert.equal(b2.connected, true);
      assert.equal(b3.connected, true);

      // 4. When one of Alice's 3 connections disconnects, the next connection from Alice succeeds
      await disconnectSocketClient(c2.client);

      const aliceRoomAfterDisconnect = io.sockets.adapter.rooms.get(
        rooms.userRoom(alice.user.id)
      );
      assert.equal(aliceRoomAfterDisconnect?.size, 2);

      const c5 = await connectSocketClient(alice.cookie);
      activeClients.push(c5.client);

      assert.equal(c5.connected, true);
      assert.equal(c5.client.connected, true);
      assert.equal(c5.error, null);
      assert.equal(
        io.sockets.adapter.rooms.get(rooms.userRoom(alice.user.id))?.size,
        3
      );
    } finally {
      for (const client of activeClients) {
        try {
          client.disconnect();
        } catch {
          // ignore
        }
      }
      await query('DELETE FROM security_events WHERE user_id = ANY($1::uuid[])', [
        [alice.user.id, bob.user.id],
      ]);
      await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [alice.user.id, bob.user.id],
      ]);
    }
  });
});
