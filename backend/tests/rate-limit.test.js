import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { rateLimiter } from '../src/middleware/rate-limit.middleware.js';
import { connectRedis, closeRedis } from '../src/config/redis.js';

/**
 * Invoke the middleware with minimal Express req/res doubles.
 * @param {Function} limiter
 * @param {any} req
 */
function invoke(limiter, req) {
  return new Promise((resolve) => {
    const res = {
      headers: /** @type {Record<string, string>} */ ({}),
      set(key, value) {
        this.headers[key] = value;
      },
    };
    limiter(req, res, (err) => resolve({ err, res }));
  });
}

describe('Redis rate limiter (requires Redis)', () => {
  let redisAvailable = true;

  before(async () => {
    try {
      await connectRedis();
    } catch {
      redisAvailable = false;
    }
  });

  after(async () => {
    await closeRedis();
  });

  test('allows requests under the limit, rejects above it, and keys by user', async (t) => {
    if (!redisAvailable) return t.skip('Redis is not reachable');

    const name = `test:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const limiter = rateLimiter({ name, limit: 2, windowSeconds: 5 });
    const userA = { user: { id: `a-${name}` }, ip: '127.0.0.1' };
    const userB = { user: { id: `b-${name}` }, ip: '127.0.0.1' };

    assert.equal((await invoke(limiter, userA)).err, undefined);
    assert.equal((await invoke(limiter, userA)).err, undefined);

    const blocked = await invoke(limiter, userA);
    assert.equal(blocked.err.statusCode, 429);
    assert.equal(blocked.err.code, 'TOO_MANY_REQUESTS');
    assert.ok(Number(blocked.res.headers['Retry-After']) >= 1);

    // A different authenticated user is not affected.
    assert.equal((await invoke(limiter, userB)).err, undefined);
  });

  test('falls back to IP identity for unauthenticated requests', async (t) => {
    if (!redisAvailable) return t.skip('Redis is not reachable');

    const name = `test-ip:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const limiter = rateLimiter({ name, limit: 1, windowSeconds: 5 });
    const request = { ip: `198.51.100.${Math.floor(Math.random() * 200) + 1}` };

    assert.equal((await invoke(limiter, request)).err, undefined);
    assert.equal((await invoke(limiter, request)).err.statusCode, 429);
  });
});
