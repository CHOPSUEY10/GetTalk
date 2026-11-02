import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import app from '../app.js';
import { query } from '../src/config/database.js';
import { connectRedis, closeRedis } from '../src/config/redis.js';
import {
  validatePaginationQuery,
  parsePaginationQuery,
  buildPage,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from '../src/utils/pagination.js';
import { validateListMessagesQuery } from '../src/validators/messages.validator.js';
import { validateListConversationsQuery } from '../src/validators/conversations.validator.js';
import { validateListFriendsQuery } from '../src/validators/friends.validator.js';

let server;
let baseUrl;
let dbAvailable = true;

before(async () => {
  try {
    await query('SELECT 1');
  } catch {
    dbAvailable = false;
  }

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await closeRedis();
  await new Promise((resolve) => server.close(resolve));
});

function api(path, { method = 'GET', cookie, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function registerUser(label) {
  try {
    const redis = await connectRedis();
    const keys = await redis.keys('ratelimit:auth:register:*');
    if (keys.length > 0) await redis.del(keys);
  } catch {
    // Redis optional
  }

  const suffix = `pg${Date.now()}${Math.floor(Math.random() * 1_000_000)}${label}`;
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: suffix,
      email: `${suffix}@example.com`,
      password: 'correct-horse-battery',
    }),
  });
  assert.equal(res.status, 201);
  const { user } = await res.json();
  const [cookie] = res.headers.getSetCookie();
  return { user, cookie };
}

describe('Pagination utilities & validators (Rule #5, #9, #13)', () => {
  test('buildPage returns nextCursor = null when row count equals limit (no false extra page)', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = buildPage(rows, 3);
    assert.deepEqual(page.items, rows);
    assert.equal(page.nextCursor, null);
  });

  test('buildPage trims the lookahead row (limit + 1) and sets nextCursor to the last item of the page', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const page = buildPage(rows, 3);
    assert.deepEqual(page.items, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    assert.equal(page.nextCursor, 'c');
  });

  test('validatePaginationQuery enforces limit bounds (1..100) and UUID cursors', () => {
    assert.equal(validatePaginationQuery({}).valid, true);
    assert.equal(
      validatePaginationQuery({
        limit: '25',
        before: '550e8400-e29b-41d4-a716-446655440000',
      }).valid,
      true
    );

    for (const badLimit of ['0', '-1', String(MAX_PAGE_LIMIT + 1), 'abc', '10.5']) {
      const res = validatePaginationQuery({ limit: badLimit });
      assert.equal(res.valid, false, `limit=${badLimit} should be rejected`);
    }

    const badCursor = validatePaginationQuery({ before: 'not-a-uuid' }, 'before');
    assert.equal(badCursor.valid, false);
    assert.match(badCursor.errors[0], /before must be a valid cursor/i);
  });

  test('parsePaginationQuery applies default limit when omitted', () => {
    assert.deepEqual(parsePaginationQuery({}), {
      limit: DEFAULT_PAGE_LIMIT,
      cursor: null,
    });
    assert.deepEqual(
      parsePaginationQuery(
        { limit: '15', after: '550e8400-e29b-41d4-a716-446655440000' },
        'after'
      ),
      {
        limit: 15,
        cursor: '550e8400-e29b-41d4-a716-446655440000',
      }
    );
  });

  test('endpoint validators reject malformed conversationId, limit, before, and after', () => {
    assert.equal(
      validateListMessagesQuery(null, {
        params: { conversationId: 'bad-id' },
        query: {},
      }).valid,
      false
    );
    assert.equal(
      validateListMessagesQuery(null, {
        params: { conversationId: '550e8400-e29b-41d4-a716-446655440000' },
        query: { limit: '999' },
      }).valid,
      false
    );
    assert.equal(
      validateListConversationsQuery(null, { query: { before: 'bad-cursor' } }).valid,
      false
    );
    assert.equal(
      validateListFriendsQuery(null, { query: { after: 'bad-cursor' } }).valid,
      false
    );
  });
});

describe('Pagination HTTP integration (messages, conversations, friends)', () => {
  test('keyset pagination on messages handles ties, exact boundaries, and invalid cursors', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL is not reachable');

    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    let conversationId = null;

    try {
      const convRes = await api('/api/conversations', {
        method: 'POST',
        cookie: alice.cookie,
        body: { userId: bob.user.id },
      });
      assert.equal(convRes.status, 201);
      conversationId = (await convRes.json()).conversation.id;

      // Reject invalid query parameters with 400 VALIDATION_ERROR.
      const badLimit = await api(
        `/api/conversations/${conversationId}/messages?limit=0`,
        { cookie: alice.cookie }
      );
      assert.equal(badLimit.status, 400);
      assert.equal((await badLimit.json()).error.code, 'VALIDATION_ERROR');

      const badBefore = await api(
        `/api/conversations/${conversationId}/messages?before=not-a-uuid`,
        { cookie: alice.cookie }
      );
      assert.equal(badBefore.status, 400);
      assert.equal((await badBefore.json()).error.code, 'VALIDATION_ERROR');

      // Send 3 messages and force identical timestamps on the first two to
      // verify keyset tie-breaking on (created_at, id).
      const sentIds = [];
      for (let i = 0; i < 3; i++) {
        const res = await api(`/api/conversations/${conversationId}/messages`, {
          method: 'POST',
          cookie: alice.cookie,
          body: { bodyCiphertext: `Y2lwaGVy_${i}`, nonce: `bm9uY2U_${i}` },
        });
        assert.equal(res.status, 201);
        sentIds.push((await res.json()).message.id);
      }

      const tiedTime = '2026-10-01T00:00:00.000Z';
      const newerTime = '2026-10-01T00:01:00.000Z';
      await query('UPDATE messages SET created_at = $1 WHERE id = ANY($2::uuid[])', [
        tiedTime,
        [sentIds[0], sentIds[1]],
      ]);
      await query('UPDATE messages SET created_at = $1 WHERE id = $2', [
        newerTime,
        sentIds[2],
      ]);

      // Exact boundary: 3 messages with limit=3 must return nextCursor = null.
      const exactRes = await api(
        `/api/conversations/${conversationId}/messages?limit=3`,
        { cookie: alice.cookie }
      );
      assert.equal(exactRes.status, 200);
      const exactBody = await exactRes.json();
      assert.equal(exactBody.messages.length, 3);
      assert.equal(exactBody.nextCursor, null);

      // Walk through all 3 messages with limit=2 -> page 1 (2 items) + page 2 (1 item).
      const page1Res = await api(
        `/api/conversations/${conversationId}/messages?limit=2`,
        { cookie: alice.cookie }
      );
      assert.equal(page1Res.status, 200);
      const page1 = await page1Res.json();
      assert.equal(page1.messages.length, 2);
      assert.ok(page1.nextCursor);

      const page2Res = await api(
        `/api/conversations/${conversationId}/messages?limit=2&before=${page1.nextCursor}`,
        { cookie: alice.cookie }
      );
      assert.equal(page2Res.status, 200);
      const page2 = await page2Res.json();
      assert.equal(page2.messages.length, 1);
      assert.equal(page2.nextCursor, null);

      const allIds = [...page1.messages, ...page2.messages].map((m) => m.id);
      assert.equal(new Set(allIds).size, 3, 'no duplicate or skipped messages across tied timestamps');
    } finally {
      const ids = [alice?.user.id, bob?.user.id].filter(Boolean);
      if (conversationId) {
        await query('DELETE FROM conversations WHERE id = $1', [conversationId]);
      }
      if (ids.length) {
        await query(`DELETE FROM sessions WHERE sess->>'userId' = ANY($1::text[])`, [ids]);
        await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
      }
    }
  });

  test('conversations and friends endpoints support cursor pagination', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL is not reachable');

    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    const carol = await registerUser('carol');
    const conversationIds = [];

    try {
      // Create 2 conversations and 2 accepted friendships for Alice.
      for (const peer of [bob, carol]) {
        const convRes = await api('/api/conversations', {
          method: 'POST',
          cookie: alice.cookie,
          body: { userId: peer.user.id },
        });
        assert.equal(convRes.status, 201);
        conversationIds.push((await convRes.json()).conversation.id);

        const reqRes = await api('/api/friends/requests', {
          method: 'POST',
          cookie: alice.cookie,
          body: { userId: peer.user.id },
        });
        assert.equal(reqRes.status, 201);
        const reqId = (await reqRes.json()).request.id;

        const accRes = await api(`/api/friends/requests/${reqId}/accept`, {
          method: 'POST',
          cookie: peer.cookie,
        });
        assert.equal(accRes.status, 200);
      }

      // Conversations pagination (limit=1 -> page 1 + page 2).
      const convP1 = await (
        await api('/api/conversations?limit=1', { cookie: alice.cookie })
      ).json();
      assert.equal(convP1.conversations.length, 1);
      assert.ok(convP1.nextCursor);

      const convP2 = await (
        await api(`/api/conversations?limit=1&before=${convP1.nextCursor}`, {
          cookie: alice.cookie,
        })
      ).json();
      assert.equal(convP2.conversations.length, 1);
      assert.equal(convP2.nextCursor, null);
      assert.notEqual(convP1.conversations[0].id, convP2.conversations[0].id);

      // Friends pagination (limit=1 -> page 1 + page 2).
      const frP1 = await (
        await api('/api/friends?limit=1', { cookie: alice.cookie })
      ).json();
      assert.equal(frP1.friends.length, 1);
      assert.ok(frP1.nextCursor);

      const frP2 = await (
        await api(`/api/friends?limit=1&after=${frP1.nextCursor}`, {
          cookie: alice.cookie,
        })
      ).json();
      assert.equal(frP2.friends.length, 1);
      assert.equal(frP2.nextCursor, null);
      assert.notEqual(frP1.friends[0].userId, frP2.friends[0].userId);
    } finally {
      const ids = [alice?.user.id, bob?.user.id, carol?.user.id].filter(Boolean);
      if (conversationIds.length) {
        await query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [conversationIds]);
      }
      if (ids.length) {
        await query(`DELETE FROM sessions WHERE sess->>'userId' = ANY($1::text[])`, [ids]);
        await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
      }
    }
  });
});
