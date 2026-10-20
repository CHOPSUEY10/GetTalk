import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';

import {
  parsePublicKey,
  register,
  get,
  remove,
} from '../src/services/identity-keys.service.js';
import { connectRedis, closeRedis } from '../src/config/redis.js';

/** Generate a real raw uncompressed P-256 public key (65 bytes). */
function createRawPublicKey() {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return Buffer.from(der.subarray(der.length - 65)).toString('base64url');
}

const isInvalidKey = (err) => err.code === 'INVALID_PUBLIC_KEY';

describe('Identity public key validation', () => {
  test('accepts a valid uncompressed P-256 key and fingerprints it locally', () => {
    const publicKey = createRawPublicKey();
    const parsed = parsePublicKey(publicKey);

    assert.equal(parsed.publicKey, publicKey);
    assert.match(parsed.fingerprint, /^[A-Za-z0-9_-]{43}$/);
  });

  test('rejects malformed encodings', () => {
    for (const bad of ['', 'not base64!', 'AAAA', 123, null]) {
      assert.throws(() => parsePublicKey(bad), isInvalidKey);
    }
  });

  test('rejects a point that is not on the curve', () => {
    const offCurve = Buffer.alloc(65);
    offCurve[0] = 0x04; // uncompressed marker, x = y = 0

    assert.throws(() => parsePublicKey(offCurve.toString('base64url')), isInvalidKey);
  });
});

describe('Identity public key registry (requires Redis)', () => {
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

  test('registers, retrieves, rotates and deletes a key', async (t) => {
    if (!redisAvailable) return t.skip('Redis is not reachable');

    const userId = `test-${randomUUID()}`;
    const keyA = createRawPublicKey();
    const keyB = createRawPublicKey();

    const first = await register(userId, keyA);
    assert.equal(first.changed, false);

    const fetched = await get(userId);
    assert.equal(fetched.publicKey, keyA);
    assert.equal(fetched.fingerprint, first.fingerprint);
    assert.equal(fetched.algorithm, 'ECDH-P256');

    // Rotation must be flagged so clients can require re-verification.
    const rotated = await register(userId, keyB);
    assert.equal(rotated.changed, true);
    assert.equal((await get(userId)).publicKey, keyB);

    await remove(userId);
    await assert.rejects(
      get(userId),
      (err) => err.code === 'IDENTITY_KEY_NOT_FOUND'
    );
  });
});
