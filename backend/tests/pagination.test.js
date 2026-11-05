import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import app from '../app.js';
import { query } from '../src/config/database.js';
import { connectRedis, closeRedis } from '../src/config/redis.js';
import {
  validatePaginationQuery,
  parsePaginationQuery,
  parseOffsetPaginationQuery,
  buildPage,
  buildOffsetPage,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  isValidCursor,
} from '../src/utils/pagination.js';
import {
  validatePaginationQuery as validatorPaginationQuery,
} from '../src/validators/pagination.validator.js';
import { validateListMessagesQuery } from '../src/validators/messages.validator.js';
import { validateListConversationsQuery } from '../src/validators/conversations.validator.js';
import {
  validateListFriendsQuery,
  validateListFriendRequestsQuery,
} from '../src/validators/friends.validator.js';
import { validateSearchQuery } from '../src/validators/users.validator.js';

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
  test('buildPage returns nextCursor = null and hasMore = false when row count equals limit', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = buildPage(rows, 3);
    assert.deepEqual(page.items, rows);
    assert.deepEqual(page.data, rows);
    assert.equal(page.nextCursor, null);
    assert.equal(page.hasMore, false);
    assert.deepEqual(page.pagination, {
      limit: 3,
      nextCursor: null,
      hasMore: false,
    });
  });

  test('buildPage trims the lookahead row (limit + 1) and sets nextCursor & hasMore = true', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const page = buildPage(rows, 3);
    assert.deepEqual(page.items, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    assert.equal(page.nextCursor, 'c');
    assert.equal(page.hasMore, true);
    assert.deepEqual(page.pagination, {
      limit: 3,
      nextCursor: 'c',
      hasMore: true,
    });
  });

  test('buildOffsetPage computes hasMore accurately from offset, rows.length, and total', () => {
    const page1 = buildOffsetPage([{ id: '1' }, { id: '2' }], {
      limit: 2,
      offset: 0,
      total: 3,
    });
    assert.equal(page1.hasMore, true);
    assert.deepEqual(page1.pagination, {
      limit: 2,
      offset: 0,
      total: 3,
      hasMore: true,
    });

    const page2 = buildOffsetPage([{ id: '3' }], {
      limit: 2,
      offset: 2,
      total: 3,
    });
    assert.equal(page2.hasMore, false);
    assert.deepEqual(page2.pagination, {
      limit: 2,
      offset: 2,
      total: 3,
      hasMore: false,
    });
  });

  test('validatePaginationQuery enforces limit bounds (1..50), non-negative offset, and UUID/ISO cursors', () => {
    assert.equal(validatePaginationQuery, validatorPaginationQuery);
    assert.equal(validatePaginationQuery({}).valid, true);
    assert.equal(
      validatePaginationQuery({
        limit: '25',
        before: '550e8400-e29b-41d4-a716-446655440000',
      }).valid,
      true
    );
    assert.equal(
      validatePaginationQuery({
        limit: '20',
        before: '2026-10-01T00:00:00.000Z',
      }).valid,
      true
    );
    assert.equal(isValidCursor('550e8400-e29b-41d4-a716-446655440000'), true);
    assert.equal(isValidCursor('2026-10-01T12:30:00.000Z'), true);
    assert.equal(isValidCursor('not-a-cursor'), false);

    for (const badLimit of ['0', '-1', String(MAX_PAGE_LIMIT + 1), 'abc', '10.5']) {
      const res = validatePaginationQuery({ limit: badLimit });
      assert.equal(res.valid, false, `limit=${badLimit} should be rejected`);
    }

    for (const badOffset of ['-1', '-10', 'abc', '2.5']) {
      const res = validatePaginationQuery({ offset: badOffset });
      assert.equal(res.valid, false, `offset=${badOffset} should be rejected`);
    }

    const badCursor = validatePaginationQuery({ before: 'not-a-uuid' }, 'before');
    assert.equal(badCursor.valid, false);
    assert.match(badCursor.errors[0], /before must be a valid cursor/i);
  });

  test('parsePaginationQuery and parseOffsetPaginationQuery apply defaults when omitted', () => {
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
    assert.deepEqual(parseOffsetPaginationQuery({}), {
      limit: 20,
      offset: 0,
      cursor: null,
    });
  });

  test('endpoint validators reject malformed conversationId, limit, offset, before, and after', () => {
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
        query: { limit: '51' },
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
    assert.equal(
      validateListFriendsQuery(null, { query: { offset: '-1' } }).valid,
      false
    );
    assert.equal(
      validateListFriendRequestsQuery(null, { query: { before: 'bad-cursor' } }).valid,
      false
    );
    assert.equal(
      validateSearchQuery(null, { query: { q: 'alice', limit: '31' } }).valid,
      false
    );
    assert.equal(
      validateSearchQuery(null, { query: { q: 'alice', offset: '-5' } }).valid,
      false
    );
  });
});

describe('Pagination HTTP integration (messages, conversations, friends, requests, user search)', () => {
  test('keyset pagination on messages handles ties, exact boundaries, max 50 limit, and unified envelope', async (t) => {
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
      for (const badQuery of ['limit=0', 'limit=-1', 'limit=51', 'limit=abc', 'before=not-a-uuid']) {
        const badRes = await api(
          `/api/conversations/${conversationId}/messages?${badQuery}`,
          { cookie: alice.cookie }
        );
        assert.equal(badRes.status, 400, `Query ${badQuery} must return 400`);
        assert.equal((await badRes.json()).error.code, 'VALIDATION_ERROR');
      }

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

      // Exact boundary: 3 messages with limit=3 must return nextCursor = null, hasMore = false.
      const exactRes = await api(
        `/api/conversations/${conversationId}/messages?limit=3`,
        { cookie: alice.cookie }
      );
      assert.equal(exactRes.status, 200);
      const exactBody = await exactRes.json();
      assert.equal(exactBody.data.length, 3);
      assert.equal(exactBody.messages.length, 3);
      assert.equal(exactBody.nextCursor, null);
      assert.equal(exactBody.hasMore, false);
      assert.deepEqual(exactBody.pagination, {
        limit: 3,
        nextCursor: null,
        hasMore: false,
      });

      // Walk through all 3 messages with limit=2 -> page 1 (2 items) + page 2 (1 item).
      const page1Res = await api(
        `/api/conversations/${conversationId}/messages?limit=2`,
        { cookie: alice.cookie }
      );
      assert.equal(page1Res.status, 200);
      const page1 = await page1Res.json();
      assert.equal(page1.data.length, 2);
      assert.equal(page1.messages.length, 2);
      assert.ok(page1.nextCursor);
      assert.equal(page1.hasMore, true);
      assert.equal(page1.pagination.limit, 2);
      assert.equal(page1.pagination.nextCursor, page1.nextCursor);
      assert.equal(page1.pagination.hasMore, true);

      const page2Res = await api(
        `/api/conversations/${conversationId}/messages?limit=2&before=${page1.nextCursor}`,
        { cookie: alice.cookie }
      );
      assert.equal(page2Res.status, 200);
      const page2 = await page2Res.json();
      assert.equal(page2.data.length, 1);
      assert.equal(page2.messages.length, 1);
      assert.equal(page2.nextCursor, null);
      assert.equal(page2.hasMore, false);
      assert.equal(page2.pagination.hasMore, false);

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

  test('conversations, friends (offset & cursor), friend requests (cursor), and user search (offset) support standardized pagination', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL is not reachable');

    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    const carol = await registerUser('carol');
    const dave = await registerUser('dave');
    const conversationIds = [];

    try {
      // Create 2 conversations and 2 accepted friendships for Alice (with Bob & Carol).
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

      // Dave sends a pending friend request to Alice; also create a second pending request from a 5th user.
      const erin = await registerUser('erin');
      try {
        for (const sender of [dave, erin]) {
          const r = await api('/api/friends/requests', {
            method: 'POST',
            cookie: sender.cookie,
            body: { userId: alice.user.id },
          });
          assert.equal(r.status, 201);
        }

        // 1. Conversations cursor pagination (limit=1 -> page 1 + page 2).
        const convP1 = await (
          await api('/api/conversations?limit=1', { cookie: alice.cookie })
        ).json();
        assert.equal(convP1.data.length, 1);
        assert.equal(convP1.conversations.length, 1);
        assert.ok(convP1.nextCursor);
        assert.equal(convP1.pagination.limit, 1);
        assert.equal(convP1.pagination.hasMore, true);

        const convP2 = await (
          await api(`/api/conversations?limit=1&before=${convP1.nextCursor}`, {
            cookie: alice.cookie,
          })
        ).json();
        assert.equal(convP2.data.length, 1);
        assert.equal(convP2.conversations.length, 1);
        assert.equal(convP2.nextCursor, null);
        assert.equal(convP2.pagination.hasMore, false);
        assert.notEqual(convP1.conversations[0].id, convP2.conversations[0].id);

        // 2. Friends offset pagination (limit=1, offset=0 -> limit=1, offset=1).
        const frOffsetP1 = await (
          await api('/api/friends?limit=1&offset=0', { cookie: alice.cookie })
        ).json();
        assert.equal(frOffsetP1.data.length, 1);
        assert.equal(frOffsetP1.friends.length, 1);
        assert.equal(frOffsetP1.pagination.limit, 1);
        assert.equal(frOffsetP1.pagination.offset, 0);
        assert.equal(frOffsetP1.pagination.total, 2);
        assert.equal(frOffsetP1.pagination.hasMore, true);

        const frOffsetP2 = await (
          await api('/api/friends?limit=1&offset=1', { cookie: alice.cookie })
        ).json();
        assert.equal(frOffsetP2.data.length, 1);
        assert.equal(frOffsetP2.friends.length, 1);
        assert.equal(frOffsetP2.pagination.limit, 1);
        assert.equal(frOffsetP2.pagination.offset, 1);
        assert.equal(frOffsetP2.pagination.total, 2);
        assert.equal(frOffsetP2.pagination.hasMore, false);
        assert.notEqual(frOffsetP1.friends[0].userId, frOffsetP2.friends[0].userId);

        // Friends cursor pagination (after) also remains supported.
        const frCursorP2 = await (
          await api(`/api/friends?limit=1&after=${frOffsetP1.nextCursor}`, {
            cookie: alice.cookie,
          })
        ).json();
        assert.equal(frCursorP2.friends.length, 1);
        assert.equal(frCursorP2.nextCursor, null);
        assert.notEqual(frOffsetP1.friends[0].userId, frCursorP2.friends[0].userId);

        // 3. Friend Requests cursor pagination (limit=1 -> page 1 + page 2).
        const reqP1 = await (
          await api('/api/friends/requests?limit=1', { cookie: alice.cookie })
        ).json();
        assert.equal(reqP1.data.length, 1);
        assert.equal(reqP1.requests.length, 1);
        assert.ok(reqP1.nextCursor);
        assert.equal(reqP1.pagination.limit, 1);
        assert.equal(reqP1.pagination.hasMore, true);

        const reqP2 = await (
          await api(`/api/friends/requests?limit=1&before=${reqP1.nextCursor}`, {
            cookie: alice.cookie,
          })
        ).json();
        assert.equal(reqP2.data.length, 1);
        assert.equal(reqP2.requests.length, 1);
        assert.equal(reqP2.nextCursor, null);
        assert.equal(reqP2.pagination.hasMore, false);
        assert.notEqual(reqP1.requests[0].id, reqP2.requests[0].id);

        // 4. User Search offset pagination (limit=2, offset=0).
        const searchP1 = await (
          await api('/api/users/search?q=pg&limit=2&offset=0', {
            cookie: alice.cookie,
          })
        ).json();
        assert.equal(searchP1.data.length, 2);
        assert.equal(searchP1.users.length, 2);
        assert.equal(searchP1.pagination.limit, 2);
        assert.equal(searchP1.pagination.offset, 0);
        assert.ok(searchP1.pagination.total >= 5);
        assert.equal(searchP1.pagination.hasMore, true);

        // Invalid pagination params on friends, requests, conversations, and search return 400.
        assert.equal(
          (await api('/api/friends?limit=-1', { cookie: alice.cookie })).status,
          400
        );
        assert.equal(
          (await api('/api/friends/requests?limit=0', { cookie: alice.cookie })).status,
          400
        );
        assert.equal(
          (await api('/api/conversations?limit=51', { cookie: alice.cookie })).status,
          400
        );
        assert.equal(
          (await api('/api/users/search?q=pg&limit=31', { cookie: alice.cookie })).status,
          400
        );
        assert.equal(
          (await api('/api/users/search?q=pg&offset=-2', { cookie: alice.cookie })).status,
          400
        );
      } finally {
        if (erin?.user?.id) {
          await query(`DELETE FROM sessions WHERE sess->>'userId' = $1`, [erin.user.id]);
          await query('DELETE FROM users WHERE id = $1', [erin.user.id]);
        }
      }
    } finally {
      const ids = [alice?.user.id, bob?.user.id, carol?.user.id, dave?.user.id].filter(Boolean);
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
