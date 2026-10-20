import 'fake-indexeddb/auto';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  getOrCreateIdentityKeyPair,
  establishConversationKey,
  encryptMessage,
  decryptMessage,
  clearCryptoState,
} from '../src/services/crypto/message-crypto.js';
import { toBase64Url, fromBase64Url } from '../src/services/crypto/aes-gcm.js';

// Cleanup only; this is a live E2E test, not a unit test.
import pool, { query } from '../../backend/src/config/database.js';

const baseUrl = process.env.E2E_BASE_URL;

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
  const suffix = `e2e${Date.now()}${Math.floor(Math.random() * 1_000_000)}${label}`;
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

async function publishKey(cookie, publicKey) {
  const res = await api('/api/users/me/identity-key', {
    method: 'PUT',
    cookie,
    body: { publicKey },
  });
  assert.equal(res.status, 200);

  const { identityKey } = await res.json();
  assert.equal(identityKey.publicKey, publicKey);
  return identityKey;
}

async function fetchPeerKey(cookie, userId) {
  const res = await api(`/api/users/${userId}/identity-key`, { cookie });
  assert.equal(res.status, 200);

  const { identityKey } = await res.json();
  const fingerprint = toBase64Url(
    await crypto.subtle.digest('SHA-256', fromBase64Url(identityKey.publicKey))
  );
  return { ...identityKey, fingerprint };
}

describe('Live E2EE round trip (requires running backend + Redis)', () => {
  after(async () => {
    await clearCryptoState();
    await pool.end();
  });

  test('two users exchange an encrypted message through the API', async (t) => {
    if (!baseUrl) return t.skip('E2E_BASE_URL is not set');

    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    let conversationId = null;

    try {
      const aliceKey = await getOrCreateIdentityKeyPair(alice.user.id);
      const bobKey = await getOrCreateIdentityKeyPair(bob.user.id);
      await publishKey(alice.cookie, aliceKey.publicKeyBase64);
      await publishKey(bob.cookie, bobKey.publicKeyBase64);

      // Alice opens the conversation and encrypts for Bob.
      const convRes = await api('/api/conversations', {
        method: 'POST',
        cookie: alice.cookie,
        body: { userId: bob.user.id },
      });
      assert.equal(convRes.status, 201);
      conversationId = (await convRes.json()).conversation.id;

      const bobPeer = await fetchPeerKey(alice.cookie, bob.user.id);
      await establishConversationKey(
        conversationId,
        aliceKey.privateKey,
        bobPeer.publicKey,
        bobPeer.fingerprint
      );
      const encrypted = await encryptMessage(conversationId, 'halo dari alice');

      const sendRes = await api(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        cookie: alice.cookie,
        body: { bodyCiphertext: encrypted.bodyCiphertext, nonce: encrypted.nonce },
      });
      assert.equal(sendRes.status, 201);
      const sent = (await sendRes.json()).message;
      assert.equal(sent.bodyCiphertext, encrypted.bodyCiphertext);
      assert.equal(sent.plaintext, undefined);

      // Bob fetches history, derives the same key, and decrypts locally.
      const alicePeer = await fetchPeerKey(bob.cookie, alice.user.id);
      await establishConversationKey(
        conversationId,
        bobKey.privateKey,
        alicePeer.publicKey,
        alicePeer.fingerprint
      );

      const listRes = await api(`/api/conversations/${conversationId}/messages`, {
        cookie: bob.cookie,
      });
      assert.equal(listRes.status, 200);
      const messages = (await listRes.json()).messages;
      const received = messages.find((m) => m.id === sent.id);
      assert.ok(received, 'Bob did not receive the message');
      assert.equal(
        await decryptMessage(conversationId, received.bodyCiphertext, received.nonce),
        'halo dari alice'
      );

      // The server/database only ever sees ciphertext.
      const row = await query('SELECT body_ciphertext FROM messages WHERE id = $1', [sent.id]);
      assert.equal(row.rows[0].body_ciphertext, encrypted.bodyCiphertext);
      assert.notEqual(row.rows[0].body_ciphertext, 'halo dari alice');
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
});
