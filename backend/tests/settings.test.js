/**
 * Unified Settings Module Integration Tests
 *
 * Covers:
 *  1. Profile & Account Settings (PATCH /api/users/me/profile)
 *  2. Email Change OTP Flow (POST /api/auth/email/change-request & /verify + security_events)
 *  3. Change Password (POST /api/auth/password + session revocation + MFA check)
 *  4. MFA Recovery Codes Regeneration (POST /api/auth/mfa/recovery-codes/regenerate)
 *  5. Active Sessions Listing & Revocation (GET/DELETE /api/auth/sessions)
 *  6. Chat Privacy Settings (GET/PATCH /api/users/me/privacy + reciprocal Last Seen + whoCanMessage)
 *  7. Blocked Users (GET /api/users/me/blocked + POST/DELETE /api/users/:userId/block)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../app.js';
import { query } from '../src/config/database.js';
import { connectRedis, closeRedis } from '../src/config/redis.js';
import { getLastSentEmail, clearLastSentEmail } from '../src/services/mailer.service.js';
import { generateTotp } from '../src/utils/mfa.js';

let server;
let baseUrl;

const ts = Date.now();
const USER_A = {
  username: `settings_alice_${ts}`,
  email: `settings_alice_${ts}@test.com`,
  password: 'AlicePassword123!',
};

const USER_B = {
  username: `settings_bob_${ts}`,
  email: `settings_bob_${ts}@test.com`,
  password: 'BobPassword123!',
};

let userAId = null;
let userBId = null;
let cookieA = null;
let cookieB = null;

async function flushRateLimitKeys() {
  try {
    const redis = await connectRedis();
    const keys = await redis.keys('ratelimit:*');
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch {
    // Redis optional in test environment
  }
}

async function loginAndGetCookie(email, password, headers = {}) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `Login for ${email} should succeed`);
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Session cookie should be issued');
  return cookie;
}

before(async () => {
  await flushRateLimitKeys();
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const regA = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    },
    body: JSON.stringify(USER_A),
  });
  assert.equal(regA.status, 201);
  cookieA = regA.headers.get('set-cookie')?.split(';')[0];
  const bodyA = await regA.json();
  userAId = bodyA.user.id;

  const regB = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Firefox/121.0',
    },
    body: JSON.stringify(USER_B),
  });
  assert.equal(regB.status, 201);
  cookieB = regB.headers.get('set-cookie')?.split(';')[0];
  const bodyB = await regB.json();
  userBId = bodyB.user.id;
});

after(async () => {
  if (userAId || userBId) {
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[userAId, userBId].filter(Boolean)]);
  }
  await flushRateLimitKeys();
  await closeRedis();
  await new Promise((resolve) => server.close(resolve));
});

describe('1. Profile & Account Settings — PATCH /api/users/me/profile', () => {
  test('updates nickname, bio, and username and reflects in GET /api/users/me', async () => {
    const newUsername = `alice_updated_${ts}`;
    const patchRes = await fetch(`${baseUrl}/api/users/me/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        nickname: 'Alice Wonderland',
        username: newUsername,
        bio: 'Enkripsi end-to-end selalu aktif.',
      }),
    });

    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.user.nickname, 'Alice Wonderland');
    assert.equal(patchBody.user.username, newUsername);
    assert.equal(patchBody.user.bio, 'Enkripsi end-to-end selalu aktif.');
    USER_A.username = newUsername;

    const meRes = await fetch(`${baseUrl}/api/users/me`, {
      headers: { Cookie: cookieA },
    });
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.user.nickname, 'Alice Wonderland');
    assert.equal(meBody.user.bio, 'Enkripsi end-to-end selalu aktif.');
  });

  test('rejects duplicate username with 409 CONFLICT and invalid nickname length with 400', async () => {
    const conflictRes = await fetch(`${baseUrl}/api/users/me/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({ username: USER_B.username }),
    });
    assert.equal(conflictRes.status, 409);

    const invalidRes = await fetch(`${baseUrl}/api/users/me/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({ nickname: 'A'.repeat(65) }),
    });
    assert.equal(invalidRes.status, 400);
  });
});

describe('2. Email Change OTP Flow — /api/auth/email/change-request & /verify', () => {
  test('verifies currentPassword, dispatches 6-digit OTP, updates email, and logs security_event', async () => {
    await flushRateLimitKeys();
    clearLastSentEmail();

    const wrongPassRes = await fetch(`${baseUrl}/api/auth/email/change-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        newEmail: `alice_new_${ts}@test.com`,
        currentPassword: 'WrongPassword!',
      }),
    });
    assert.equal(wrongPassRes.status, 401);

    const newEmail = `alice_new_${ts}@test.com`;
    const reqRes = await fetch(`${baseUrl}/api/auth/email/change-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        newEmail,
        currentPassword: USER_A.password,
      }),
    });
    assert.equal(reqRes.status, 200);

    const sent = getLastSentEmail();
    assert.ok(sent, 'OTP email should be sent');
    assert.equal(sent.to, newEmail);
    assert.match(sent.token, /^\d{6}$/);

    const verifyRes = await fetch(`${baseUrl}/api/auth/email/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({ token: sent.token }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.equal(verifyBody.user.email, newEmail);
    USER_A.email = newEmail;

    const eventsRes = await query(
      `SELECT event_type FROM security_events WHERE user_id = $1 AND LOWER(event_type) = 'email_changed'`,
      [userAId]
    );
    assert.equal(eventsRes.rowCount, 1);
  });
});

describe('3. Active Sessions & Change Password — /api/auth/sessions & /api/auth/password', () => {
  test('lists active sessions with pagination and revokes other sessions on password change', async () => {
    await flushRateLimitKeys();

    // Create a second active session for Alice on another device
    const secondCookie = await loginAndGetCookie(USER_A.email, USER_A.password, {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1.15',
    });

    // List sessions from primary cookieA
    const listRes = await fetch(`${baseUrl}/api/auth/sessions?limit=10&offset=0`, {
      headers: { Cookie: cookieA },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.ok(Array.isArray(listBody.sessions));
    assert.ok(listBody.sessions.length >= 2);
    assert.ok(listBody.pagination);
    assert.equal(listBody.sessions.some((s) => s.isCurrent), true);

    // Change password from cookieA — must keep cookieA active and revoke secondCookie
    const newPassword = 'AliceNewPassword456!';
    const passRes = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        currentPassword: USER_A.password,
        newPassword,
      }),
    });
    assert.equal(passRes.status, 200);
    USER_A.password = newPassword;

    // Primary session (cookieA) remains valid
    const primarySessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: cookieA },
    });
    assert.equal(primarySessionRes.status, 200);

    // Secondary session (secondCookie) is revoked (401)
    const secondarySessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: secondCookie },
    });
    assert.equal(secondarySessionRes.status, 401);

    // Verify security_events log
    const eventsRes = await query(
      `SELECT event_type FROM security_events WHERE user_id = $1 AND LOWER(event_type) = 'password_changed'`,
      [userAId]
    );
    assert.equal(eventsRes.rowCount, 1);
  });

  test('revokes specific session and terminates all other sessions via DELETE /api/auth/sessions', async () => {
    await flushRateLimitKeys();

    const extraCookie1 = await loginAndGetCookie(USER_A.email, USER_A.password);
    const extraCookie2 = await loginAndGetCookie(USER_A.email, USER_A.password);

    const listRes = await fetch(`${baseUrl}/api/auth/sessions`, {
      headers: { Cookie: cookieA },
    });
    const listBody = await listRes.json();
    const otherSessions = listBody.sessions.filter((s) => !s.isCurrent);
    assert.ok(otherSessions.length >= 2);

    // Revoke one specific session
    const revokeOneRes = await fetch(
      `${baseUrl}/api/auth/sessions/${encodeURIComponent(otherSessions[0].id)}`,
      {
        method: 'DELETE',
        headers: { Cookie: cookieA },
      }
    );
    assert.equal(revokeOneRes.status, 200);

    // Revoke all remaining other sessions
    const revokeAllRes = await fetch(`${baseUrl}/api/auth/sessions`, {
      method: 'DELETE',
      headers: { Cookie: cookieA },
    });
    assert.equal(revokeAllRes.status, 200);

    // Both extra cookies must now be 401
    const check1 = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: extraCookie1 },
    });
    const check2 = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: extraCookie2 },
    });
    assert.equal(check1.status, 401);
    assert.equal(check2.status, 401);
  });
});

describe('4. MFA Recovery Codes Regeneration — POST /api/auth/mfa/recovery-codes/regenerate', () => {
  test('enables MFA, returns recoveryCodesRemaining, and regenerates 10 new recovery codes', async () => {
    await flushRateLimitKeys();

    const setupRes = await fetch(`${baseUrl}/api/auth/mfa/setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({ password: USER_A.password }),
    });
    assert.equal(setupRes.status, 200);
    const { secret } = await setupRes.json();

    const nowMs = Date.now();
    const totpCode = generateTotp(secret, nowMs - 30_000);
    const enableRes = await fetch(`${baseUrl}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({ code: totpCode }),
    });
    assert.equal(enableRes.status, 200);
    const enableBody = await enableRes.json();
    assert.equal(enableBody.recoveryCodes.length, 10);
    assert.equal(enableBody.remainingRecoveryCodesCount, 10);

    // Regenerate recovery codes (using current time step > previous step)
    const regenCode = generateTotp(secret, nowMs);
    const regenRes = await fetch(`${baseUrl}/api/auth/mfa/recovery-codes/regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        password: USER_A.password,
        code: regenCode,
      }),
    });
    assert.equal(regenRes.status, 200);
    const regenBody = await regenRes.json();
    assert.equal(regenBody.recoveryCodes.length, 10);
    assert.equal(regenBody.remainingRecoveryCodesCount, 10);
    assert.notDeepEqual(regenBody.recoveryCodes, enableBody.recoveryCodes);

    // Disable MFA after test (using next adjacent time step)
    const disableRes = await fetch(`${baseUrl}/api/auth/mfa/disable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        password: USER_A.password,
        code: generateTotp(secret, nowMs + 30_000),
      }),
    });
    assert.equal(disableRes.status, 200);
  });
});

describe('5. Chat Privacy Settings & Blocked Users', () => {
  test('gets and updates privacy settings and enforces whoCanMessage & reciprocal lastSeenVisibility', async () => {
    const getRes = await fetch(`${baseUrl}/api/users/me/privacy`, {
      headers: { Cookie: cookieA },
    });
    assert.equal(getRes.status, 200);
    const initialBody = await getRes.json();
    assert.equal(initialBody.privacy.lastSeenVisibility, 'everyone');
    assert.equal(initialBody.privacy.readReceiptsEnabled, true);

    // Alice restricts whoCanMessage to 'friends' and lastSeenVisibility to 'nobody'
    const patchRes = await fetch(`${baseUrl}/api/users/me/privacy`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieA,
      },
      body: JSON.stringify({
        lastSeenVisibility: 'nobody',
        onlineVisibility: 'friends',
        readReceiptsEnabled: false,
        typingIndicatorEnabled: false,
        whoCanMessage: 'friends',
        defaultDisappearingTimer: 86400,
        securityChangeNotifications: true,
      }),
    });
    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.privacy.lastSeenVisibility, 'nobody');
    assert.equal(patchBody.privacy.readReceiptsEnabled, false);
    assert.equal(patchBody.privacy.whoCanMessage, 'friends');
    assert.equal(patchBody.privacy.defaultDisappearingTimer, 86400);

    // Bob (not a friend) tries to open a direct conversation with Alice -> 403 PRIVACY_RESTRICTED
    const convRes = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieB,
      },
      body: JSON.stringify({ userId: userAId }),
    });
    assert.equal(convRes.status, 403);
    const convErr = await convRes.json();
    assert.equal(convErr.error.code, 'PRIVACY_RESTRICTED');

    // Reciprocal rule: Alice set lastSeenVisibility = 'nobody', so Alice cannot see Bob's lastSeenAt
    const bobProfileRes = await fetch(`${baseUrl}/api/users/${userBId}`, {
      headers: { Cookie: cookieA },
    });
    assert.equal(bobProfileRes.status, 200);
    const bobProfile = await bobProfileRes.json();
    assert.equal(bobProfile.user.lastSeenAt, null);
  });

  test('blocks and unblocks user with paginated list and enforces block on friend requests & chats', async () => {
    // Alice blocks Bob
    const blockRes = await fetch(`${baseUrl}/api/users/${userBId}/block`, {
      method: 'POST',
      headers: { Cookie: cookieA },
    });
    assert.equal(blockRes.status, 201);

    // List blocked users with pagination
    const listRes = await fetch(`${baseUrl}/api/users/me/blocked?limit=20&offset=0`, {
      headers: { Cookie: cookieA },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.blockedUsers.length, 1);
    assert.equal(listBody.blockedUsers[0].user.id, userBId);
    assert.ok(listBody.pagination);

    // Bob tries to send friend request to Alice -> 403 USER_BLOCKED
    const friendReqRes = await fetch(`${baseUrl}/api/friends/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieB,
      },
      body: JSON.stringify({ userId: userAId }),
    });
    assert.equal(friendReqRes.status, 403);
    const friendErr = await friendReqRes.json();
    assert.equal(friendErr.error.code, 'USER_BLOCKED');

    // Alice unblocks Bob
    const unblockRes = await fetch(`${baseUrl}/api/users/${userBId}/block`, {
      method: 'DELETE',
      headers: { Cookie: cookieA },
    });
    assert.equal(unblockRes.status, 200);

    const listAfterRes = await fetch(`${baseUrl}/api/users/me/blocked?limit=20&offset=0`, {
      headers: { Cookie: cookieA },
    });
    const listAfterBody = await listAfterRes.json();
    assert.equal(listAfterBody.blockedUsers.length, 0);
  });
});
