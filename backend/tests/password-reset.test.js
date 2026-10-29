/**
 * Password Reset Flow Tests (Issue #21)
 *
 * Tests:
 *  1. Forgot — normal request (email exists) returns generic message + token
 *  2. Forgot — email not registered returns same generic message (anti-enumeration)
 *  3. Reset — success with valid token and new password
 *  4. Reset — reject invalid/wrong token
 *  5. Reset — reject expired token
 *  6. Reset — reject replayed (already used) token
 *  7. Validation — reject missing fields
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../app.js';
import { query } from '../src/config/database.js';
import { connectRedis, closeRedis } from '../src/config/redis.js';

let server;
let baseUrl;

const TEST_USER = {
  username: `resetuser_${Date.now()}`,
  email: `resetuser_${Date.now()}@test.com`,
  password: 'OldPassword123!',
};

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
});

after(async () => {
  // Cleanup test data
  await query(
    `DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)`,
    [TEST_USER.email]
  );
  await query(`DELETE FROM users WHERE email = $1`, [TEST_USER.email]);
  await closeRedis();
  await new Promise((resolve) => server.close(resolve));
});

describe('Password Reset — POST /api/auth/password/forgot', () => {
  test('returns generic message when email exists (anti-enumeration)', async () => {
    await flushRateLimitKeys();
    const res = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(
      body.message,
      'Jika email terdaftar, tautan pengaturan ulang kata sandi telah dikirimkan.'
    );
    // In test/dev env, the raw token is returned for testing
    assert.ok(body._devToken, 'Dev token should be present in non-production');
    assert.equal(typeof body._devToken, 'string');
    assert.ok(body._devToken.length >= 64, 'Token should be at least 64 hex chars (32 bytes)');
  });

  test('returns same generic message when email does NOT exist (anti-enumeration)', async () => {
    await flushRateLimitKeys();
    const res = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent@noemail.com' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(
      body.message,
      'Jika email terdaftar, tautan pengaturan ulang kata sandi telah dikirimkan.'
    );
    // Should NOT have a dev token since user doesn't exist
    assert.equal(body._devToken, undefined);
  });

  test('rejects request with missing email', async () => {
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
});

describe('Password Reset — POST /api/auth/password/reset', () => {
  test('successfully resets password with valid token', async () => {
    await flushRateLimitKeys();

    // Step 1: Request a reset token
    const forgotRes = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });
    const forgotBody = await forgotRes.json();
    const token = forgotBody._devToken;
    assert.ok(token, 'Should have received a dev token');

    // Step 2: Reset the password
    const newPassword = 'NewSecurePassword456!';
    const resetRes = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        email: TEST_USER.email,
        newPassword,
      }),
    });

    assert.equal(resetRes.status, 200);
    const resetBody = await resetRes.json();
    assert.ok(resetBody.message.includes('berhasil'));

    // Step 3: Verify the old password no longer works
    const loginOldRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
    });
    assert.equal(loginOldRes.status, 401, 'Old password should be rejected');

    // Step 4: Verify the new password works
    const loginNewRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email, password: newPassword }),
    });
    assert.equal(loginNewRes.status, 200, 'New password should work');

    // Update test state for subsequent tests
    TEST_USER.password = newPassword;
  });

  test('rejects an invalid/wrong token', async () => {
    await flushRateLimitKeys();

    const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'a'.repeat(64),
        email: TEST_USER.email,
        newPassword: 'SomeNewPass123!',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'INVALID_RESET_TOKEN');
  });

  test('rejects a replayed (already used) token', async () => {
    await flushRateLimitKeys();

    // Step 1: Get a token
    const forgotRes = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });
    const forgotBody = await forgotRes.json();
    assert.equal(forgotRes.status, 200);
    const token = forgotBody._devToken;
    assert.ok(token, 'Should have received a dev token');

    // Step 2: Use it once (should succeed)
    const newPassword = 'AfterReplay789!';
    const firstResetRes = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email: TEST_USER.email, newPassword }),
    });
    assert.equal(firstResetRes.status, 200);

    // Step 3: Try to use the same token again (replay — should fail)
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

  test('rejects expired token', async () => {
    await flushRateLimitKeys();

    // Step 1: Get a token
    const forgotRes = await fetch(`${baseUrl}/api/auth/password/forgot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_USER.email }),
    });
    const forgotBody = await forgotRes.json();
    assert.equal(forgotRes.status, 200);
    const token = forgotBody._devToken;
    assert.ok(token, 'Should have received a dev token');

    // Step 2: Manually expire the token in the database
    await query(
      `UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE used = FALSE`
    );

    // Step 3: Try to use the expired token
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
    const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'abc' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('rejects reset with short password', async () => {
    const res = await fetch(`${baseUrl}/api/auth/password/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'a'.repeat(64),
        email: TEST_USER.email,
        newPassword: 'short',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });
});
