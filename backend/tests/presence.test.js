import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { io as createSocketClient } from '../../frontend/node_modules/socket.io-client/build/esm/index.js';

import { connectRedis, closeRedis } from '../src/config/redis.js';
import {
  PRESENCE_TTL_MS,
  PRESENCE_RETENTION_SECONDS,
  LAST_SEEN_FIELD,
  presenceKey,
  socketField,
  markSocketActive,
  heartbeatSocket,
  markSocketInactive,
  clearUserActiveSockets,
  getPresence,
  getPresenceBatch,
  setLiveSocketChecker,
  pruneStalePresenceOnStartup,
} from '../src/services/presence.service.js';
import { registerHandlers } from '../src/socket/handlers.js';
import {
  handleSocketActive,
  handleSocketInactive,
  disconnectUserSessionSockets,
} from '../src/socket/presence.js';
import * as events from '../src/socket/events.js';
import * as rooms from '../src/socket/rooms.js';

describe('Redis Presence Service — Non-Redundant Metadata & Sync', () => {
  let redis = null;
  let redisAvailable = true;
  /** @type {string[]} */
  const createdKeys = [];

  before(async () => {
    try {
      redis = await connectRedis();
    } catch {
      redisAvailable = false;
    }
  });

  after(async () => {
    if (redisAvailable && redis && createdKeys.length > 0) {
      await redis.del(createdKeys).catch(() => {});
    }
    await closeRedis();
  });

  function trackUser() {
    const uid = `presence-test-${randomUUID()}`;
    createdKeys.push(presenceKey(uid));
    return uid;
  }

  test('stores non-redundant presence metadata in a single Redis hash per user with TTL', async (t) => {
    if (!redisAvailable) return t.skip('Redis is not reachable');

    const userId = trackUser();
    const key = presenceKey(userId);
    const t0 = 1_770_000_000_000;

    // 1. Mark active -> single hash key with ONLY `s:<socketId>` field (no redundant isOnline/status/count)
    const activeRes = await markSocketActive(userId, 'sock-1', { nowMs: t0 });
    assert.equal(activeRes.isOnline, true);
    assert.equal(activeRes.transitioned, true);
    assert.equal(activeRes.activeCount, 1);

    const hashWhileOnline = await redis.hGetAll(key);
    assert.deepEqual(Object.keys(hashWhileOnline), [socketField('sock-1')]);
    assert.equal(hashWhileOnline[socketField('sock-1')], String(t0));
    assert.equal(hashWhileOnline.isOnline, undefined);
    assert.equal(hashWhileOnline.status, undefined);
    assert.equal(hashWhileOnline.activeCount, undefined);

    // Key has bounded TTL
    const ttl = await redis.ttl(key);
    assert.ok(ttl > 0 && ttl <= PRESENCE_RETENTION_SECONDS);

    // Ensure no duplicate keys exist for this user
    const matchingKeys = await redis.keys(`*${userId}*`);
    assert.deepEqual(matchingKeys, [key]);

    // 2. Heartbeat refreshes timestamp without re-triggering transition
    const t1 = t0 + 20_000;
    const hbRes = await heartbeatSocket(userId, 'sock-1', { nowMs: t1 });
    assert.equal(hbRes.isOnline, true);
    assert.equal(hbRes.transitioned, false);
    assert.equal((await redis.hGetAll(key))[socketField('sock-1')], String(t1));

    // 3. Mark inactive -> removes `s:sock-1` and stores ONLY `lastSeenAt`
    const t2 = t0 + 30_000;
    const offRes = await markSocketInactive(userId, 'sock-1', { nowMs: t2 });
    assert.equal(offRes.isOnline, false);
    assert.equal(offRes.transitioned, true);
    assert.equal(offRes.activeCount, 0);
    assert.equal(offRes.lastSeenAt, new Date(t2).toISOString());

    const hashWhileOffline = await redis.hGetAll(key);
    assert.deepEqual(Object.keys(hashWhileOffline), [LAST_SEEN_FIELD]);
    assert.equal(hashWhileOffline[LAST_SEEN_FIELD], new Date(t2).toISOString());

    // 4. Duplicate inactive call is idempotent and preserves original lastSeenAt
    const dupRes = await markSocketInactive(userId, 'sock-1', { nowMs: t2 + 5_000 });
    assert.equal(dupRes.isOnline, false);
    assert.equal(dupRes.transitioned, false);
    assert.equal(dupRes.lastSeenAt, new Date(t2).toISOString());
  });

  test('handles multi-tab sockets accurately: stays online until the last active tab goes inactive', async (t) => {
    if (!redisAvailable) return t.skip('Redis is not reachable');

    const userId = trackUser();
    const t0 = 1_770_001_000_000;

    const first = await markSocketActive(userId, 'tab-1', { nowMs: t0 });
    assert.equal(first.isOnline, true);
    assert.equal(first.transitioned, true);
    assert.equal(first.activeCount, 1);

    const second = await markSocketActive(userId, 'tab-2', { nowMs: t0 + 1_000 });
    assert.equal(second.isOnline, true);
    assert.equal(second.transitioned, false);
    assert.equal(second.activeCount, 2);

    // Tab 1 hides -> user remains online via Tab 2
    const afterTab1Hide = await markSocketInactive(userId, 'tab-1', { nowMs: t0 + 5_000 });
    assert.equal(afterTab1Hide.isOnline, true);
    assert.equal(afterTab1Hide.transitioned, false);
    assert.equal(afterTab1Hide.activeCount, 1);

    const current = await getPresence(userId, { nowMs: t0 + 6_000 });
    assert.equal(current.isOnline, true);

    // Tab 2 hides -> user transitions offline and records lastSeenAt
    const tOffline = t0 + 10_000;
    const afterTab2Hide = await markSocketInactive(userId, 'tab-2', { nowMs: tOffline });
    assert.equal(afterTab2Hide.isOnline, false);
    assert.equal(afterTab2Hide.transitioned, true);
    assert.equal(afterTab2Hide.activeCount, 0);
    assert.equal(afterTab2Hide.lastSeenAt, new Date(tOffline).toISOString());

    const afterBoth = await getPresence(userId, { nowMs: tOffline + 1_000 });
    assert.equal(afterBoth.isOnline, false);
    assert.equal(afterBoth.lastSeenAt, new Date(tOffline).toISOString());
  });

  test('expires stale sockets when heartbeat stops (browser crash / network drop) and lazily prunes Redis', async (t) => {
    if (!redisAvailable) return t.skip('Redis is not reachable');

    const userId = trackUser();
    const key = presenceKey(userId);
    const tStart = 1_770_002_000_000;

    await markSocketActive(userId, 'crashed-sock', { nowMs: tStart });

    // Still online just before TTL expires
    const beforeExpiry = await getPresence(userId, { nowMs: tStart + PRESENCE_TTL_MS - 1_000 });
    assert.equal(beforeExpiry.isOnline, true);

    // Past TTL without heartbeat -> treated as offline with lastSeenAt = last heartbeat timestamp
    const afterExpiry = await getPresence(userId, { nowMs: tStart + PRESENCE_TTL_MS + 1_000 });
    assert.equal(afterExpiry.isOnline, false);
    assert.equal(afterExpiry.lastSeenAt, new Date(tStart).toISOString());

    // Wait briefly for lazy Redis cleanup to settle and verify stale socket field was removed
    await new Promise((r) => setTimeout(r, 40));
    const prunedHash = await redis.hGetAll(key);
    assert.equal(prunedHash[socketField('crashed-sock')], undefined);
    assert.equal(prunedHash[LAST_SEEN_FIELD], new Date(tStart).toISOString());
  });

  test('batch reads presence across online, offline, and cold-fallback users', async (t) => {
    if (!redisAvailable) return t.skip('Redis is not reachable');

    const onlineUser = trackUser();
    const offlineUser = trackUser();
    const coldUser = trackUser();
    const tNow = 1_770_003_000_000;

    await markSocketActive(onlineUser, 'sock-online', { nowMs: tNow });
    await markSocketActive(offlineUser, 'sock-offline', { nowMs: tNow - 10_000 });
    await markSocketInactive(offlineUser, 'sock-offline', { nowMs: tNow - 2_000 });

    const fallbackIso = new Date(tNow - 3_600_000).toISOString();
    const batch = await getPresenceBatch([onlineUser, offlineUser, coldUser, onlineUser], {
      nowMs: tNow,
      fallbackLastSeenMap: new Map([[coldUser, fallbackIso]]),
    });

    assert.equal(batch.size, 3);
    assert.equal(batch.get(onlineUser)?.isOnline, true);
    assert.equal(batch.get(offlineUser)?.isOnline, false);
    assert.equal(batch.get(offlineUser)?.lastSeenAt, new Date(tNow - 2_000).toISOString());
    assert.equal(batch.get(coldUser)?.isOnline, false);
    assert.equal(batch.get(coldUser)?.lastSeenAt, fallbackIso);

    // clearUserActiveSockets forces onlineUser offline
    const cleared = await clearUserActiveSockets(onlineUser, { nowMs: tNow + 500 });
    assert.equal(cleared.isOnline, false);
    assert.equal(cleared.transitioned, true);
    assert.equal(cleared.lastSeenAt, new Date(tNow + 500).toISOString());
  });

  test('Socket.IO presence helpers emit self-sync events and disconnect revoked session sockets immediately', async (t) => {
    if (!redisAvailable) return t.skip('Redis is not reachable');

    const userId = trackUser();
    /** @type {Array<{ room: string, event: string, payload: any }>} */
    const emitted = [];
    let disconnectedIds = [];

    const sock1 = {
      id: 'sock-sess-1',
      data: { user: { id: userId }, sessionId: 'sid-1' },
      request: { sessionID: 'sid-1' },
      disconnect() {
        disconnectedIds.push(this.id);
      },
    };
    const sock2 = {
      id: 'sock-sess-2',
      data: { user: { id: userId }, sessionId: 'sid-2' },
      request: { sessionID: 'sid-2' },
      disconnect() {
        disconnectedIds.push(this.id);
      },
    };

    const mockIo = {
      sockets: {
        adapter: {
          rooms: new Map([[rooms.userRoom(userId), new Set([sock1.id, sock2.id])]]),
        },
      },
      to(room) {
        return {
          emit(event, payload) {
            emitted.push({ room, event, payload });
          },
        };
      },
      in() {
        return {
          async fetchSockets() {
            return [sock1, sock2];
          },
        };
      },
    };

    // Connect both sessions
    const r1 = await handleSocketActive(/** @type {any} */ (mockIo), /** @type {any} */ (sock1));
    assert.equal(r1?.isOnline, true);
    assert.equal(r1?.transitioned, true);
    assert.equal(
      emitted.some((e) => e.room === rooms.userRoom(userId) && e.event === events.USER_ONLINE),
      true
    );

    const r2 = await handleSocketActive(/** @type {any} */ (mockIo), /** @type {any} */ (sock2));
    assert.equal(r2?.isOnline, true);
    assert.equal(r2?.transitioned, false);

    // Revoke session sid-1 -> disconnects sock1, user stays online via sock2
    const count1 = await disconnectUserSessionSockets(/** @type {any} */ (mockIo), userId, {
      sessionId: 'sid-1',
    });
    assert.equal(count1, 1);
    assert.deepEqual(disconnectedIds, ['sock-sess-1']);
    assert.equal((await getPresence(userId)).isOnline, true);

    // Now deactivate sock2 -> transitions offline and emits USER_OFFLINE with lastSeenAt
    const offRes = await handleSocketInactive(/** @type {any} */ (mockIo), /** @type {any} */ (sock2));
    assert.equal(offRes?.isOnline, false);
    assert.equal(offRes?.transitioned, true);
    assert.ok(offRes?.lastSeenAt);

    const offlineEvent = emitted.find(
      (e) => e.room === rooms.userRoom(userId) && e.event === events.USER_OFFLINE
    );
    assert.ok(offlineEvent, 'USER_OFFLINE should be emitted when last active socket closes');
    assert.equal(offlineEvent.payload.userId, userId);
    assert.equal(offlineEvent.payload.isOnline, false);
    assert.equal(offlineEvent.payload.lastSeenAt, offRes.lastSeenAt);
  });

  test('degrades gracefully when Redis client throws (fail-open offline with fallback)', async () => {
    const brokenRedis = {
      async hGetAll() {
        throw new Error('ECONNREFUSED');
      },
    };

    const fallbackIso = '2026-11-21T04:00:00.000Z';
    const res = await getPresence('user-offline-fallback', {
      fallbackLastSeenAt: fallbackIso,
      redis: brokenRedis,
    });
    assert.equal(res.isOnline, false);
    assert.equal(res.lastSeenAt, fallbackIso);
  });

  test('Socket.IO wire integration: hidden tab auth, presence:update, presence:heartbeat, presence:sync, and disconnect', async (t) => {
    if (!redisAvailable) return t.skip('Redis is not reachable');

    const userId = trackUser();
    const server = http.createServer();
    const io = new Server(server);

    io.use((socket, next) => {
      socket.data.user = { id: userId, username: 'wire-user' };
      socket.data.sessionId = 'wire-sid-1';
      next();
    });

    io.on('connection', (socket) => {
      registerHandlers(socket, io);
      const initiallyActive = socket.handshake?.auth?.active !== false;
      if (initiallyActive) {
        handleSocketActive(io, socket).catch(() => {});
      } else {
        socket.data.presenceActive = false;
        socket.data.lastHeartbeatAt = Date.now();
      }
      socket.on('disconnect', () => {
        handleSocketInactive(io, socket).catch(() => {});
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = /** @type {any} */ (server.address()).port;
    const url = `http://127.0.0.1:${port}`;

    let client = null;
    try {
      // 1. Connect with auth.active = false (background/hidden tab) -> must NOT mark online in Redis
      client = createSocketClient(url, {
        transports: ['websocket'],
        reconnection: false,
        auth: { active: false },
      });

      await new Promise((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });

      await new Promise((r) => setTimeout(r, 30));
      assert.equal((await getPresence(userId)).isOnline, false);

      // 2. Tab becomes visible -> emit presence:update { active: true }
      const onlineEventPromise = new Promise((resolve) => {
        client.once(events.USER_ONLINE, resolve);
      });
      const actAck = await new Promise((resolve) => {
        client.emit(events.PRESENCE_UPDATE, { active: true }, resolve);
      });
      assert.equal(actAck.success, true);
      assert.equal(actAck.isOnline, true);
      const onlineEv = await onlineEventPromise;
      assert.equal(onlineEv.userId, userId);
      assert.equal(onlineEv.isOnline, true);
      assert.equal((await getPresence(userId)).isOnline, true);

      // 3. Heartbeat refreshes lease
      const hbAck = await new Promise((resolve) => {
        client.emit(events.PRESENCE_HEARTBEAT, { active: true }, resolve);
      });
      assert.equal(hbAck.success, true);
      assert.equal(hbAck.isOnline, true);

      // 4. Sync returns authoritative self presence from Redis
      const syncAck = await new Promise((resolve) => {
        client.emit(events.PRESENCE_SYNC, { userIds: [userId] }, resolve);
      });
      assert.equal(syncAck.success, true);
      assert.equal(syncAck.presence[userId]?.isOnline, true);

      // 5. User switches tab / leaves browser -> presence:update { active: false }
      const offlineEventPromise = new Promise((resolve) => {
        client.once(events.USER_OFFLINE, resolve);
      });
      const inactAck = await new Promise((resolve) => {
        client.emit(events.PRESENCE_UPDATE, { active: false }, resolve);
      });
      assert.equal(inactAck.success, true);
      assert.equal(inactAck.isOnline, false);
      assert.ok(inactAck.lastSeenAt);

      const offlineEv = await offlineEventPromise;
      assert.equal(offlineEv.userId, userId);
      assert.equal(offlineEv.isOnline, false);
      assert.equal(offlineEv.lastSeenAt, inactAck.lastSeenAt);

      const afterInactive = await getPresence(userId);
      assert.equal(afterInactive.isOnline, false);
      assert.equal(afterInactive.lastSeenAt, inactAck.lastSeenAt);
    } finally {
      client?.disconnect();
      await new Promise((resolve) => io.close(resolve));
    }
  });

  test('Backend restart presence sync: prunes pre-restart ghost socket IDs so reconnect broadcasts online and disconnect transitions offline', async () => {
    // Use an in-memory mock Redis hash store so this test always runs even when local Redis daemon is stopped
    const store = new Map();
    const mockRedis = {
      async keys(pattern) {
        const prefix = pattern.replace(/\*$/, '');
        return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
      },
      async hGetAll(key) {
        return { ...(store.get(key) || {}) };
      },
      multi() {
        const ops = [];
        return {
          hDel(key, fields) {
            ops.push(() => {
              const cur = store.get(key) || {};
              for (const f of [].concat(fields)) delete cur[f];
              store.set(key, cur);
            });
            return this;
          },
          hSet(key, field, val) {
            ops.push(() => {
              const cur = store.get(key) || {};
              cur[field] = val;
              store.set(key, cur);
            });
            return this;
          },
          expire() {
            return this;
          },
          async exec() {
            ops.forEach((fn) => fn());
            return [];
          },
        };
      },
    };

    const userA = 'restart-user-a';
    const userB = 'restart-user-b';
    const tBeforeRestart = 1_770_010_000_000;

    try {
      // 1. Before backend restart: both userA and userB had active sockets in Redis
      await markSocketActive(userA, 'old-sock-a', { nowMs: tBeforeRestart, redis: mockRedis });
      await markSocketActive(userB, 'old-sock-b', { nowMs: tBeforeRestart, redis: mockRedis });

      // 2. Backend restarts! The new Socket.IO server process initially has 0 connected sockets.
      const liveSockets = new Set();
      setLiveSocketChecker((sockId) => liveSockets.has(sockId));

      // Startup prune immediately cleans pre-restart ghost sockets and marks users offline until they reconnect
      const cleaned = await pruneStalePresenceOnStartup({
        nowMs: tBeforeRestart + 1_000,
        redis: mockRedis,
      });
      assert.equal(cleaned, 2);

      const presBWhileDisconnected = await getPresence(userB, {
        nowMs: tBeforeRestart + 1_500,
        redis: mockRedis,
      });
      assert.equal(presBWhileDisconnected.isOnline, false);
      assert.equal(presBWhileDisconnected.lastSeenAt, new Date(tBeforeRestart).toISOString());

      // 3. Even if startup prune hadn't run yet for a key, reconnecting with a new socket ID
      //    within the 45s TTL window must prune `old-sock-a` and report `transitioned: true`!
      store.set(presenceKey(userA), { [socketField('old-sock-a')]: String(tBeforeRestart) });
      liveSockets.add('new-sock-a');

      const reconnectRes = await markSocketActive(userA, 'new-sock-a', {
        nowMs: tBeforeRestart + 2_000,
        redis: mockRedis,
      });
      assert.equal(reconnectRes.isOnline, true);
      assert.equal(
        reconnectRes.transitioned,
        true,
        'Reconnecting after backend restart must trigger offline -> online transition'
      );
      assert.equal(reconnectRes.activeCount, 1);

      const hashAfterReconnect = await mockRedis.hGetAll(presenceKey(userA));
      assert.equal(hashAfterReconnect[socketField('old-sock-a')], undefined);
      assert.equal(hashAfterReconnect[socketField('new-sock-a')], String(tBeforeRestart + 2_000));

      // 4. When userA hides tab or disconnects `new-sock-a`, userA must immediately transition offline
      //    (never stuck online due to `old-sock-a`).
      const inactiveRes = await markSocketInactive(userA, 'new-sock-a', {
        nowMs: tBeforeRestart + 5_000,
        redis: mockRedis,
      });
      assert.equal(inactiveRes.isOnline, false);
      assert.equal(inactiveRes.transitioned, true);
      assert.equal(inactiveRes.activeCount, 0);
    } finally {
      setLiveSocketChecker(null);
    }
  });
});
