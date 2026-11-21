/**
 * Conversation Clear & Sidebar Removal Tests (scope: 'me' | 'everyone')
 *
 * Uses an in-memory SQL double over `pool.query` & `pool.connect` plus a fake
 * Socket.IO emitter on `app.set('io', ...)` so every route, middleware,
 * validator, controller, service, repository, audit log, and real-time event
 * executes deterministically without requiring external PostgreSQL.
 */

process.env.USE_MEMORY_SESSION = 'true';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import pool from '../src/config/database.js';
import { closeRedis } from '../src/config/redis.js';
import { getLastSentEmail, clearLastSentEmail } from '../src/services/mailer.service.js';
import {
  validateClearConversation,
  CONVERSATION_CLEAR_SCOPES,
} from '../src/validators/conversations.validator.js';
import * as events from '../src/socket/events.js';
import * as rooms from '../src/socket/rooms.js';

let app;
let server;
let baseUrl;
let originalPoolQuery;
let originalPoolConnect;

/** @type {Map<string, any>} */
const usersById = new Map();
/** @type {Map<string, any>} */
const sessionsBySid = new Map();
/** @type {Map<string, any>} */
const conversationsById = new Map();
/** @type {Map<string, { conversation_id: string, user_id: string, joined_at: Date, cleared_at: Date | null, hidden_at: Date | null }>} */
const membersByKey = new Map();
/** @type {Map<string, any>} */
const messagesById = new Map();
/** @type {Map<string, any>} */
const attachmentsById = new Map();
/** @type {Array<any>} */
const securityEvents = [];
/** @type {Array<{ rooms: string[], event: string, payload: any }>} */
const emittedSocketEvents = [];

let clockTick = 0;
function nextTimestamp() {
  clockTick += 100;
  return new Date(Date.now() + clockTick);
}

function memberKey(conversationId, userId) {
  return `${conversationId}:${userId}`;
}

function resetInMemoryState() {
  usersById.clear();
  sessionsBySid.clear();
  conversationsById.clear();
  membersByKey.clear();
  messagesById.clear();
  attachmentsById.clear();
  securityEvents.length = 0;
  emittedSocketEvents.length = 0;
}

function createMockIo() {
  function makeEmitter(targetRooms = []) {
    return {
      to(room) {
        return makeEmitter([...targetRooms, room]);
      },
      emit(event, payload) {
        emittedSocketEvents.push({
          rooms: [...new Set(targetRooms)],
          event,
          payload,
        });
      },
    };
  }
  return makeEmitter([]);
}

async function executeMockSql(text, params = []) {
  const sql = String(text).replace(/\s+/g, ' ').trim();

  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }

  // ── Users ───────────────────────────────────────────────────
  if (/^SELECT .+ FROM users WHERE id = \$1$/i.test(sql)) {
    const user = usersById.get(params[0]);
    return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
  }
  if (/^SELECT .+ FROM users WHERE LOWER\(TRIM\(email\)\) = LOWER\(TRIM\(\$1\)\)$/i.test(sql)) {
    const target = String(params[0] || '').trim().toLowerCase();
    for (const user of usersById.values()) {
      if (String(user.email).trim().toLowerCase() === target) {
        return { rows: [{ ...user, login_lock_remaining_seconds: 0 }], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/^SELECT .+ FROM users WHERE username = \$1$/i.test(sql)) {
    for (const user of usersById.values()) {
      if (user.username === params[0]) {
        return { rows: [{ ...user }], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/^INSERT INTO users/i.test(sql)) {
    const [
      username,
      email,
      passwordHash,
      nickname,
      bio,
      emailVerified,
      tokenHash,
      expiresAt,
    ] = params;
    const id = crypto.randomUUID();
    const now = nextTimestamp();
    const user = {
      id,
      username,
      email,
      nickname: nickname ?? null,
      bio: bio ?? null,
      last_seen_at: null,
      password_hash: passwordHash,
      mfa_enabled: false,
      mfa_secret: null,
      mfa_recovery_codes: [],
      mfa_last_totp_step: -1,
      failed_login_attempts: 0,
      login_locked_until: null,
      email_verified: Boolean(emailVerified),
      email_verified_at: emailVerified ? now : null,
      email_verification_token_hash: tokenHash ?? null,
      email_verification_expires_at: expiresAt ? new Date(expiresAt) : null,
      email_verification_attempts: 0,
      created_at: now,
      updated_at: now,
    };
    usersById.set(id, user);
    return { rows: [{ ...user }], rowCount: 1 };
  }
  if (/^UPDATE users SET email_verified = TRUE/i.test(sql)) {
    const user = usersById.get(params[0]);
    if (user) {
      user.email_verified = true;
      user.email_verified_at = nextTimestamp();
      user.email_verification_token_hash = null;
      user.email_verification_expires_at = null;
    }
    return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
  }
  if (/^UPDATE users SET failed_login_attempts = 0/i.test(sql)) {
    return { rows: [], rowCount: 1 };
  }
  if (/^UPDATE users SET last_seen_at/i.test(sql)) {
    return { rows: [], rowCount: 1 };
  }

  // ── Privacy / Blocks / Friendships ──────────────────────────
  if (/FROM user_privacy_settings/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }
  if (/FROM blocked_users/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }
  if (/FROM friendships/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }

  // ── Sessions ────────────────────────────────────────────────
  if (/^SELECT sess FROM sessions WHERE sid = \$1$/i.test(sql)) {
    const existing = sessionsBySid.get(params[0]);
    return {
      rows: existing ? [{ sess: JSON.parse(existing.sess) }] : [],
      rowCount: existing ? 1 : 0,
    };
  }
  if (/^INSERT INTO sessions/i.test(sql)) {
    sessionsBySid.set(params[0], { sid: params[0], sess: params[1], expire: params[2] });
    return { rows: [], rowCount: 1 };
  }
  if (/^DELETE FROM sessions/i.test(sql)) {
    return { rows: [], rowCount: 0 };
  }

  // ── Security Events ─────────────────────────────────────────
  if (/^INSERT INTO security_events/i.test(sql)) {
    const ev = {
      id: crypto.randomUUID(),
      userId: params[0],
      eventType: params[1],
      ipAddress: params[2],
      metadata: typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3],
      createdAt: nextTimestamp(),
    };
    securityEvents.push(ev);
    return { rows: [ev], rowCount: 1 };
  }

  // ── Conversations ───────────────────────────────────────────
  if (/^SELECT id, type, created_at, updated_at FROM conversations WHERE id = \$1$/i.test(sql)) {
    const conv = conversationsById.get(params[0]);
    return { rows: conv ? [{ ...conv }] : [], rowCount: conv ? 1 : 0 };
  }
  if (/^SELECT c\.id, c\.type, c\.created_at FROM conversations c WHERE c\.type = 'direct'/i.test(sql)) {
    const [userA, userB] = params;
    for (const conv of conversationsById.values()) {
      if (
        conv.type === 'direct' &&
        membersByKey.has(memberKey(conv.id, userA)) &&
        membersByKey.has(memberKey(conv.id, userB))
      ) {
        return { rows: [{ id: conv.id, type: conv.type, created_at: conv.created_at }], rowCount: 1 };
      }
    }
    return { rows: [], rowCount: 0 };
  }
  if (/^INSERT INTO conversations \(type\) VALUES \(\$1\)/i.test(sql)) {
    const id = crypto.randomUUID();
    const now = nextTimestamp();
    const conv = { id, type: params[0], created_at: now, updated_at: now };
    conversationsById.set(id, conv);
    return { rows: [{ ...conv }], rowCount: 1 };
  }
  if (/^UPDATE conversations SET updated_at = NOW\(\) WHERE id = \$1$/i.test(sql)) {
    const conv = conversationsById.get(params[0]);
    if (conv) conv.updated_at = nextTimestamp();
    return { rows: [], rowCount: conv ? 1 : 0 };
  }
  if (/^SELECT c\.id, c\.type, c\.created_at, c\.updated_at AS "lastMessageAt"/i.test(sql)) {
    const userId = params[0];
    const limit = Number(params[params.length - 1]) || 21;
    const rows = [];
    for (const conv of conversationsById.values()) {
      const m = membersByKey.get(memberKey(conv.id, userId));
      if (!m || m.hidden_at !== null) continue;
      let peer = null;
      for (const other of membersByKey.values()) {
        if (other.conversation_id === conv.id && other.user_id !== userId) {
          peer = usersById.get(other.user_id) || null;
          break;
        }
      }
      rows.push({
        id: conv.id,
        type: conv.type,
        created_at: conv.created_at,
        lastMessageAt: conv.updated_at,
        peerId: peer?.id || null,
        peerUsername: peer?.username || null,
        peerNickname: peer?.nickname || null,
        peerBio: peer?.bio || null,
        peerLastSeenAt: peer?.last_seen_at || null,
      });
    }
    rows.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    return { rows: rows.slice(0, limit), rowCount: Math.min(rows.length, limit) };
  }

  // ── Conversation Members ────────────────────────────────────
  if (/^INSERT INTO conversation_members \(conversation_id, user_id\)/i.test(sql)) {
    const [conversationId, userId] = params;
    membersByKey.set(memberKey(conversationId, userId), {
      conversation_id: conversationId,
      user_id: userId,
      joined_at: nextTimestamp(),
      cleared_at: null,
      hidden_at: null,
    });
    return { rows: [], rowCount: 1 };
  }
  if (/^SELECT 1 FROM conversation_members WHERE conversation_id = \$1 AND user_id = \$2$/i.test(sql)) {
    const exists = membersByKey.has(memberKey(params[0], params[1]));
    return { rows: exists ? [{ '?column?': 1 }] : [], rowCount: exists ? 1 : 0 };
  }
  if (/^SELECT conversation_id AS "conversationId", user_id AS "userId", joined_at AS "joinedAt", cleared_at AS "clearedAt", hidden_at AS "hiddenAt" FROM conversation_members/i.test(sql)) {
    const m = membersByKey.get(memberKey(params[0], params[1]));
    if (!m) return { rows: [], rowCount: 0 };
    return {
      rows: [
        {
          conversationId: m.conversation_id,
          userId: m.user_id,
          joinedAt: m.joined_at,
          clearedAt: m.cleared_at,
          hiddenAt: m.hidden_at,
        },
      ],
      rowCount: 1,
    };
  }
  if (/^SELECT u\.id, u\.username, u\.nickname, u\.bio, u\.last_seen_at FROM conversation_members cm/i.test(sql)) {
    const conversationId = params[0];
    const rows = [];
    for (const m of membersByKey.values()) {
      if (m.conversation_id === conversationId) {
        const u = usersById.get(m.user_id);
        if (u) {
          rows.push({
            id: u.id,
            username: u.username,
            nickname: u.nickname,
            bio: u.bio,
            last_seen_at: u.last_seen_at,
          });
        }
      }
    }
    return { rows, rowCount: rows.length };
  }
  if (/^UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id = \$1 AND user_id = \$2/i.test(sql)) {
    const m = membersByKey.get(memberKey(params[0], params[1]));
    if (m && m.hidden_at !== null) {
      m.hidden_at = null;
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  if (/^UPDATE conversation_members SET hidden_at = NULL WHERE conversation_id = \$1 AND hidden_at IS NOT NULL RETURNING user_id AS "userId"$/i.test(sql)) {
    const unhidden = [];
    for (const m of membersByKey.values()) {
      if (m.conversation_id === params[0] && m.hidden_at !== null) {
        m.hidden_at = null;
        unhidden.push({ userId: m.user_id });
      }
    }
    return { rows: unhidden, rowCount: unhidden.length };
  }
  if (/^UPDATE conversation_members SET cleared_at = GREATEST.*WHERE conversation_id = \$1 AND user_id = \$2/i.test(sql)) {
    const [conversationId, userId] = params;
    const m = membersByKey.get(memberKey(conversationId, userId));
    if (!m) return { rows: [], rowCount: 0 };
    let maxTime = nextTimestamp().getTime();
    for (const msg of messagesById.values()) {
      if (msg.conversation_id === conversationId) {
        maxTime = Math.max(maxTime, new Date(msg.created_at).getTime());
      }
    }
    const cutoff = new Date(maxTime);
    m.cleared_at = cutoff;
    m.hidden_at = cutoff;
    return { rows: [{ clearedAt: cutoff, hiddenAt: cutoff }], rowCount: 1 };
  }
  if (/^UPDATE conversation_members SET cleared_at = GREATEST.*WHERE conversation_id = \$1 RETURNING user_id AS "userId", cleared_at AS "clearedAt"$/i.test(sql)) {
    const conversationId = params[0];
    let maxTime = nextTimestamp().getTime();
    for (const msg of messagesById.values()) {
      if (msg.conversation_id === conversationId) {
        maxTime = Math.max(maxTime, new Date(msg.created_at).getTime());
      }
    }
    const cutoff = new Date(maxTime);
    const updated = [];
    for (const m of membersByKey.values()) {
      if (m.conversation_id === conversationId) {
        m.cleared_at = cutoff;
        m.hidden_at = cutoff;
        updated.push({ userId: m.user_id, clearedAt: cutoff });
      }
    }
    return { rows: updated, rowCount: updated.length };
  }

  // ── Messages & Attachments ──────────────────────────────────
  if (/^INSERT INTO messages/i.test(sql)) {
    const id = crypto.randomUUID();
    const now = nextTimestamp();
    const msg = {
      id,
      conversation_id: params[0],
      sender_id: params[1],
      body_ciphertext: params[2],
      nonce: params[3],
      client_message_id: params[4] || null,
      created_at: now,
      edited_at: null,
      deleted_at: null,
    };
    messagesById.set(id, msg);
    return {
      rows: [
        {
          id: msg.id,
          conversationId: msg.conversation_id,
          senderId: msg.sender_id,
          bodyCiphertext: msg.body_ciphertext,
          nonce: msg.nonce,
          clientMessageId: msg.client_message_id,
          createdAt: msg.created_at,
          attachments: [],
        },
      ],
      rowCount: 1,
    };
  }
  if (/^SELECT m\.id, m\.conversation_id AS "conversationId"/i.test(sql)) {
    const conversationId = params[0];
    const hasClearedAt = /AND m\.created_at > \$2::timestamptz/i.test(sql);
    const clearedAt = hasClearedAt ? new Date(params[1]).getTime() : null;
    const limit = Number(params[params.length - 1]) || 51;

    const rows = [];
    for (const msg of messagesById.values()) {
      if (msg.conversation_id !== conversationId) continue;
      if (msg.deleted_at !== null) continue;
      if (clearedAt !== null && new Date(msg.created_at).getTime() <= clearedAt) continue;

      const atts = [];
      for (const att of attachmentsById.values()) {
        if (att.message_id === msg.id && att.deleted_at === null) {
          atts.push({
            id: att.id,
            messageId: att.message_id,
            sizeBytes: att.size_bytes,
            metadataCiphertext: att.metadata_ciphertext,
            metadataNonce: att.metadata_nonce,
            createdAt: att.created_at,
          });
        }
      }
      rows.push({
        id: msg.id,
        conversationId: msg.conversation_id,
        senderId: msg.sender_id,
        bodyCiphertext: msg.body_ciphertext,
        nonce: msg.nonce,
        clientMessageId: msg.client_message_id,
        createdAt: msg.created_at,
        editedAt: msg.edited_at,
        attachments: atts,
      });
    }
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { rows: rows.slice(0, limit), rowCount: Math.min(rows.length, limit) };
  }
  if (/^UPDATE messages SET deleted_at = NOW\(\) WHERE conversation_id = \$1 AND deleted_at IS NULL RETURNING id$/i.test(sql)) {
    const now = nextTimestamp();
    const deleted = [];
    for (const msg of messagesById.values()) {
      if (msg.conversation_id === params[0] && msg.deleted_at === null) {
        msg.deleted_at = now;
        deleted.push({ id: msg.id });
      }
    }
    return { rows: deleted, rowCount: deleted.length };
  }
  if (/^UPDATE attachments SET deleted_at = NOW\(\) WHERE deleted_at IS NULL AND message_id IN/i.test(sql)) {
    const now = nextTimestamp();
    const convMsgIds = new Set(
      [...messagesById.values()]
        .filter((m) => m.conversation_id === params[0])
        .map((m) => m.id)
    );
    const deleted = [];
    for (const att of attachmentsById.values()) {
      if (att.deleted_at === null && convMsgIds.has(att.message_id)) {
        att.deleted_at = now;
        deleted.push({ id: att.id, storageKey: att.storage_key });
      }
    }
    return { rows: deleted, rowCount: deleted.length };
  }

  throw new Error(`Unhandled mock SQL query: ${sql}`);
}

function installMockPool() {
  originalPoolQuery = pool.query.bind(pool);
  originalPoolConnect = pool.connect.bind(pool);
  pool.query = executeMockSql;
  pool.connect = async () => ({
    query: executeMockSql,
    release: () => {},
  });
}

function restoreMockPool() {
  if (originalPoolQuery) pool.query = originalPoolQuery;
  if (originalPoolConnect) pool.connect = originalPoolConnect;
}

before(async () => {
  installMockPool();
  ({ default: app } = await import('../app.js'));
  app.set('io', createMockIo());

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  restoreMockPool();
  await closeRedis();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  resetInMemoryState();
});

/**
 * @param {string} path
 * @param {{ method?: string, cookie?: string, body?: any }} [options]
 */
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
  const suffix = `clr${Date.now()}${Math.floor(Math.random() * 1_000_000)}${label}`;
  const email = `${suffix}@example.com`;
  const password = 'correct-horse-battery';
  clearLastSentEmail();

  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: suffix, email, password }),
  });
  assert.equal(res.status, 201);
  const { user } = await res.json();

  const otp = getLastSentEmail()?.token;
  const verifyRes = await fetch(`${baseUrl}/api/auth/register/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp }),
  });
  assert.equal(verifyRes.status, 200);

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loginRes.status, 200);

  const [cookie] = loginRes.headers.getSetCookie();
  return { user, cookie };
}

describe('Conversation Clear & Sidebar Removal (scope: me | everyone)', () => {
  test('validateClearConversation enforces valid conversationId UUID and scope bounds', () => {
    assert.deepEqual([...CONVERSATION_CLEAR_SCOPES], ['me', 'everyone']);
    assert.equal(events.CONVERSATION_CLEARED, 'conversation:cleared');

    const validUuid = '550e8400-e29b-41d4-a716-446655440000';

    assert.equal(
      validateClearConversation({}, { params: { conversationId: validUuid }, query: {} }).valid,
      true
    );
    assert.equal(
      validateClearConversation({}, { params: { conversationId: validUuid }, query: { scope: 'me' } }).valid,
      true
    );
    assert.equal(
      validateClearConversation({}, { params: { conversationId: validUuid }, query: { scope: 'everyone' } }).valid,
      true
    );
    assert.equal(
      validateClearConversation({ scope: ' EVERYONE ' }, { params: { conversationId: validUuid }, query: {} }).valid,
      true
    );

    const invalidUuidRes = validateClearConversation(
      {},
      { params: { conversationId: 'not-a-uuid' }, query: { scope: 'me' } }
    );
    assert.equal(invalidUuidRes.valid, false);
    assert.ok(invalidUuidRes.errors.some((e) => e.includes('conversationId')));

    const invalidScopeRes = validateClearConversation(
      {},
      { params: { conversationId: validUuid }, query: { scope: 'all' } }
    );
    assert.equal(invalidScopeRes.valid, false);
    assert.ok(invalidScopeRes.errors.some((e) => e.includes('scope')));

    const nonStringScopeRes = validateClearConversation(
      { scope: 123 },
      { params: { conversationId: validUuid }, query: {} }
    );
    assert.equal(nonStringScopeRes.valid, false);
  });

  test('DELETE /api/conversations/:conversationId requires authentication (401)', async () => {
    const res = await api('/api/conversations/550e8400-e29b-41d4-a716-446655440000?scope=me', {
      method: 'DELETE',
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error?.code, 'UNAUTHORIZED');
  });

  test('per-user clear (scope=me) enforces authorization, clears & hides only for requester, emits targeted socket event, and unhides on reopen/new message', async () => {
    const alice = await registerUser('meA');
    const bob = await registerUser('meB');
    const charlie = await registerUser('meC');

    // Create direct conversation & exchange messages
    const convRes = await api('/api/conversations', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: bob.user.id },
    });
    assert.equal(convRes.status, 201);
    const conversationId = (await convRes.json()).conversation.id;

    const msg1Res = await api(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      cookie: alice.cookie,
      body: { bodyCiphertext: 'alice-cipher-1', nonce: 'alice-nonce-1' },
    });
    assert.equal(msg1Res.status, 201);

    const msg2Res = await api(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { bodyCiphertext: 'bob-cipher-1', nonce: 'bob-nonce-1' },
    });
    assert.equal(msg2Res.status, 201);

    // Non-member Charlie is rejected with 403 NOT_CONVERSATION_MEMBER + audit log
    const charlieRes = await api(`/api/conversations/${conversationId}?scope=me`, {
      method: 'DELETE',
      cookie: charlie.cookie,
    });
    assert.equal(charlieRes.status, 403);
    assert.equal((await charlieRes.json()).error?.code, 'NOT_CONVERSATION_MEMBER');
    assert.ok(securityEvents.some((e) => e.eventType === 'CONVERSATION_CLEAR_FORBIDDEN'));

    // Invalid scope rejected with 400 VALIDATION_ERROR
    const badScopeRes = await api(`/api/conversations/${conversationId}?scope=invalid`, {
      method: 'DELETE',
      cookie: alice.cookie,
    });
    assert.equal(badScopeRes.status, 400);
    assert.equal((await badScopeRes.json()).error?.code, 'VALIDATION_ERROR');

    // Unknown conversation returns 404 CONVERSATION_NOT_FOUND
    const notFoundRes = await api('/api/conversations/550e8400-e29b-41d4-a716-446655440099?scope=me', {
      method: 'DELETE',
      cookie: alice.cookie,
    });
    assert.equal(notFoundRes.status, 404);
    assert.equal((await notFoundRes.json()).error?.code, 'CONVERSATION_NOT_FOUND');

    // Clear recorded socket events before Alice deletes for herself
    emittedSocketEvents.length = 0;

    // Alice clears conversation for herself only (scope=me)
    const clearRes = await api(`/api/conversations/${conversationId}?scope=me`, {
      method: 'DELETE',
      cookie: alice.cookie,
    });
    assert.equal(clearRes.status, 200);
    const clearData = await clearRes.json();
    assert.equal(clearData.conversationId, conversationId);
    assert.equal(clearData.scope, 'me');
    assert.ok(clearData.clearedAt);

    // Socket.IO broadcast for scope=me MUST target ONLY Alice's personal room (never Bob!)
    const clearEmit = emittedSocketEvents.find((e) => e.event === events.CONVERSATION_CLEARED);
    assert.ok(clearEmit, 'conversation:cleared must be emitted');
    assert.deepEqual(clearEmit.rooms, [rooms.userRoom(alice.user.id)]);
    assert.equal(clearEmit.payload.scope, 'me');
    assert.equal(clearEmit.payload.clearedBy, alice.user.id);

    // Audit event recorded
    assert.ok(
      securityEvents.some(
        (e) =>
          e.eventType === 'CONVERSATION_CLEARED' &&
          e.userId === alice.user.id &&
          e.metadata?.scope === 'me'
      )
    );

    // Alice's sidebar omits conversation & Alice's message history is empty
    const aliceConvs = (await (await api('/api/conversations', { cookie: alice.cookie })).json()).conversations;
    assert.equal(aliceConvs.some((c) => c.id === conversationId), false);

    const aliceMsgs = (
      await (await api(`/api/conversations/${conversationId}/messages`, { cookie: alice.cookie })).json()
    ).messages;
    assert.equal(aliceMsgs.length, 0);

    // Bob's sidebar & message history remain completely untouched
    const bobConvs = (await (await api('/api/conversations', { cookie: bob.cookie })).json()).conversations;
    assert.equal(bobConvs.some((c) => c.id === conversationId), true);

    const bobMsgs = (
      await (await api(`/api/conversations/${conversationId}/messages`, { cookie: bob.cookie })).json()
    ).messages;
    assert.equal(bobMsgs.length, 2);

    // Re-opening chat via POST /api/conversations unhides it for Alice while old messages remain hidden
    const reopenRes = await api('/api/conversations', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: bob.user.id },
    });
    assert.equal(reopenRes.status, 201);
    const aliceConvsReopen = (await (await api('/api/conversations', { cookie: alice.cookie })).json()).conversations;
    assert.equal(aliceConvsReopen.some((c) => c.id === conversationId), true);

    const aliceMsgsReopen = (
      await (await api(`/api/conversations/${conversationId}/messages`, { cookie: alice.cookie })).json()
    ).messages;
    assert.equal(aliceMsgsReopen.length, 0);

    // Clear again, then verify Bob sending a new message unhides for Alice + emits conversation:updated
    await api(`/api/conversations/${conversationId}?scope=me`, {
      method: 'DELETE',
      cookie: alice.cookie,
    });
    emittedSocketEvents.length = 0;

    const newMsgRes = await api(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { bodyCiphertext: 'bob-new-after-clear', nonce: 'bob-nonce-2' },
    });
    assert.equal(newMsgRes.status, 201);
    const newMsg = (await newMsgRes.json()).message;

    // conversation:updated emitted to both users' personal rooms so Alice's sidebar restores it in real time
    const updatedEmit = emittedSocketEvents.find((e) => e.event === events.CONVERSATION_UPDATED);
    assert.ok(updatedEmit, 'conversation:updated must be emitted on new message');
    assert.ok(updatedEmit.rooms.includes(rooms.userRoom(alice.user.id)));
    assert.ok(updatedEmit.rooms.includes(rooms.userRoom(bob.user.id)));

    const aliceConvsAfterNew = (await (await api('/api/conversations', { cookie: alice.cookie })).json()).conversations;
    assert.equal(aliceConvsAfterNew.some((c) => c.id === conversationId), true);

    const aliceMsgsAfterNew = (
      await (await api(`/api/conversations/${conversationId}/messages`, { cookie: alice.cookie })).json()
    ).messages;
    assert.equal(aliceMsgsAfterNew.length, 1);
    assert.equal(aliceMsgsAfterNew[0].id, newMsg.id);
  });

  test('global clear (scope=everyone) soft-deletes all messages & attachments, hides for both users, and broadcasts deduplicated socket event', async () => {
    const alice = await registerUser('allA');
    const bob = await registerUser('allB');

    const convRes = await api('/api/conversations', {
      method: 'POST',
      cookie: alice.cookie,
      body: { userId: bob.user.id },
    });
    assert.equal(convRes.status, 201);
    const conversationId = (await convRes.json()).conversation.id;

    const msg1 = (
      await (
        await api(`/api/conversations/${conversationId}/messages`, {
          method: 'POST',
          cookie: alice.cookie,
          body: { bodyCiphertext: 'alice-msg', nonce: 'nonce-a' },
        })
      ).json()
    ).message;
    await api(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      cookie: bob.cookie,
      body: { bodyCiphertext: 'bob-msg', nonce: 'nonce-b' },
    });

    // Attach an encrypted attachment record to msg1
    const attId = crypto.randomUUID();
    attachmentsById.set(attId, {
      id: attId,
      message_id: msg1.id,
      uploader_id: alice.user.id,
      storage_key: `attachments/${attId}`,
      metadata_ciphertext: 'enc-meta',
      metadata_nonce: 'meta-nonce',
      size_bytes: 128,
      created_at: nextTimestamp(),
      deleted_at: null,
    });

    emittedSocketEvents.length = 0;

    // Alice clears for everyone
    const clearRes = await api(`/api/conversations/${conversationId}?scope=everyone`, {
      method: 'DELETE',
      cookie: alice.cookie,
    });
    assert.equal(clearRes.status, 200);
    const clearData = await clearRes.json();
    assert.equal(clearData.scope, 'everyone');
    assert.equal(clearData.deletedMessageCount, 2);

    // Socket.IO broadcast targets conversation room + both users' personal rooms in a single chained emit
    const clearEmit = emittedSocketEvents.find((e) => e.event === events.CONVERSATION_CLEARED);
    assert.ok(clearEmit);
    assert.ok(clearEmit.rooms.includes(rooms.conversationRoom(conversationId)));
    assert.ok(clearEmit.rooms.includes(rooms.userRoom(alice.user.id)));
    assert.ok(clearEmit.rooms.includes(rooms.userRoom(bob.user.id)));
    assert.equal(clearEmit.payload.scope, 'everyone');
    assert.equal(clearEmit.payload.clearedBy, alice.user.id);

    // Both Alice and Bob have the conversation removed from sidebar & 0 messages
    for (const actor of [alice, bob]) {
      const convs = (await (await api('/api/conversations', { cookie: actor.cookie })).json()).conversations;
      assert.equal(convs.some((c) => c.id === conversationId), false);

      const msgs = (
        await (await api(`/api/conversations/${conversationId}/messages`, { cookie: actor.cookie })).json()
      ).messages;
      assert.equal(msgs.length, 0);
    }

    // Soft-delete audit trail preserved on messages & attachments
    assert.equal(messagesById.size, 2);
    assert.ok([...messagesById.values()].every((m) => m.deleted_at !== null));
    assert.ok(attachmentsById.get(attId).deleted_at !== null);

    // Audit log recorded with deletedMessageCount
    assert.ok(
      securityEvents.some(
        (e) =>
          e.eventType === 'CONVERSATION_CLEARED' &&
          e.metadata?.scope === 'everyone' &&
          e.metadata?.deletedMessageCount === 2
      )
    );
  });
});
