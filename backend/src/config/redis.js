import { createClient } from 'redis';
import env from './env.js';
import logger from '../utils/logger.js';

/**
 * Shared Redis client (issue #11 — public key registry).
 *
 * The connection is lazy: importing this module never opens a socket, so the
 * app and its tests still start when Redis is down. Callers translate
 * connection failures into a fail-safe 503 (see identity-keys.service.js).
 */

/** @type {import('redis').RedisClientType | null} */
let client = null;
/** @type {Promise<import('redis').RedisClientType> | null} */
let connecting = null;

function createRedisClient() {
  const redis = createClient({
    url: env.redisUrl,
    socket: {
      connectTimeout: 2000,
      // Fail fast instead of retrying forever; the next request reconnects.
      reconnectStrategy: false,
    },
  });

  redis.on('error', (err) => {
    logger.error('Redis client error', { message: err.message });
  });

  return redis;
}

/**
 * Connect on demand. Concurrent callers share one connection attempt.
 * @returns {Promise<import('redis').RedisClientType>}
 */
export async function connectRedis() {
  if (!client) client = createRedisClient();
  if (client.isOpen) return client;

  if (!connecting) {
    const redis = client;
    connecting = redis
      .connect()
      .then(() => redis)
      .catch((err) => {
        logger.error('Redis connection failed', { message: err.message });
        client = null; // drop the broken client so the next request retries
        throw err;
      })
      .finally(() => {
        connecting = null;
      });
  }

  return connecting;
}

/**
 * Close the connection (graceful shutdown / tests).
 */
export async function closeRedis() {
  if (client?.isOpen) {
    await client.quit();
  }
  client = null;
}
