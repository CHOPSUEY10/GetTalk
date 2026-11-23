import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../app.js';
import {
  clearKillSwitchCache,
  fetchUpstashKey,
  isChatBackendEnabled,
  parseKillSwitchValue,
  setKillSwitchReaderForTests,
} from '../src/services/kill-switch.service.js';
import { createKillSwitchMiddleware } from '../src/middleware/kill-switch.middleware.js';
import { socketKillSwitch } from '../src/socket/middleware.js';
import { SERVICE_UNAVAILABLE } from '../src/errors/error-codes.js';

let server;
let baseUrl;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterEach(() => {
  setKillSwitchReaderForTests(null);
  clearKillSwitchCache();
});

after(async () => {
  setKillSwitchReaderForTests(null);
  await new Promise((resolve) => server.close(resolve));
});

describe('Chat Server Kill Switch — Unit Tests', () => {
  test('parseKillSwitchValue handles active, inactive, and unset states accurately', () => {
    assert.equal(parseKillSwitchValue('true'), true);
    assert.equal(parseKillSwitchValue('TRUE'), true);
    assert.equal(parseKillSwitchValue('1'), true);
    assert.equal(parseKillSwitchValue(null), true);
    assert.equal(parseKillSwitchValue(undefined), true);
    assert.equal(parseKillSwitchValue(''), true);

    assert.equal(parseKillSwitchValue('false'), false);
    assert.equal(parseKillSwitchValue('FALSE'), false);
    assert.equal(parseKillSwitchValue(' false '), false);
    assert.equal(parseKillSwitchValue('0'), false);
    assert.equal(parseKillSwitchValue(false), false);
  });

  test('createKillSwitchMiddleware allows traffic when enabled and returns 503 when disabled', async () => {
    let enabled = true;
    const mw = createKillSwitchMiddleware({ isEnabled: async () => enabled });

    let nextCalled = false;
    let statusCode = 200;
    let jsonBody = null;
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return this;
      },
    };

    await mw({}, mockRes, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(statusCode, 200);

    nextCalled = false;
    enabled = false;
    await mw({}, mockRes, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 503);
    assert.equal(jsonBody?.error?.code, SERVICE_UNAVAILABLE);
  });

  test('fetchUpstashKey queries Upstash REST API with GET command and Bearer token', async () => {
    let receivedAuth = '';
    let receivedBody = null;
    let mockState = 'false';

    const upstashServer = http.createServer((req, res) => {
      receivedAuth = req.headers.authorization || '';
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: mockState }));
      });
    });

    await new Promise((resolve) => upstashServer.listen(0, '127.0.0.1', resolve));
    const upstashUrl = `http://127.0.0.1:${upstashServer.address().port}`;

    try {
      const valOff = await fetchUpstashKey(upstashUrl, 'TEST_UPSTASH_TOKEN_123', 'siem:backend:enabled');
      assert.equal(receivedAuth, 'Bearer TEST_UPSTASH_TOKEN_123');
      assert.deepEqual(receivedBody, ['GET', 'siem:backend:enabled']);
      assert.equal(valOff, 'false');

      mockState = 'true';
      const valOn = await fetchUpstashKey(upstashUrl, 'TEST_UPSTASH_TOKEN_123', 'siem:backend:enabled');
      assert.equal(valOn, 'true');
    } finally {
      await new Promise((resolve) => upstashServer.close(resolve));
    }
  });
});

describe('Chat Server Kill Switch — Integration & Security Tests', () => {
  test('Chat Server /api/* returns 503 when SecAdmin disables kill switch and recovers when re-enabled', async () => {
    const redisMap = new Map([['siem:backend:enabled', 'true']]);
    setKillSwitchReaderForTests(async (key) => redisMap.get(key) ?? null);

    // 1. Active state: /api/users/me proceeds to auth middleware (401 Unauthorized, not 503)
    const activeRes = await fetch(`${baseUrl}/api/users/me`);
    assert.equal(activeRes.status, 401);

    // 2. SecAdmin toggles kill switch OFF in shared Upstash Redis
    redisMap.set('siem:backend:enabled', 'false');

    for (const ep of [
      '/api/users/me',
      '/api/conversations',
      '/api/friends',
      '/api/auth/login',
    ]) {
      const blockedRes = await fetch(`${baseUrl}${ep}`);
      assert.equal(blockedRes.status, 503, `Expected 503 on ${ep} when kill switch is OFF`);
      const body = await blockedRes.json();
      assert.equal(body.error.code, SERVICE_UNAVAILABLE);
    }

    // Health check stays 200 OK
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    assert.deepEqual(await healthRes.json(), { status: 'ok' });

    // 3. SecAdmin re-enables kill switch in shared Upstash Redis -> Chat API recovers immediately
    redisMap.set('siem:backend:enabled', 'true');
    const recoveredRes = await fetch(`${baseUrl}/api/users/me`);
    assert.equal(recoveredRes.status, 401);
  });

  test('Socket.IO socketKillSwitch blocks new WebSocket handshakes when disabled and allows when enabled', async () => {
    let switchVal = 'false';
    setKillSwitchReaderForTests(async () => switchVal);

    let errReceived = null;
    await socketKillSwitch({}, (err) => {
      errReceived = err || null;
    });
    assert.ok(errReceived, 'Expected socketKillSwitch to reject connection when disabled');
    assert.equal(errReceived.data?.code, SERVICE_UNAVAILABLE);

    switchVal = 'true';
    errReceived = null;
    await socketKillSwitch({}, (err) => {
      errReceived = err || null;
    });
    assert.equal(errReceived, null);
  });

  test('Kill switch error responses and failures never leak Upstash credentials or internal URLs', async () => {
    setKillSwitchReaderForTests(async () => 'false');

    const res = await fetch(`${baseUrl}/api/conversations`);
    assert.equal(res.status, 503);
    const raw = await res.text();
    for (const sensitive of ['UPSTASH', 'Bearer', 'redis://', 'rediss://', 'token', 'password']) {
      assert.ok(
        !raw.toLowerCase().includes(sensitive.toLowerCase()),
        `Sensitive substring ${sensitive} must not appear in 503 response`
      );
    }

    // Fail-open when Redis throws an error with secret-looking text (must not crash or leak)
    setKillSwitchReaderForTests(async () => {
      throw new Error('Connection failed to https://secret.upstash.io with Bearer SECRET_TOKEN_XYZ');
    });
    const enabled = await isChatBackendEnabled({ bypassCache: true });
    assert.equal(enabled, true);
  });
});
