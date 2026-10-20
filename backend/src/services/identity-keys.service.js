import { createHash, createPublicKey } from 'node:crypto';
import { connectRedis } from '../config/redis.js';
import AppError from '../errors/AppError.js';
import {
  IDENTITY_KEY_NOT_FOUND,
  INVALID_PUBLIC_KEY,
  KEY_REGISTRY_UNAVAILABLE,
} from '../errors/error-codes.js';
import logger from '../utils/logger.js';

/**
 * E2EE identity public key registry (issue #11).
 *
 * Redis layout (one hash per user identity):
 *
 *   e2ee:identity:<userId>
 *     publicKey   Base64URL raw ECDH P-256 point (65 bytes, uncompressed)
 *     fingerprint Base64URL SHA-256 of the raw point
 *     algorithm   "ECDH-P256"
 *     version     Protocol version ("1")
 *     updatedAt   ISO-8601 timestamp of the last registration
 *
 * No TTL: the key persists until the user rotates (re-registers) or deletes
 * it. Private keys and derived/shared secrets MUST never reach this store.
 *
 * The server is not a trust authority — clients pin fingerprints locally
 * (TOFU) and must show key changes to the user. See docs/E2EE_KEY_REGISTRY.md.
 */

const KEY_PREFIX = 'e2ee:identity:';
const ALGORITHM = 'ECDH-P256';
const PROTOCOL_VERSION = '1';
const P256_RAW_BYTES = 65;
const UNCOMPRESSED_PREFIX = 0x04;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Validate and normalise a Base64URL raw P-256 public key.
 *
 * @param {unknown} publicKey
 * @returns {{ publicKey: string, fingerprint: string }}
 * @throws {AppError} 400 INVALID_PUBLIC_KEY
 */
export function parsePublicKey(publicKey) {
  const invalid = () =>
    new AppError(
      'publicKey must be a Base64URL-encoded uncompressed P-256 public key',
      400,
      INVALID_PUBLIC_KEY
    );

  if (
    typeof publicKey !== 'string' ||
    publicKey.length > 100 ||
    !BASE64URL_PATTERN.test(publicKey)
  ) {
    throw invalid();
  }

  const raw = Buffer.from(publicKey, 'base64url');
  if (raw.length !== P256_RAW_BYTES || raw[0] !== UNCOMPRESSED_PREFIX) {
    throw invalid();
  }

  // Reject points that are not on the curve.
  try {
    createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: raw.subarray(1, 33).toString('base64url'),
        y: raw.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    });
  } catch {
    throw invalid();
  }

  return {
    publicKey: raw.toString('base64url'),
    fingerprint: createHash('sha256').update(raw).digest('base64url'),
  };
}

/**
 * @template T
 * @param {(redis: import('redis').RedisClientType) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withRedis(fn) {
  let redis;
  try {
    redis = await connectRedis();
  } catch {
    throw new AppError('Identity key registry is unavailable', 503, KEY_REGISTRY_UNAVAILABLE);
  }

  try {
    return await fn(redis);
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error('Identity key registry error', { message: err.message });
    throw new AppError('Identity key registry is unavailable', 503, KEY_REGISTRY_UNAVAILABLE);
  }
}

/**
 * Register or rotate the authenticated user's public key.
 *
 * @param {string} userId
 * @param {unknown} publicKey
 */
export async function register(userId, publicKey) {
  const parsed = parsePublicKey(publicKey);

  return withRedis(async (redis) => {
    const redisKey = `${KEY_PREFIX}${userId}`;
    const existing = await redis.hGetAll(redisKey);
    const changed = Boolean(existing.publicKey) && existing.fingerprint !== parsed.fingerprint;
    const updatedAt = new Date().toISOString();

    await redis.hSet(redisKey, {
      userId,
      publicKey: parsed.publicKey,
      fingerprint: parsed.fingerprint,
      algorithm: ALGORITHM,
      version: PROTOCOL_VERSION,
      updatedAt,
    });

    return {
      userId,
      publicKey: parsed.publicKey,
      fingerprint: parsed.fingerprint,
      algorithm: ALGORITHM,
      version: PROTOCOL_VERSION,
      updatedAt,
      changed,
    };
  });
}

/**
 * Fetch a user's registered public key.
 *
 * @param {string} userId
 */
export async function get(userId) {
  return withRedis(async (redis) => {
    const data = await redis.hGetAll(`${KEY_PREFIX}${userId}`);
    if (!data.publicKey) {
      throw new AppError('Identity key not registered', 404, IDENTITY_KEY_NOT_FOUND);
    }

    return {
      userId,
      publicKey: data.publicKey,
      fingerprint: data.fingerprint,
      algorithm: data.algorithm,
      version: data.version,
      updatedAt: data.updatedAt,
    };
  });
}

/**
 * Delete the authenticated user's public key. Idempotent.
 *
 * @param {string} userId
 */
export async function remove(userId) {
  await withRedis(async (redis) => {
    await redis.del(`${KEY_PREFIX}${userId}`);
  });
}
