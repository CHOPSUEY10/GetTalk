import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import app from '../app.js';
import { query } from '../src/config/database.js';
import { connectRedis, closeRedis } from '../src/config/redis.js';
import { createToken, verifyToken } from '../src/services/storage/signed-token.js';
import { createS3Driver } from '../src/services/storage/s3.driver.js';
import {
  validatePresignAttachment,
  MAX_ATTACHMENT_BYTES,
} from '../src/validators/attachments.validator.js';

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

  const suffix = `ps${Date.now()}${Math.floor(Math.random() * 1_000_000)}${label}`;
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

describe('Attachment Pre-signed URL unit & validation tests', () => {
  test('HMAC capability token binds attachmentId, operation (put vs get), and expiry without exposing storageKey', () => {
    const secret = 'test-signing-secret-key';
    const attachmentId = '550e8400-e29b-41d4-a716-446655440000';
    const expiresAt = new Date(Date.now() + 60_000);

    const putToken = createToken(secret, { attachmentId, op: 'put', expiresAt });
    const getToken = createToken(secret, { attachmentId, op: 'get', expiresAt });

    // Valid token verifies for matching operation only.
    assert.equal(verifyToken(secret, putToken, 'put'), attachmentId);
    assert.equal(verifyToken(secret, putToken, 'get'), null);
    assert.equal(verifyToken(secret, getToken, 'get'), attachmentId);
    assert.equal(verifyToken(secret, getToken, 'put'), null);

    // Wrong secret or tampered signature is rejected.
    assert.equal(verifyToken('wrong-secret', putToken, 'put'), null);
    assert.equal(verifyToken(secret, `${putToken}x`, 'put'), null);

    // Expired token is rejected.
    assert.equal(
      verifyToken(secret, putToken, 'put', expiresAt.getTime() + 1_000),
      null
    );

    // Decoded payload contains only { a, op, exp } — never internal storage paths.
    const [rawPayload] = putToken.split('.');
    const decoded = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8'));
    assert.deepEqual(Object.keys(decoded).sort(), ['a', 'exp', 'op']);
  });

  test('S3 driver generates SigV4 pre-signed PUT and GET URLs for S3/MinIO/Supabase endpoints', async () => {
    const driver = createS3Driver({
      endpoint: 'https://example-project.supabase.co/storage/v1/s3',
      publicEndpoint: 'https://example-project.supabase.co/storage/v1/s3',
      region: 'ap-southeast-1',
      bucket: 'gettalk-attachments',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      forcePathStyle: true,
    });

    const expiresAt = new Date(Date.now() + 300_000);
    const uploadTarget = await driver.createUploadUrl({
      attachmentId: '550e8400-e29b-41d4-a716-446655440000',
      storageKey: 'attachments/550e8400-e29b-41d4-a716-446655440000',
      sizeBytes: 2048,
      expiresAt,
    });

    assert.equal(uploadTarget.method, 'PUT');
    assert.equal(uploadTarget.headers['Content-Type'], 'application/octet-stream');
    const parsedPut = new URL(uploadTarget.url);
    assert.equal(parsedPut.origin, 'https://example-project.supabase.co');
    assert.equal(parsedPut.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
    assert.ok(parsedPut.searchParams.get('X-Amz-Signature'));

    const downloadTarget = await driver.createDownloadUrl({
      attachmentId: '550e8400-e29b-41d4-a716-446655440000',
      storageKey: 'attachments/550e8400-e29b-41d4-a716-446655440000',
      expiresAt,
    });
    const parsedGet = new URL(downloadTarget.url);
    assert.equal(parsedGet.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
    assert.equal(
      parsedGet.searchParams.get('response-content-type'),
      'application/octet-stream'
    );
    assert.equal(parsedGet.searchParams.get('response-cache-control'), 'no-store');
  });

  test('validatePresignAttachment rejects plaintext metadata, server-controlled fields, and oversized files', () => {
    const validMsgId = '550e8400-e29b-41d4-a716-446655440000';

    assert.equal(
      validatePresignAttachment({
        messageId: validMsgId,
        metadataCiphertext: 'bWV0YQ',
        metadataNonce: 'bm9uY2U',
        sizeBytes: 1024,
      }).valid,
      true
    );

    // Plaintext metadata is forbidden per E2EE contract.
    const plainRes = validatePresignAttachment({
      messageId: validMsgId,
      metadataCiphertext: 'bWV0YQ',
      metadataNonce: 'bm9uY2U',
      sizeBytes: 1024,
      filename: 'secret.pdf',
    });
    assert.equal(plainRes.valid, false);
    assert.match(plainRes.errors[0], /plaintext attachment metadata is strictly forbidden/i);

    // Client-supplied storageKey or uploaderId is forbidden.
    assert.equal(
      validatePresignAttachment({
        messageId: validMsgId,
        metadataCiphertext: 'bWV0YQ',
        metadataNonce: 'bm9uY2U',
        sizeBytes: 1024,
        storageKey: '../../etc/passwd',
      }).valid,
      false
    );

    // Size bounds (1..MAX_ATTACHMENT_BYTES).
    assert.equal(
      validatePresignAttachment({
        messageId: validMsgId,
        metadataCiphertext: 'bWV0YQ',
        metadataNonce: 'bm9uY2U',
        sizeBytes: 0,
      }).valid,
      false
    );
    assert.equal(
      validatePresignAttachment({
        messageId: validMsgId,
        metadataCiphertext: 'bWV0YQ',
        metadataNonce: 'bm9uY2U',
        sizeBytes: MAX_ATTACHMENT_BYTES + 1,
      }).valid,
      false
    );
  });

  test('signed storage endpoints reject invalid tokens with 403 FORBIDDEN', async () => {
    const putRes = await fetch(`${baseUrl}/api/storage/invalid.token`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('ciphertext'),
    });
    assert.equal(putRes.status, 403);

    const getRes = await fetch(`${baseUrl}/api/storage/invalid.token`);
    assert.equal(getRes.status, 403);
  });
});

describe('Attachment Pre-signed URL HTTP integration', () => {
  test('full pre-signed upload → complete → pre-signed download round-trip with authorization & size checks', async (t) => {
    if (!dbAvailable) return t.skip('PostgreSQL is not reachable');

    const alice = await registerUser('alice');
    const bob = await registerUser('bob');
    const carol = await registerUser('carol');
    let conversationId = null;
    let attachmentId = null;

    try {
      const convRes = await api('/api/conversations', {
        method: 'POST',
        cookie: alice.cookie,
        body: { userId: bob.user.id },
      });
      assert.equal(convRes.status, 201);
      conversationId = (await convRes.json()).conversation.id;

      const msgRes = await api(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        cookie: alice.cookie,
        body: { bodyCiphertext: 'Y2lwaGVy', nonce: 'bm9uY2U' },
      });
      assert.equal(msgRes.status, 201);
      const message = (await msgRes.json()).message;

      const ciphertext = Buffer.from('presigned-e2ee-attachment-bytes');

      // Non-member or non-sender cannot presign an upload on Alice's message.
      const forbiddenPresign = await api('/api/attachments/presign', {
        method: 'POST',
        cookie: carol.cookie,
        body: {
          messageId: message.id,
          metadataCiphertext: 'bWV0YQ',
          metadataNonce: 'bm9uY2U',
          sizeBytes: ciphertext.length,
        },
      });
      assert.equal(forbiddenPresign.status, 403);

      // 1. Alice requests a pre-signed PUT URL.
      const presignRes = await api('/api/attachments/presign', {
        method: 'POST',
        cookie: alice.cookie,
        body: {
          messageId: message.id,
          metadataCiphertext: 'bWV0YWRhdGE',
          metadataNonce: 'bm9uY2U',
          sizeBytes: ciphertext.length,
        },
      });
      assert.equal(presignRes.status, 201);
      const { attachment: pendingAttachment, upload: uploadTarget } =
        await presignRes.json();
      attachmentId = pendingAttachment.id;

      assert.equal(pendingAttachment.sizeBytes, ciphertext.length);
      assert.equal(pendingAttachment.storageKey, undefined);
      assert.equal(uploadTarget.method, 'PUT');
      assert.ok(uploadTarget.url);
      assert.ok(uploadTarget.expiresAt);

      // Completing before uploading bytes must fail with 400.
      const prematureComplete = await api(
        `/api/attachments/${attachmentId}/complete`,
        { method: 'POST', cookie: alice.cookie }
      );
      assert.equal(prematureComplete.status, 400);

      // Uploading wrong byte length must be rejected (400 on local driver,
      // 403 SignatureDoesNotMatch on S3/Supabase because Content-Length is signed).
      const putUrl = uploadTarget.url.startsWith('http')
        ? uploadTarget.url
        : `${baseUrl}${uploadTarget.url}`;

      const wrongSizePut = await fetch(putUrl, {
        method: 'PUT',
        headers: uploadTarget.headers,
        body: Buffer.from('too-short'),
      });
      assert.ok(
        [400, 403].includes(wrongSizePut.status),
        `expected 400 or 403 for wrong size PUT, got ${wrongSizePut.status}`
      );

      // 2. Alice PUTs the exact encrypted bytes to the pre-signed URL.
      const putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: uploadTarget.headers,
        body: ciphertext,
      });
      assert.ok(
        [200, 204].includes(putRes.status),
        `expected 200 or 204 for valid PUT, got ${putRes.status}`
      );

      // 3. Alice finalizes the upload.
      const completeRes = await api(`/api/attachments/${attachmentId}/complete`, {
        method: 'POST',
        cookie: alice.cookie,
      });
      assert.equal(completeRes.status, 200);
      const completed = (await completeRes.json()).attachment;
      assert.equal(completed.id, attachmentId);
      assert.equal(completed.messageId, message.id);

      // 4. Bob (conversation member) requests a pre-signed download URL and fetches the ciphertext.
      const dlUrlRes = await api(`/api/attachments/${attachmentId}/url`, {
        cookie: bob.cookie,
      });
      assert.equal(dlUrlRes.status, 200);
      const { url: downloadUrl, expiresAt } = await dlUrlRes.json();
      assert.ok(downloadUrl);
      assert.ok(expiresAt);

      const resolvedDlUrl = downloadUrl.startsWith('http')
        ? downloadUrl
        : `${baseUrl}${downloadUrl}`;
      const dlRes = await fetch(resolvedDlUrl);
      assert.equal(dlRes.status, 200);
      assert.deepEqual(Buffer.from(await dlRes.arrayBuffer()), ciphertext);

      // Carol (non-member) cannot obtain a pre-signed download URL.
      const forbiddenDl = await api(`/api/attachments/${attachmentId}/url`, {
        cookie: carol.cookie,
      });
      assert.equal(forbiddenDl.status, 403);
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
