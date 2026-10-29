import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import app from '../app.js';
import { query } from '../src/config/database.js';
import { closeRedis } from '../src/config/redis.js';

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
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}${label}`;
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
  const [cookie] = res.headers.getSetCookie();
  return { user, cookie };
}

describe('Message Edit (FR-11) and Soft Delete (FR-12)', () => {
  test('owner can edit and soft-delete own message; non-owner is rejected with 403 (AC-07, AC-08, AC-09)', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL is not reachable');

    const alice = await registerUser('editdelA');
    const bob = await registerUser('editdelB');
    let conversationId = null;

    try {
      const convRes = await api('/api/conversations', {
        method: 'POST',
        cookie: alice.cookie,
        body: { userId: bob.user.id },
      });
      assert.equal(convRes.status, 201);
      conversationId = (await convRes.json()).conversation.id;

      // 1. Alice sends an encrypted message
      const createRes = await api(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        cookie: alice.cookie,
        body: {
          bodyCiphertext: 'initial-cipher-base64',
          nonce: 'initial-nonce-base64',
          clientMessageId: `client-${Date.now()}`,
        },
      });
      assert.equal(createRes.status, 201);
      const createdMsg = (await createRes.json()).message;
      assert.ok(createdMsg.id);

      // 2. Reject plaintext edit attempt (FR-15, NFR-07)
      const plainEditRes = await api(`/api/messages/${createdMsg.id}`, {
        method: 'PATCH',
        cookie: alice.cookie,
        body: { body: 'plaintext is forbidden' },
      });
      assert.equal(plainEditRes.status, 400);

      // 3. Non-owner (Bob) cannot edit Alice's message (RB-02, AC-09)
      const bobEditRes = await api(`/api/messages/${createdMsg.id}`, {
        method: 'PATCH',
        cookie: bob.cookie,
        body: {
          bodyCiphertext: 'tampered-by-bob',
          nonce: 'bob-nonce',
        },
      });
      assert.equal(bobEditRes.status, 403);
      const bobEditErr = await bobEditRes.json();
      assert.equal(bobEditErr.error.code, 'NOT_MESSAGE_OWNER');

      // 4. Non-owner (Bob) cannot delete Alice's message (RB-03, AC-09)
      const bobDelRes = await api(`/api/messages/${createdMsg.id}`, {
        method: 'DELETE',
        cookie: bob.cookie,
      });
      assert.equal(bobDelRes.status, 403);
      const bobDelErr = await bobDelRes.json();
      assert.equal(bobDelErr.error.code, 'NOT_MESSAGE_OWNER');

      // 5. Owner (Alice) edits her own message with new ciphertext & nonce (FR-11, AC-07)
      const aliceEditRes = await api(`/api/messages/${createdMsg.id}`, {
        method: 'PATCH',
        cookie: alice.cookie,
        body: {
          bodyCiphertext: 'updated-cipher-base64',
          nonce: 'updated-nonce-base64',
        },
      });
      assert.equal(aliceEditRes.status, 200);
      const updatedMsg = (await aliceEditRes.json()).message;
      assert.equal(updatedMsg.id, createdMsg.id);
      assert.equal(updatedMsg.conversationId, conversationId);
      assert.equal(updatedMsg.senderId, alice.user.id);
      assert.equal(updatedMsg.bodyCiphertext, 'updated-cipher-base64');
      assert.equal(updatedMsg.nonce, 'updated-nonce-base64');
      assert.ok(updatedMsg.editedAt);

      // Verify Bob sees the updated ciphertext in history
      const histAfterEdit = await api(`/api/conversations/${conversationId}/messages`, {
        cookie: bob.cookie,
      });
      assert.equal(histAfterEdit.status, 200);
      const listAfterEdit = (await histAfterEdit.json()).messages;
      const foundEdited = listAfterEdit.find((m) => m.id === createdMsg.id);
      assert.ok(foundEdited);
      assert.equal(foundEdited.bodyCiphertext, 'updated-cipher-base64');
      assert.equal(foundEdited.nonce, 'updated-nonce-base64');
      assert.ok(foundEdited.editedAt);

      // 6. Owner (Alice) soft-deletes her message (FR-12, RB-05, AC-08)
      const aliceDelRes = await api(`/api/messages/${createdMsg.id}`, {
        method: 'DELETE',
        cookie: alice.cookie,
      });
      assert.equal(aliceDelRes.status, 204);

      // Verify soft-deleted record still exists in DB for audit with deleted_at set,
      // but is excluded from conversation message history (FR-12, RB-05, AC-08)
      const dbRow = await query('SELECT deleted_at FROM messages WHERE id = $1', [createdMsg.id]);
      assert.equal(dbRow.rowCount, 1);
      assert.ok(dbRow.rows[0].deleted_at);

      const histAfterDelete = await api(`/api/conversations/${conversationId}/messages`, {
        cookie: bob.cookie,
      });
      assert.equal(histAfterDelete.status, 200);
      const listAfterDelete = (await histAfterDelete.json()).messages;
      assert.equal(
        listAfterDelete.some((m) => m.id === createdMsg.id),
        false
      );

      // 7. Subsequent edit or delete on soft-deleted message returns 404
      const editDeletedRes = await api(`/api/messages/${createdMsg.id}`, {
        method: 'PATCH',
        cookie: alice.cookie,
        body: { bodyCiphertext: 'again', nonce: 'again-nonce' },
      });
      assert.equal(editDeletedRes.status, 404);
    } finally {
      if (conversationId) {
        await query('DELETE FROM conversations WHERE id = $1', [conversationId]);
      }
      await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [alice.user.id, bob.user.id],
      ]);
    }
  });
});

