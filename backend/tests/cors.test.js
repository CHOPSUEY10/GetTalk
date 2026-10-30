import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import app from '../app.js';
import env from '../src/config/env.js';
import {
  ALLOWED_CORS_HEADERS,
  parseCorsOrigins,
  validateOriginEntry,
  matchAllowedOrigin,
  createCorsOptions,
  createCorsMiddleware,
} from '../src/config/cors.js';
import { errorHandler } from '../src/middleware/error.middleware.js';

let server;
let baseUrl;
const primaryAllowedOrigin = env.corsOrigins[0];

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('CORS Configuration Validation (backend/src/config/cors.js)', () => {
  test('rejects wildcard (*) when credentials: true', () => {
    assert.throws(
      () => parseCorsOrigins('*', { credentials: true }),
      /wildcard \(\*\)/i
    );
    assert.throws(
      () => parseCorsOrigins('http://localhost:5173, *', { credentials: true }),
      /wildcard \(\*\)/i
    );
    assert.throws(
      () => parseCorsOrigins('https://*.gettalk.app', { credentials: true }),
      /wildcard \(\*\)/i
    );
    assert.throws(
      () => createCorsOptions('*', { credentials: true }),
      /wildcard \(\*\)/i
    );
  });

  test('rejects empty, whitespace, or "null" CORS_ORIGIN values', () => {
    assert.throws(() => parseCorsOrigins(''), /minimal satu origin/i);
    assert.throws(() => parseCorsOrigins('   ,  '), /minimal satu origin/i);
    assert.throws(() => parseCorsOrigins('null'), /null/i);
    assert.throws(() => validateOriginEntry(''), /origin kosong/i);
  });

  test('enforces valid http:// or https:// protocol', () => {
    assert.throws(
      () => parseCorsOrigins('localhost:5173'),
      /http:\/\/ atau https:\/\//i
    );
    assert.throws(
      () => parseCorsOrigins('ftp://files.example.com'),
      /http:\/\/ atau https:\/\//i
    );
    assert.throws(
      () => parseCorsOrigins('ws://localhost:5173'),
      /http:\/\/ atau https:\/\//i
    );
  });

  test('rejects origins containing path, query, hash, or credentials', () => {
    assert.throws(
      () => parseCorsOrigins('https://app.gettalk.local/chat'),
      /path, query, hash, atau kredensial/i
    );
    assert.throws(
      () => parseCorsOrigins('https://app.gettalk.local?env=prod'),
      /path, query, hash, atau kredensial/i
    );
    assert.throws(
      () => parseCorsOrigins('https://app.gettalk.local#section'),
      /path, query, hash, atau kredensial/i
    );
    assert.throws(
      () => parseCorsOrigins('https://user:pass@app.gettalk.local'),
      /path, query, hash, atau kredensial/i
    );
  });

  test('parses, normalizes, and deduplicates multi-origin allowlist', () => {
    const origins = parseCorsOrigins(
      'http://localhost:5173/, https://staging.gettalk.app , http://127.0.0.1:4173, http://localhost:5173'
    );

    assert.deepEqual(origins, [
      'http://localhost:5173',
      'https://staging.gettalk.app',
      'http://127.0.0.1:4173',
    ]);
  });

  test('matchAllowedOrigin matches only exact allowlisted origins', () => {
    const allowlist = [
      'http://localhost:5173',
      'https://staging.gettalk.app',
    ];

    assert.equal(
      matchAllowedOrigin('http://localhost:5173', allowlist),
      'http://localhost:5173'
    );
    assert.equal(
      matchAllowedOrigin('https://staging.gettalk.app', allowlist),
      'https://staging.gettalk.app'
    );
    assert.equal(matchAllowedOrigin('https://evil.example.com', allowlist), null);
    assert.equal(
      matchAllowedOrigin('http://localhost:5173.evil.com', allowlist),
      null
    );
    assert.equal(matchAllowedOrigin('null', allowlist), null);
    assert.equal(matchAllowedOrigin(undefined, allowlist), null);
  });
});

describe('CORS HTTP & Preflight Enforcement', () => {
  test('grants Access-Control-Allow-Origin and Access-Control-Allow-Credentials: true to allowed origin', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: {
        Origin: primaryAllowedOrigin,
      },
    });

    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('access-control-allow-origin'),
      primaryAllowedOrigin
    );
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    assert.match(res.headers.get('vary') || '', /Origin/i);
  });

  test('rejects unregistered origin with 403 and omits CORS headers so response cannot be read', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: {
        Origin: 'https://attacker.evil.example',
      },
    });

    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);

    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
  });

  test('rejects preflight OPTIONS from unregistered origin without granting credentials', async () => {
    const res = await fetch(`${baseUrl}/api/attachments`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://attacker.evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers':
          'Content-Type, X-Message-Id, X-Metadata-Ciphertext, X-Metadata-Nonce',
      },
    });

    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
    assert.equal(res.headers.get('access-control-allow-headers'), null);
  });

  test('omits Access-Control-Allow-Credentials when no Origin header is sent', async () => {
    const res = await fetch(`${baseUrl}/health`);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  });

  test('allows E2EE custom headers (X-Message-Id, X-Metadata-Ciphertext, X-Metadata-Nonce) in OPTIONS preflight', async () => {
    assert.ok(ALLOWED_CORS_HEADERS.includes('X-Message-Id'));
    assert.ok(ALLOWED_CORS_HEADERS.includes('X-Metadata-Ciphertext'));
    assert.ok(ALLOWED_CORS_HEADERS.includes('X-Metadata-Nonce'));

    const res = await fetch(`${baseUrl}/api/attachments`, {
      method: 'OPTIONS',
      headers: {
        Origin: primaryAllowedOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers':
          'Content-Type, X-Message-Id, X-Metadata-Ciphertext, X-Metadata-Nonce',
      },
    });

    assert.equal(res.status, 204);
    assert.equal(
      res.headers.get('access-control-allow-origin'),
      primaryAllowedOrigin
    );
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');

    const allowHeaders = (
      res.headers.get('access-control-allow-headers') || ''
    )
      .split(',')
      .map((h) => h.trim().toLowerCase());

    assert.ok(allowHeaders.includes('x-message-id'));
    assert.ok(allowHeaders.includes('x-metadata-ciphertext'));
    assert.ok(allowHeaders.includes('x-metadata-nonce'));
    assert.ok(allowHeaders.includes('content-type'));
  });

  test('supports multiple trusted origins via allowlist and rejects any unlisted origin', async () => {
    const multiApp = express();
    multiApp.use(
      createCorsMiddleware(
        'http://localhost:5173, https://staging.gettalk.app, http://localhost:8100'
      )
    );
    multiApp.get('/ping', (_req, res) => res.json({ ok: true }));
    multiApp.use(errorHandler);

    const multiServer = http.createServer(multiApp);
    await new Promise((resolve) => multiServer.listen(0, '127.0.0.1', resolve));
    const multiUrl = `http://127.0.0.1:${multiServer.address().port}`;

    try {
      for (const trustedOrigin of [
        'http://localhost:5173',
        'https://staging.gettalk.app',
        'http://localhost:8100',
      ]) {
        const res = await fetch(`${multiUrl}/ping`, {
          headers: { Origin: trustedOrigin },
        });
        assert.equal(res.status, 200);
        assert.equal(
          res.headers.get('access-control-allow-origin'),
          trustedOrigin
        );
        assert.equal(
          res.headers.get('access-control-allow-credentials'),
          'true'
        );
      }

      const untrustedRes = await fetch(`${multiUrl}/ping`, {
        headers: { Origin: 'https://preview-untrusted.gettalk.app' },
      });
      assert.equal(untrustedRes.status, 403);
      assert.equal(untrustedRes.headers.get('access-control-allow-origin'), null);
      assert.equal(
        untrustedRes.headers.get('access-control-allow-credentials'),
        null
      );
    } finally {
      await new Promise((resolve) => multiServer.close(resolve));
    }
  });
});

