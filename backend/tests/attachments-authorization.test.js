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

describe('Conversation and attachment authorization (issues #14, #15)', () => {
  test('non-members cannot read messages, send messages, or access attachments', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL is not reachable');

    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    const carol = await registerUser('carol');
    let conversationId = null;
    let attachmentId = null;

    try {
      // Alice ↔ Bob conversation.
      const convRes = await api('/api/conversations', {
        method: 'POST',
        cookie: alice.cookie,
        body: { userId: bob.user.id },
      });
      assert.equal(convRes.status, 201);
      const conversation = (await convRes.json()).conversation;
      conversationId = conversation.id;

      const msgRes = await api(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        cookie: alice.cookie,
        body: { bodyCiphertext: 'Y2lwaGVy', nonce: 'bm9uY2U' },
      });
      assert.equal(msgRes.status, 201);
      const message = (await msgRes.json()).message;

      // Encrypted bytes + encrypted metadata in headers; no plaintext fields.
      const content = Buffer.from('encrypted-attachment-bytes');
      const uploadRes = await fetch(`${baseUrl}/api/attachments`, {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'Content-Type': 'application/octet-stream',
          'X-Message-Id': message.id,
          'X-Metadata-Ciphertext': 'bWV0YWRhdGE',
          'X-Metadata-Nonce': 'bm9uY2U',
        },
        body: content,
      });
      assert.equal(uploadRes.status, 201);
      const attachment = (await uploadRes.json()).attachment;
      attachmentId = attachment.id;
      assert.equal(Number(attachment.sizeBytes), content.length);
      assert.equal(attachment.metadataCiphertext, 'bWV0YWRhdGE');
      assert.equal(attachment.metadataNonce, 'bm9uY2U');
      assert.equal(attachment.originalName, undefined);
      assert.equal(attachment.mimeType, undefined);
      assert.equal(attachment.checksum, undefined);
      assert.equal(attachment.storageKey, undefined);

      // Conversation member can read metadata and content; an unrelated user cannot.
      assert.equal((await api(`/api/attachments/${attachment.id}`, { cookie: bob.cookie })).status, 200);

      const contentRes = await api(`/api/attachments/${attachment.id}/content`, {
        cookie: bob.cookie,
      });
      assert.equal(contentRes.status, 200);
      assert.deepEqual(Buffer.from(await contentRes.arrayBuffer()), content);

      const forbiddenMetadata = await api(`/api/attachments/${attachment.id}`, { cookie: carol.cookie });
      assert.equal(forbiddenMetadata.status, 403);
      assert.equal((await forbiddenMetadata.json()).error.code, 'FORBIDDEN');

      assert.equal(
        (await api(`/api/attachments/${attachment.id}/content`, { cookie: carol.cookie })).status,
        403
      );

      // Non-member cannot read or send messages in the conversation.
      assert.equal(
        (await api(`/api/conversations/${conversationId}/messages`, { cookie: carol.cookie })).status,
        403
      );
      assert.equal(
        (await api(`/api/conversations/${conversationId}/messages`, {
          method: 'POST',
          cookie: carol.cookie,
          body: { bodyCiphertext: 'eA', nonce: 'eQ' },
        })).status,
        403
      );

      // Non-member cannot attach files to a message in the conversation.
      const forbiddenUpload = await fetch(`${baseUrl}/api/attachments`, {
        method: 'POST',
        headers: {
          Cookie: carol.cookie,
          'Content-Type': 'application/octet-stream',
          'X-Message-Id': message.id,
          'X-Metadata-Ciphertext': 'eA',
          'X-Metadata-Nonce': 'eQ',
        },
        body: Buffer.from('x'),
      });
      assert.equal(forbiddenUpload.status, 403);

      // Plaintext metadata is rejected outright (issue #15).
      const plaintextUpload = await api('/api/attachments', {
        method: 'POST',
        cookie: alice.cookie,
        body: {
          messageId: message.id,
          sizeBytes: 10,
          originalName: 'secret.txt',
          mimeType: 'text/plain',
        },
      });
      assert.equal(plaintextUpload.status, 400);
      assert.equal((await plaintextUpload.json()).error.code, 'VALIDATION_ERROR');
    } finally {
      if (attachmentId && alice?.cookie) {
        await api(`/api/attachments/${attachmentId}`, {
          method: 'DELETE',
          cookie: alice.cookie,
        }).catch(() => {});
      }

      const ids = [alice?.user.id, bob?.user.id, carol?.user.id].filter(Boolean);

      if (conversationId) {
        await query('DELETE FROM conversations WHERE id = $1', [conversationId]);
      }
      if (ids.length) {
        await query(`DELETE FROM sessions WHERE sess->>'userId' = ANY($1::text[])`, [ids]);
        await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
      }
    }
  });
});
