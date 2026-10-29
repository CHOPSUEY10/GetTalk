import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import app from '../app.js';
import { query } from '../src/config/database.js';
import { closeRedis } from '../src/config/redis.js';
import { getLastSentEmail, clearLastSentEmail } from '../src/services/mailer.service.js';

let server;
let baseUrl;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await closeRedis();
  await new Promise((resolve) => server.close(resolve));
});

describe('Secure Forgot & Reset Password Flow', () => {
  const testUser = {
    username: `pwd_user_${Date.now()}`,
    email: `pwd_user_${Date.now()}@example.com`,
    password: 'InitialPassword123!',
  };
  let userCookie = null;
  let userId = null;

  before(async () => {
    // Register test user
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser),
    });
    assert.equal(regRes.status, 201);
    const regBody = await regRes.json();
    userId = regBody.user.id;

    // Login to establish an active session
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: testUser.password }),
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get('set-cookie');
    assert.ok(setCookie);
    userCookie = setCookie.split(';')[0];

    // Confirm session is valid
    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: userCookie },
    });
    assert.equal(sessionRes.status, 200);
  });

  test('POST /api/auth/password/forgot validates email input', async () => {
    const res = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('POST /api/auth/password/forgot resists user enumeration for non-existent email', async () => {
    clearLastSentEmail();
    const nonExistentEmail = `nonexistent_${Date.now()}@example.com`;

    const res = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: nonExistentEmail }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(
      body.message,
      'Jika email terdaftar, tautan pengaturan ulang kata sandi telah dikirimkan.'
    );

    // No email should be sent for unregistered user
    assert.equal(getLastSentEmail(), null);
  });

  test('POST /api/auth/password/forgot dispatches token for registered user and stores hash only', async () => {
    clearLastSentEmail();

    const res = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(
      body.message,
      'Jika email terdaftar, tautan pengaturan ulang kata sandi telah dikirimkan.'
    );

    const sent = getLastSentEmail();
    assert.ok(sent);
    assert.equal(sent.to, testUser.email);
    assert.ok(sent.token);
    assert.equal(sent.token.length, 64); // 32 bytes hex = 64 characters

    // Verify raw token is NOT in database, only SHA-256 hash is stored
    const expectedHash = crypto.createHash('sha256').update(sent.token).digest('hex');
    const dbToken = await query(
      'SELECT id, user_id, token_hash, used, expires_at FROM password_reset_tokens WHERE token_hash = $1',
      [expectedHash]
    );
    assert.equal(dbToken.rowCount, 1);
    assert.equal(dbToken.rows[0].user_id, userId);
    assert.equal(dbToken.rows[0].used, false);
    assert.ok(new Date(dbToken.rows[0].expires_at) > new Date());

    // Verify querying by raw token returns nothing (raw token is never saved)
    const rawCheck = await query(
      'SELECT id FROM password_reset_tokens WHERE token_hash = $1',
      [sent.token]
    );
    assert.equal(rawCheck.rowCount, 0);
  });

  test('POST /api/auth/password/reset rejects invalid or malformed tokens', async () => {
    const invalidToken = '0'.repeat(64);
    const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        token: invalidToken,
        password: 'NewStrongPassword888!',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_TOKEN');
  });

  test('POST /api/auth/password/reset rejects passwords shorter than 8 characters', async () => {
    const sent = getLastSentEmail();
    assert.ok(sent);

    const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        token: sent.token,
        password: 'short',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('POST /api/auth/password/reset rejects expired tokens', async () => {
    // Generate an already-expired token in DB
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    const expiredHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
    const pastDate = new Date(Date.now() - 1000);

    await query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used) VALUES ($1, $2, $3, false)',
      [userId, expiredHash, pastDate]
    );

    const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        token: expiredRawToken,
        password: 'ValidPassword123!',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_TOKEN');
  });

  test('POST /api/auth/password/reset succeeds, updates password, and revokes all active sessions', async () => {
    // Request a fresh token
    clearLastSentEmail();
    await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email }),
    });

    const sent = getLastSentEmail();
    assert.ok(sent);

    const newPassword = 'BrandNewPassword999!';
    const resetRes = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        token: sent.token,
        password: newPassword,
      }),
    });

    assert.equal(resetRes.status, 200);
    const resetBody = await resetRes.json();
    assert.equal(
      resetBody.message,
      'Kata sandi berhasil diatur ulang. Silakan masuk kembali.'
    );

    // Old session MUST be revoked (User kicked out)
    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: userCookie },
    });
    assert.equal(sessionRes.status, 401);

    // Old password MUST fail login
    const oldLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: testUser.password }),
    });
    assert.equal(oldLoginRes.status, 401);

    // New password MUST succeed login
    const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email, password: newPassword }),
    });
    assert.equal(newLoginRes.status, 200);
    const newLoginBody = await newLoginRes.json();
    assert.equal(newLoginBody.user.id, userId);

    // Replay attack prevention: Re-using the same token MUST be rejected
    const replayRes = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUser.email,
        token: sent.token,
        password: 'AnotherPassword000!',
      }),
    });
    assert.equal(replayRes.status, 400);
    const replayBody = await replayRes.json();
    assert.equal(replayBody.error.code, 'INVALID_TOKEN');
  });
});
