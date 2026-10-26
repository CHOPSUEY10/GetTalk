import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../app.js';
import { query } from '../src/config/database.js';
import { closeRedis } from '../src/config/redis.js';

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

describe('Health and System Endpoints', () => {
  test('GET /health returns 200 with status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: 'ok' });
  });

  test('GET / returns backend info', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'GetTalk Backend');
    assert.equal(body.status, 'running');
  });

  test('GET /unknown-route returns 404 with standard error envelope', async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error);
    assert.equal(body.error.code, 'ROUTE_NOT_FOUND');
  });
});

describe('Authentication API & Validation', () => {
  test('POST /api/auth/register fails validation on missing fields', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('POST /api/auth/register fails validation on weak password (< 8 chars)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'alice',
        email: 'alice@example.com',
        password: 'short',
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.match(body.error.message, /8 characters/i);
  });

  test('POST /api/auth/login fails validation on missing email or password', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('GET /api/auth/session returns 401 when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/auth/session`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  test('POST /api/auth/logout returns 204 even when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    assert.equal(res.status, 204);
  });

  test('register → session → login round trip persists to the database', async () => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const username = `e2e_${suffix}`;
    const email = `e2e_${suffix}@example.com`;
    const password = 'correct-horse-battery';

    const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    assert.equal(registerRes.status, 201);
    const { user } = await registerRes.json();
    assert.equal(user.username, username);
    assert.ok(user.id);

    const [cookie] = registerRes.headers.getSetCookie();

    try {
      // The account must exist as a row, with the password stored only as a hash.
      const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      assert.equal(rows.length, 1, 'registered user was not persisted');
      assert.notEqual(rows[0].password_hash, password);
      assert.match(rows[0].password_hash, /^\$2[aby]\$/);

      // The session written by register must resolve back to the same user.
      const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { Cookie: cookie },
      });
      assert.equal(sessionRes.status, 200);
      assert.equal((await sessionRes.json()).user.id, user.id);

      // Wrong password is rejected.
      const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-password' }),
      });
      assert.equal(badLogin.status, 401);

      const secondBadLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-password' }),
      });
      assert.equal(secondBadLogin.status, 401);

      const thirdBadLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-password' }),
      });
      assert.equal(thirdBadLogin.status, 429);
      assert.equal((await thirdBadLogin.json()).error.code, 'LOGIN_LOCKED');
      const retryAfter = Number(thirdBadLogin.headers.get('retry-after'));
      assert.ok(retryAfter > 0 && retryAfter <= 60);

      const lockedLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(lockedLogin.status, 429);

      await query(
        'UPDATE users SET login_locked_until = NOW() - INTERVAL \'1 second\' WHERE id = $1',
        [user.id]
      );

      // Correct password logs in.
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(loginRes.status, 200);
      assert.equal((await loginRes.json()).user.id, user.id);
      const { rows: loginState } = await query(
        'SELECT failed_login_attempts, login_locked_until FROM users WHERE id = $1',
        [user.id]
      );
      assert.equal(loginState[0].failed_login_attempts, 0);
      assert.equal(loginState[0].login_locked_until, null);
    } finally {
      await query(`DELETE FROM sessions WHERE sess->>'userId' = $1`, [user.id]);
      await query('DELETE FROM users WHERE id = $1', [user.id]);
    }
  });
});

describe('Authorization Protection (Unauthenticated Requests Rejected)', () => {
  test('GET /api/users/me returns 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/users/me`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  test('GET /api/friends returns 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/friends`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  test('GET /api/conversations returns 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/conversations`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  test('GET /api/conversations/conv-123/messages returns 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv-123/messages`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  test('GET /api/attachments/att-123 returns 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/attachments/att-123`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  test('POST /api/friends/requests returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/friends/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'some-id' }),
    });
    assert.equal(res.status, 401);
  });

  test('POST /api/friends/requests/:id/accept returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/friends/requests/req-1/accept`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  test('POST /api/friends/requests/:id/reject returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/friends/requests/req-1/reject`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  test('DELETE /api/friends/:userId returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/friends/usr-1`, { method: 'DELETE' });
    assert.equal(res.status, 401);
  });

  test('POST /api/conversations returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr-1' }),
    });
    assert.equal(res.status, 401);
  });

  test('GET /api/conversations/:id returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv-1`);
    assert.equal(res.status, 401);
  });

  test('POST /api/conversations/:id/messages returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/conv-1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyCiphertext: 'abc', nonce: '123' }),
    });
    assert.equal(res.status, 401);
  });

  test('PATCH /api/messages/:id returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/messages/msg-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyCiphertext: 'abc', nonce: '123' }),
    });
    assert.equal(res.status, 401);
  });

  test('DELETE /api/messages/:id returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/messages/msg-1`, { method: 'DELETE' });
    assert.equal(res.status, 401);
  });

  test('POST /api/messages/:id/receipt returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/messages/msg-1/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' }),
    });
    assert.equal(res.status, 401);
  });

  test('POST /api/attachments returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalName: 'doc.enc', mimeType: 'text/plain', sizeBytes: 100 }),
    });
    assert.equal(res.status, 401);
  });

  test('DELETE /api/attachments/:id returns 401 Unauthorized when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/attachments/att-1`, { method: 'DELETE' });
    assert.equal(res.status, 401);
  });
});

describe('E2EE and Data Minimization Validation', () => {
  test('Message validation rejects plaintext body per contract §9', async () => {
    const { validateSendMessage } = await import('../src/validators/messages.validator.js');
    const result = validateSendMessage({
      body: 'Hello plaintext',
    });
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /plaintext message content is strictly forbidden/i);
  });

  test('Message validation accepts ciphertext and nonce', async () => {
    const { validateSendMessage } = await import('../src/validators/messages.validator.js');
    const result = validateSendMessage({
      bodyCiphertext: 'dGVzdA==',
      nonce: 'bm9uY2U=',
      clientMessageId: 'client-1',
    });
    assert.equal(result.valid, true);
  });

  test('Receipt validation rejects invalid status', async () => {
    const { validateReceipt } = await import('../src/validators/messages.validator.js');
    const result = validateReceipt({ status: 'invalid_status' });
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /delivered/i);
  });

  test('Receipt validation accepts delivered and read', async () => {
    const { validateReceipt } = await import('../src/validators/messages.validator.js');
    assert.equal(validateReceipt({ status: 'delivered' }).valid, true);
    assert.equal(validateReceipt({ status: 'read' }).valid, true);
  });
});
