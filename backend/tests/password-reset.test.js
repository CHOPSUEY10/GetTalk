/**
 * Password Reset Flow Tests (Issue #21 — 6-Digit OTP)
 *
 * Tests:
 *  1. Forgot — normal request (email exists) returns generic message + dispatches 6-digit OTP
 *  2. Forgot — email not registered returns exact same generic message (anti-enumeration)
 *  3. Forgot — stores only SHA-256 hash in DB, never raw 6-digit OTP
 *  4. Forgot — enforces Redis rate limit (max 3 requests / 15 min)
 *  5. Reset — success with valid 6-digit OTP, updates password, revokes active sessions
 *  6. Reset — supports both `newPassword` and `password` payload fields (frontend compatibility)
 *  7. Reset — rejects invalid/wrong OTP token
 *  8. Reset — rejects expired OTP token
 *  9. Reset — rejects replayed (already used) OTP token
 * 10. Validation — rejects missing fields and short passwords
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import app from '../app.js';
import { query } from '../src/config/database.js';
import { connectRedis, closeRedis } from '../src/config/redis.js';
import { getLastSentEmail, clearLastSentEmail } from '../src/services/mailer.service.js';

let server;
let baseUrl;

const TEST_USER = {
  username: `resetuser_${Date.now()}`,
  email: `resetuser_${Date.now()}@test.com`,
  password: 'OldPassword123!',
};
let testUserId = null;

/**
 * Flush all rate-limit keys for password reset so tests don't interfere
 * with each other.
 */
async function flushRateLimitKeys() {
  try {
    const redis = await connectRedis();
    const keys = await redis.keys('ratelimit:auth:password:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch {
    // Redis might not be available; tests using rate-limited endpoints
    // will fail-open anyway.
  }
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Register a test user
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(TEST_USER),
  });
  assert.equal(res.status, 201, 'Test user registration should succeed');
  const regBody = await res.json();
  testUserId = regBody.user.id;
});

after(async () => {
  // Cleanup test data
  await query(
    `DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE LOWER(email) = LOWER($1))`,
    [TEST_USER.email]
  );
  await query(`DELETE FROM users WHERE LOWER(email) = LOWER($1)`, [TEST_USER.email]);
  await flushRateLimitKeys();
  await closeRedis();
  await new Promise((resolve) => server.close(resolve));
});

describe('Password Reset — POST /api/auth/password/forgot', () => {
  test('returns generic message and dispatches 6-digit OTP when email exists (anti-enumeration)', async () => {
    await flushRateLimitKeys();
    clearLastSentEmail();

    const res = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      message: 'Jika email terdaftar, tautan pengaturan ulang kata sandi telah dikirimkan.',
    });

    // Verify 6-digit numeric OTP was dispatched via mailer and only SHA-256 hash stored in DB
    const sent = getLastSentEmail();
    assert.ok(sent, 'Email should be dispatched for registered user');
    assert.equal(sent.to, TEST_USER.email);
    assert.match(sent.token, /^\d{6}$/, 'Token must be a 6-digit numeric OTP');

    const expectedHash = crypto.createHash('sha256').update(sent.token).digest('hex');
    const dbToken = await query(
      `SELECT id, user_id, token_hash, used, expires_at
       FROM password_reset_tokens
       WHERE token_hash = $1 AND user_id = $2`,
      [expectedHash, testUserId]
    );
    assert.equal(dbToken.rowCount, 1);
    assert.equal(dbToken.rows[0].used, false);

    // Ensure raw OTP is never persisted in DB
    const rawCheck = await query(
      `SELECT id FROM password_reset_tokens WHERE token_hash = $1`,
      [sent.token]
    );
    assert.equal(rawCheck.rowCount, 0);
  });

  test('returns identical generic message when email does NOT exist (anti-enumeration)', async () => {
    await flushRateLimitKeys();
    clearLastSentEmail();

    const res = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent@noemail.com' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      message: 'Jika email terdaftar, tautan pengaturan ulang kata sandi telah dikirimkan.',
    });
    assert.equal(getLastSentEmail(), null, 'No email should be dispatched for unregistered address');
  });

  test('rejects request with missing or invalid email', async () => {
    await flushRateLimitKeys();
    const res = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('enforces Redis rate limit (max 3 requests per 15 minutes)', async () => {
    await flushRateLimitKeys();

    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${baseUrl}/api/auth/password/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_USER.email }),
      });
      assert.equal(res.status, 200);
    }

    const fourthRes = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });
    assert.equal(fourthRes.status, 429);
    const body = await fourthRes.json();
    assert.equal(body.error.code, 'TOO_MANY_REQUESTS');
  });
});

describe('Password Reset — POST /api/auth/password/reset', () => {
  test('successfully resets password with valid 6-digit OTP and revokes active sessions', async () => {
    await flushRateLimitKeys();
    clearLastSentEmail();

    // Establish an active session before password reset
    const loginBeforeRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    });
    assert.equal(loginBeforeRes.status, 200);
    const sessionCookie = loginBeforeRes.headers.get('set-cookie')?.split(';')[0];
    assert.ok(sessionCookie, 'Session cookie should be issued on login');

    // Step 1: Request a 6-digit OTP token
    const forgotRes = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });
    assert.equal(forgotRes.status, 200);
    const sent = getLastSentEmail();
    assert.ok(sent?.token, 'Should have dispatched a 6-digit OTP');
    assert.match(sent.token, /^\d{6}$/);

    // Step 2: Reset the password
    const newPassword = 'NewSecurePassword456!';
    const resetRes = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: sent.token,
        email: TEST_USER.email,
        newPassword,
      }),
    });

    assert.equal(resetRes.status, 200);
    const resetBody = await resetRes.json();
    assert.ok(resetBody.message.includes('berhasil'));

    // Step 3: Verify existing session was revoked (forced logout)
    const sessionCheckRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(sessionCheckRes.status, 401, 'Old session must be revoked after password reset');

    // Step 4: Verify the old password no longer works
    const loginOldRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    });
    assert.equal(loginOldRes.status, 401, 'Old password should be rejected');

    // Step 5: Verify the new password works
    const loginNewRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email, password: newPassword }),
    });
    assert.equal(loginNewRes.status, 200, 'New password should work');

    TEST_USER.password = newPassword;
  });

  test('rejects an invalid/wrong 6-digit OTP token', async () => {
    await flushRateLimitKeys();
    clearLastSentEmail();

    await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });
    const sent = getLastSentEmail();
    const wrongOtp = sent.token === '000000' ? '999999' : '000000';

    const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: wrongOtp,
        email: TEST_USER.email,
        newPassword: 'SomeNewPass123!',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_RESET_TOKEN');
  });

  test('rejects a replayed (already used) 6-digit OTP token', async () => {
    await flushRateLimitKeys();
    clearLastSentEmail();

    // Step 1: Request a 6-digit OTP
    const forgotRes = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });
    assert.equal(forgotRes.status, 200);
    const token = getLastSentEmail()?.token;
    assert.ok(token, 'Should have received a 6-digit OTP');

    // Step 2: Use it once (also testing `password` field compatibility for frontend)
    const newPassword = 'AfterReplay789!';
    const firstResetRes = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email: TEST_USER.email, password: newPassword }),
    });
    assert.equal(firstResetRes.status, 200);

    // Step 3: Try to use the same OTP again (replay — should fail)
    const replayRes = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email: TEST_USER.email, newPassword: 'AnotherPass000!' }),
    });
    assert.equal(replayRes.status, 400);
    const body = await replayRes.json();
    assert.equal(body.error.code, 'INVALID_RESET_TOKEN');

    TEST_USER.password = newPassword;
  });

  test('rejects expired 6-digit OTP token', async () => {
    await flushRateLimitKeys();
    clearLastSentEmail();

    // Step 1: Request a 6-digit OTP
    const forgotRes = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });
    assert.equal(forgotRes.status, 200);
    const token = getLastSentEmail()?.token;
    assert.ok(token, 'Should have received a 6-digit OTP');

    // Step 2: Manually expire the token in the database
    await query(
      `UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1 AND used = FALSE`,
      [testUserId]
    );

    // Step 3: Try to use the expired OTP
    const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        email: TEST_USER.email,
        newPassword: 'ExpiredTokenPass!',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_RESET_TOKEN');
  });

  test('rejects reset with missing fields', async () => {
    await flushRateLimitKeys();
    const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '123456' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects reset with short password', async () => {
    await flushRateLimitKeys();
    const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: '123456',
        email: TEST_USER.email,
        newPassword: 'short',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });
});
