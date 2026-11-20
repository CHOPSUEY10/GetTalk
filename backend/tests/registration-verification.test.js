/**
 * Full Registration Email OTP Verification Flow Tests
 *
 * Tests the complete flow:
 *   registrasi -> verifikasi akun email dengan kode otp -> login
 *
 * Uses an in-memory SQL double over `pool.query` + in-memory session store so
 * every route, validator, controller, service, repository, middleware, and
 * mailer integration runs deterministically even without external PostgreSQL.
 */

process.env.USE_MEMORY_SESSION = 'true';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import pool from '../src/config/database.js';
import { connectRedis, closeRedis } from '../src/config/redis.js';
import {
  getLastSentEmail,
  clearLastSentEmail,
} from '../src/services/mailer.service.js';
import { authenticate } from '../src/middleware/auth.middleware.js';
import { hashRegistrationOtp } from '../src/services/auth.service.js';

let app;
let server;
let baseUrl;
let originalPoolQuery;

/** @type {Map<string, any>} */
const usersById = new Map();
/** @type {Map<string, any>} */
const sessionsBySid = new Map();
/** @type {Array<any>} */
const securityEvents = [];

function resetInMemoryDb() {
  usersById.clear();
  sessionsBySid.clear();
  securityEvents.length = 0;
}

function findUserByEmailMem(rawEmail) {
  const target = String(rawEmail || '').trim().toLowerCase();
  for (const user of usersById.values()) {
    if (String(user.email).trim().toLowerCase() === target) {
      return user;
    }
  }
  return null;
}

function findUserByUsernameMem(username) {
  for (const user of usersById.values()) {
    if (user.username === username) {
      return user;
    }
  }
  return null;
}

function withLockRemaining(user) {
  if (!user) return null;
  const now = Date.now();
  const lockMs = user.login_locked_until ? new Date(user.login_locked_until).getTime() : 0;
  const remaining = lockMs > now ? Math.max(1, Math.ceil((lockMs - now) / 1000)) : 0;
  return {
    ...user,
    login_lock_remaining_seconds: remaining,
  };
}

function installMockPoolQuery() {
  originalPoolQuery = pool.query.bind(pool);
  pool.query = async (text, params = []) => {
    const sql = String(text).replace(/\s+/g, ' ').trim();

    // SELECT user by id
    if (/^SELECT .+ FROM users WHERE id = \$1$/i.test(sql)) {
      const user = usersById.get(params[0]);
      return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
    }

    // SELECT user by email (case-insensitive)
    if (/^SELECT .+ FROM users WHERE LOWER\(TRIM\(email\)\) = LOWER\(TRIM\(\$1\)\)$/i.test(sql)) {
      const user = findUserByEmailMem(params[0]);
      return { rows: user ? [withLockRemaining(user)] : [], rowCount: user ? 1 : 0 };
    }

    // SELECT user by username
    if (/^SELECT .+ FROM users WHERE username = \$1$/i.test(sql)) {
      const user = findUserByUsernameMem(params[0]);
      return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
    }

    // INSERT INTO users
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
      const now = new Date();
      const id = crypto.randomUUID();
      const row = {
        id,
        username,
        email,
        password_hash: passwordHash,
        nickname: nickname ?? null,
        bio: bio ?? null,
        last_seen_at: null,
        email_verified: Boolean(emailVerified),
        email_verified_at: emailVerified ? now : null,
        email_verification_token_hash: tokenHash ?? null,
        email_verification_expires_at: expiresAt ? new Date(expiresAt) : null,
        email_verification_attempts: 0,
        mfa_secret: null,
        mfa_enabled: false,
        mfa_recovery_codes: [],
        mfa_last_totp_step: -1n,
        failed_login_attempts: 0,
        login_locked_until: null,
        pending_email: null,
        email_change_token_hash: null,
        email_change_expires_at: null,
        created_at: now,
        updated_at: now,
      };
      usersById.set(id, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // DELETE unverified user (rollback)
    if (/^DELETE FROM users WHERE id = \$1 AND email_verified = FALSE$/i.test(sql)) {
      const user = usersById.get(params[0]);
      if (user && !user.email_verified) {
        usersById.delete(params[0]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // UPDATE setEmailVerificationToken
    if (
      /^UPDATE users SET email_verification_token_hash = \$2, email_verification_expires_at = \$3, email_verification_attempts = \$4/i.test(
        sql
      )
    ) {
      const [userId, tokenHash, expiresAt, attempts] = params;
      const user = usersById.get(userId);
      if (!user || user.email_verified) return { rows: [], rowCount: 0 };
      user.email_verification_token_hash = tokenHash ?? null;
      user.email_verification_expires_at = expiresAt ? new Date(expiresAt) : null;
      user.email_verification_attempts = attempts ?? 0;
      user.updated_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    // UPDATE incrementEmailVerificationAttempts
    if (/^UPDATE users SET email_verification_attempts = email_verification_attempts \+ 1/i.test(sql)) {
      const [userId, maxAttempts] = params;
      const user = usersById.get(userId);
      if (!user || user.email_verified) return { rows: [], rowCount: 0 };
      user.email_verification_attempts += 1;
      if (user.email_verification_attempts >= maxAttempts) {
        user.email_verification_token_hash = null;
        user.email_verification_expires_at = null;
      }
      user.updated_at = new Date();
      return {
        rows: [{ email_verification_attempts: user.email_verification_attempts }],
        rowCount: 1,
      };
    }

    // UPDATE confirmEmailVerification
    if (/^UPDATE users SET email_verified = TRUE, email_verified_at = NOW\(\)/i.test(sql)) {
      const [userId, tokenHash] = params;
      const user = usersById.get(userId);
      if (
        !user ||
        user.email_verified ||
        user.email_verification_token_hash !== tokenHash ||
        !user.email_verification_expires_at ||
        new Date(user.email_verification_expires_at) <= new Date()
      ) {
        return { rows: [], rowCount: 0 };
      }
      user.email_verified = true;
      user.email_verified_at = new Date();
      user.email_verification_token_hash = null;
      user.email_verification_expires_at = null;
      user.email_verification_attempts = 0;
      user.updated_at = new Date();
      return { rows: [{ ...user }], rowCount: 1 };
    }

    // UPDATE recordFailedLogin
    if (/^UPDATE users SET failed_login_attempts = CASE/i.test(sql)) {
      const user = usersById.get(params[0]);
      if (!user) return { rows: [], rowCount: 0 };
      const now = Date.now();
      const lockedUntilMs = user.login_locked_until ? new Date(user.login_locked_until).getTime() : 0;
      if (lockedUntilMs > now) {
        return {
          rows: [
            {
              failed_login_attempts: user.failed_login_attempts,
              login_locked_until: user.login_locked_until,
              retry_after_seconds: Math.max(1, Math.ceil((lockedUntilMs - now) / 1000)),
            },
          ],
          rowCount: 1,
        };
      }
      user.failed_login_attempts = Math.min(user.failed_login_attempts + 1, 3);
      if (user.failed_login_attempts >= 3) {
        user.login_locked_until = new Date(now + 60_000);
      }
      const nextLockMs = user.login_locked_until ? new Date(user.login_locked_until).getTime() : 0;
      return {
        rows: [
          {
            failed_login_attempts: user.failed_login_attempts,
            login_locked_until: user.login_locked_until,
            retry_after_seconds:
              nextLockMs > now ? Math.max(1, Math.ceil((nextLockMs - now) / 1000)) : 0,
          },
        ],
        rowCount: 1,
      };
    }

    // UPDATE resetFailedLogins
    if (/^UPDATE users SET failed_login_attempts = 0, login_locked_until = NULL/i.test(sql)) {
      const user = usersById.get(params[0]);
      if (user) {
        user.failed_login_attempts = 0;
        user.login_locked_until = null;
      }
      return { rows: [], rowCount: user ? 1 : 0 };
    }

    // INSERT INTO security_events
    if (/^INSERT INTO security_events/i.test(sql)) {
      securityEvents.push({
        userId: params[0],
        eventType: params[1],
        ipAddress: params[2],
        metadata: params[3],
      });
      return { rows: [{ id: crypto.randomUUID() }], rowCount: 1 };
    }

    // sessions select / upsert / delete
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

    throw new Error(`Unhandled mock SQL query: ${sql}`);
  };
}

before(async () => {
  installMockPoolQuery();
  ({ default: app } = await import('../app.js'));

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

async function flushAuthRateLimits() {
  try {
    const redis = await connectRedis();
    const keys = await redis.keys('ratelimit:auth:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch {
    // Redis optional
  }
}

after(async () => {
  if (originalPoolQuery) {
    pool.query = originalPoolQuery;
  }
  await flushAuthRateLimits();
  await closeRedis();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

beforeEach(async () => {
  resetInMemoryDb();
  clearLastSentEmail();
  await flushAuthRateLimits();
});

describe('Registration -> Email OTP Verification -> Login Flow', () => {
  test('complete happy path: register (unverified, no session) -> verify OTP -> login -> session', async () => {
    const email = 'Alice.Test@Example.com';
    const normalizedEmail = 'alice.test@example.com';
    const password = 'StrongPassword123!';

    // 1. Register creates an unverified user, hashes password & OTP, sends 6-digit OTP, and sets NO session
    const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'alice_verify',
        email,
        password,
      }),
    });

    assert.equal(registerRes.status, 201);
    const registerBody = await registerRes.json();
    assert.equal(registerBody.verificationRequired, true);
    assert.equal(registerBody.expiresInSeconds, 900);
    assert.equal(registerBody.user.username, 'alice_verify');
    assert.equal(registerBody.user.email, normalizedEmail);
    assert.equal(registerBody.user.emailVerified, false);

    // Must not issue an authenticated session on register
    const registerCookies = registerRes.headers.getSetCookie();
    assert.equal(registerCookies.length, 0);

    // Verify 6-digit OTP was dispatched via mailer and only its SHA-256 hash is stored in DB
    const sent = getLastSentEmail();
    assert.ok(sent);
    assert.equal(sent.to, normalizedEmail);
    assert.equal(sent.purpose, 'registration_verification');
    assert.match(sent.token, /^\d{6}$/);

    const storedUser = usersById.get(registerBody.user.id);
    assert.equal(storedUser.email_verified, false);
    assert.equal(
      storedUser.email_verification_token_hash,
      hashRegistrationOtp(normalizedEmail, sent.token)
    );
    assert.notEqual(storedUser.email_verification_token_hash, sent.token);

    // 2. Duplicate registration is rejected with 409 USER_ALREADY_EXISTS
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'alice_other',
        email: normalizedEmail,
        password,
      }),
    });
    assert.equal(dupRes.status, 409);
    assert.equal((await dupRes.json()).error.code, 'USER_ALREADY_EXISTS');

    // 3. Wrong password before verification returns 401 INVALID_CREDENTIALS (no email-verification leak)
    const wrongPassBeforeVerify = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, password: 'WrongPassword123!' }),
    });
    assert.equal(wrongPassBeforeVerify.status, 401);
    assert.equal((await wrongPassBeforeVerify.json()).error.code, 'INVALID_CREDENTIALS');

    // 4. Correct password BEFORE verification is blocked with 403 EMAIL_NOT_VERIFIED and NO session cookie
    const unverifiedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, password }),
    });
    assert.equal(unverifiedLogin.status, 403);
    assert.equal((await unverifiedLogin.json()).error.code, 'EMAIL_NOT_VERIFIED');
    assert.equal(unverifiedLogin.headers.getSetCookie().length, 0);

    // 5. Verify email with valid 6-digit OTP activates the account without auto-logging in
    const verifyRes = await fetch(`${baseUrl}/api/auth/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, otp: sent.token }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.equal(verifyBody.verified, true);
    assert.equal(verifyBody.user.emailVerified, true);
    assert.equal(verifyRes.headers.getSetCookie().length, 0);
    assert.equal(storedUser.email_verified, true);
    assert.equal(storedUser.email_verification_token_hash, null);

    // 6. Replaying the same OTP fails with 400 INVALID_OTP_TOKEN
    const replayRes = await fetch(`${baseUrl}/api/auth/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, otp: sent.token }),
    });
    assert.equal(replayRes.status, 400);
    assert.equal((await replayRes.json()).error.code, 'INVALID_OTP_TOKEN');

    // 7. Login AFTER verification succeeds and issues a valid authenticated session
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, password }),
    });
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.user.id, registerBody.user.id);
    assert.equal(loginBody.user.emailVerified, true);

    const [sessionCookie] = loginRes.headers.getSetCookie();
    assert.ok(sessionCookie, 'Session cookie must be issued on verified login');

    // 8. GET /api/auth/session resolves the verified user
    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: sessionCookie.split(';')[0] },
    });
    assert.equal(sessionRes.status, 200);
    const sessionBody = await sessionRes.json();
    assert.equal(sessionBody.user.id, registerBody.user.id);
    assert.equal(sessionBody.user.emailVerified, true);

    // Verify audit trail recorded registration + verification
    const eventTypes = securityEvents.map((e) => e.eventType);
    assert.ok(eventTypes.includes('USER_REGISTERED_PENDING_VERIFICATION'));
    assert.ok(eventTypes.includes('EMAIL_VERIFIED'));
  });

  test('rejects wrong OTP, invalidates after 5 failed attempts, and supports resend OTP', async () => {
    const email = 'bob_otp@example.com';
    const password = 'StrongPassword123!';

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob_otp', email, password }),
    });
    assert.equal(regRes.status, 201);
    const { user } = await regRes.json();
    const initialOtp = getLastSentEmail().token;
    const wrongOtp = initialOtp === '000000' ? '999999' : '000000';

    // First 4 wrong attempts -> 400 INVALID_OTP_TOKEN
    for (let i = 1; i <= 4; i += 1) {
      const res = await fetch(`${baseUrl}/api/auth/register/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: wrongOtp }),
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error.code, 'INVALID_OTP_TOKEN');
    }

    // 5th wrong attempt -> invalidates OTP and returns 400 OTP_TOKEN_EXPIRED
    const fifthRes = await fetch(`${baseUrl}/api/auth/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: wrongOtp }),
    });
    assert.equal(fifthRes.status, 400);
    assert.equal((await fifthRes.json()).error.code, 'OTP_TOKEN_EXPIRED');
    assert.equal(usersById.get(user.id).email_verification_token_hash, null);

    // Even the previously valid OTP no longer works after lockout invalidation
    const staleRes = await fetch(`${baseUrl}/api/auth/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: initialOtp }),
    });
    assert.equal(staleRes.status, 400);
    assert.equal((await staleRes.json()).error.code, 'INVALID_OTP_TOKEN');

    // Resend OTP issues a brand-new 6-digit OTP and resets attempts
    clearLastSentEmail();
    const resendRes = await fetch(`${baseUrl}/api/auth/register/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.equal(resendRes.status, 200);
    const resent = getLastSentEmail();
    assert.ok(resent);
    assert.equal(resent.to, email);
    assert.match(resent.token, /^\d{6}$/);
    assert.equal(usersById.get(user.id).email_verification_attempts, 0);

    // New OTP succeeds
    const verifyRes = await fetch(`${baseUrl}/api/auth/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token: resent.token }),
    });
    assert.equal(verifyRes.status, 200);
    assert.equal((await verifyRes.json()).verified, true);
  });

  test('rejects expired OTP with 400 OTP_TOKEN_EXPIRED', async () => {
    const email = 'expired_otp@example.com';

    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'expired_user',
        email,
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(regRes.status, 201);
    const { user } = await regRes.json();
    const otp = getLastSentEmail().token;

    // Force expiry in DB
    usersById.get(user.id).email_verification_expires_at = new Date(Date.now() - 60_000);

    const verifyRes = await fetch(`${baseUrl}/api/auth/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp }),
    });
    assert.equal(verifyRes.status, 400);
    assert.equal((await verifyRes.json()).error.code, 'OTP_TOKEN_EXPIRED');
  });

  test('resend OTP prevents user enumeration for unknown or already verified emails', async () => {
    // Unknown email returns generic 200 without sending email
    const unknownRes = await fetch(`${baseUrl}/api/auth/register/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'doesnotexist@example.com' }),
    });
    assert.equal(unknownRes.status, 200);
    assert.equal(getLastSentEmail(), null);

    // Already verified account also returns identical generic 200 without sending email
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'already_verified',
        email: 'verified@example.com',
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(regRes.status, 201);
    const otp = getLastSentEmail().token;
    const verifyRes = await fetch(`${baseUrl}/api/auth/register/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'verified@example.com', otp }),
    });
    assert.equal(verifyRes.status, 200);

    clearLastSentEmail();
    const alreadyRes = await fetch(`${baseUrl}/api/auth/register/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'verified@example.com' }),
    });
    assert.equal(alreadyRes.status, 200);
    assert.equal(getLastSentEmail(), null);
  });

  test('authenticate middleware rejects unverified users even if a session references their userId', async () => {
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'unverified_guard',
        email: 'guard@example.com',
        password: 'StrongPassword123!',
      }),
    });
    assert.equal(regRes.status, 201);
    const { user } = await regRes.json();

    let destroyed = false;
    const req = {
      sessionID: 'fake-sid',
      session: {
        userId: user.id,
        destroy(cb) {
          destroyed = true;
          cb?.();
        },
      },
    };

    const err = await new Promise((resolve) => {
      authenticate(req, {}, (e) => resolve(e));
    });

    assert.ok(err);
    assert.equal(err.statusCode, 401);
    assert.equal(err.code, 'UNAUTHORIZED');
    assert.equal(destroyed, true);
  });
});
