import { connectRedis } from '../config/redis.js';
import logger from '../utils/logger.js';

/**
 * Redis-backed user presence service.
 *
 * Non-redundant Redis layout — ONE hash key per user:
 *
 *   presence:<userId>
 *     s:<socketId>   Epoch ms of the latest active heartbeat for that socket.
 *                    Exists ONLY while the socket is actively in the browser
 *                    with an active session; removed immediately on tab hide,
 *                    idle/inactivity, logout, session revocation, or disconnect.
 *     lastSeenAt     ISO-8601 timestamp recorded when the user transitions from
 *                    active to inactive/offline (or when stale sockets expire).
 *
 * Why there is zero redundancy:
 *   - No separate `presence:online:<userId>` or `presence:lastseen:<userId>` keys.
 *   - No duplicated `isOnline`, `status`, or `activeCount` fields inside the hash;
 *     active status is derived strictly from whether at least one `s:<socketId>`
 *     field is within `PRESENCE_TTL_MS`.
 *   - No in-memory Map mirroring Redis state.
 */

export const PRESENCE_KEY_PREFIX = 'presence:';
export const SOCKET_FIELD_PREFIX = 's:';
export const LAST_SEEN_FIELD = 'lastSeenAt';

/** Socket liveness window in ms; frontend heartbeats every 20s while active. */
export const PRESENCE_TTL_MS = 45_000;

/** Key retention TTL in seconds (7 days) to prevent unbounded Redis growth. */
export const PRESENCE_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/**
 * @param {string} userId
 * @returns {string}
 */
export function presenceKey(userId) {
  return `${PRESENCE_KEY_PREFIX}${userId}`;
}

/**
 * @param {string} socketId
 * @returns {string}
 */
export function socketField(socketId) {
  return `${SOCKET_FIELD_PREFIX}${socketId}`;
}

/**
 * Normalize a Date, ISO string, or epoch ms into an ISO-8601 string (or null).
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeIsoTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Pick the more recent of two ISO-8601 / Date timestamps.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {string | null}
 */
function maxTimestamp(a, b) {
  const isoA = normalizeIsoTimestamp(a);
  const isoB = normalizeIsoTimestamp(b);
  if (!isoA) return isoB;
  if (!isoB) return isoA;
  return new Date(isoA).getTime() >= new Date(isoB).getTime() ? isoA : isoB;
}

/**
 * Inspect raw Redis hash fields for a user and separate active vs expired sockets.
 *
 * @param {Record<string, string>} hash
 * @param {number} nowMs
 * @param {number} ttlMs
 */
function inspectPresenceHash(hash, nowMs, ttlMs) {
  /** @type {string[]} */
  const activeSocketFields = [];
  /** @type {string[]} */
  const expiredSocketFields = [];
  let maxExpiredMs = 0;

  for (const [field, rawVal] of Object.entries(hash || {})) {
    if (!field.startsWith(SOCKET_FIELD_PREFIX)) continue;
    const ts = Number(rawVal);
    if (Number.isFinite(ts) && ts > 0 && nowMs - ts < ttlMs) {
      activeSocketFields.push(field);
    } else {
      expiredSocketFields.push(field);
      if (Number.isFinite(ts) && ts > maxExpiredMs) {
        maxExpiredMs = ts;
      }
    }
  }

  const storedLastSeenAt = normalizeIsoTimestamp(hash?.[LAST_SEEN_FIELD] || null);
  const expiredLastSeenAt = maxExpiredMs > 0 ? new Date(maxExpiredMs).toISOString() : null;

  return {
    activeSocketFields,
    expiredSocketFields,
    storedLastSeenAt,
    expiredLastSeenAt,
  };
}

/**
 * Resolve a Redis client (injected for tests or shared lazy singleton).
 * Returns null if Redis is unavailable so callers degrade gracefully.
 *
 * @param {import('redis').RedisClientType | null | undefined} injectedRedis
 * @returns {Promise<import('redis').RedisClientType | null>}
 */
async function getRedisClient(injectedRedis) {
  if (injectedRedis) return injectedRedis;
  try {
    return await connectRedis();
  } catch (err) {
    logger.warn('Presence Redis unavailable; degrading gracefully', {
      message: err?.message,
    });
    return null;
  }
}

/**
 * Mark a user's socket as actively present in the browser (foreground + valid session).
 * Used on initial active connection, tab resume, and periodic heartbeats.
 *
 * @param {string} userId
 * @param {string} socketId
 * @param {{ nowMs?: number, ttlMs?: number, redis?: any }} [options]
 * @returns {Promise<{
 *   userId: string,
 *   isOnline: boolean,
 *   transitioned: boolean,
 *   activeCount: number,
 *   lastSeenAt: string | null,
 * }>}
 */
export async function markSocketActive(
  userId,
  socketId,
  { nowMs = Date.now(), ttlMs = PRESENCE_TTL_MS, redis: injectedRedis = null } = {}
) {
  if (!userId || !socketId) {
    return {
      userId: userId || '',
      isOnline: false,
      transitioned: false,
      activeCount: 0,
      lastSeenAt: null,
    };
  }

  const redis = await getRedisClient(injectedRedis);
  if (!redis) {
    return {
      userId,
      isOnline: false,
      transitioned: false,
      activeCount: 0,
      lastSeenAt: null,
    };
  }

  try {
    const key = presenceKey(userId);
    const field = socketField(socketId);
    const hash = await redis.hGetAll(key);
    const { activeSocketFields, expiredSocketFields, storedLastSeenAt } = inspectPresenceHash(
      hash,
      nowMs,
      ttlMs
    );

    const wasOnline = activeSocketFields.length > 0;
    const otherActiveCount = activeSocketFields.filter((f) => f !== field).length;
    const staleToDelete = expiredSocketFields.filter((f) => f !== field);

    const multi = redis.multi();
    if (staleToDelete.length > 0) {
      multi.hDel(key, staleToDelete);
    }
    multi.hSet(key, field, String(nowMs));
    multi.expire(key, PRESENCE_RETENTION_SECONDS);
    await multi.exec();

    return {
      userId,
      isOnline: true,
      transitioned: !wasOnline,
      activeCount: otherActiveCount + 1,
      lastSeenAt: storedLastSeenAt,
    };
  } catch (err) {
    logger.error('Failed to mark socket active in Redis', {
      userId,
      message: err?.message,
    });
    return {
      userId,
      isOnline: false,
      transitioned: false,
      activeCount: 0,
      lastSeenAt: null,
    };
  }
}

/**
 * Refresh an active socket's lease timestamp in Redis.
 *
 * @param {string} userId
 * @param {string} socketId
 * @param {{ nowMs?: number, ttlMs?: number, redis?: any }} [options]
 */
export async function heartbeatSocket(userId, socketId, options = {}) {
  return markSocketActive(userId, socketId, options);
}

/**
 * Mark a user's socket as inactive (tab hidden, browser closed, idle, logout,
 * session revoked, or socket disconnected).
 *
 * Only transitions the user offline and records `lastSeenAt` when NO other
 * active foreground sockets remain for this user.
 *
 * @param {string} userId
 * @param {string} socketId
 * @param {{ nowMs?: number, ttlMs?: number, redis?: any }} [options]
 * @returns {Promise<{
 *   userId: string,
 *   isOnline: boolean,
 *   transitioned: boolean,
 *   activeCount: number,
 *   lastSeenAt: string | null,
 * }>}
 */
export async function markSocketInactive(
  userId,
  socketId,
  { nowMs = Date.now(), ttlMs = PRESENCE_TTL_MS, redis: injectedRedis = null } = {}
) {
  const nowIso = new Date(nowMs).toISOString();
  if (!userId || !socketId) {
    return {
      userId: userId || '',
      isOnline: false,
      transitioned: false,
      activeCount: 0,
      lastSeenAt: null,
    };
  }

  const redis = await getRedisClient(injectedRedis);
  if (!redis) {
    return {
      userId,
      isOnline: false,
      transitioned: false,
      activeCount: 0,
      lastSeenAt: nowIso,
    };
  }

  try {
    const key = presenceKey(userId);
    const field = socketField(socketId);
    const hash = await redis.hGetAll(key);
    const {
      activeSocketFields,
      expiredSocketFields,
      storedLastSeenAt,
      expiredLastSeenAt,
    } = inspectPresenceHash(hash, nowMs, ttlMs);

    const wasOnline = activeSocketFields.length > 0;
    const hadThisSocket = Object.prototype.hasOwnProperty.call(hash, field);
    const remainingActive = activeSocketFields.filter((f) => f !== field);

    const fieldsToDelete = Array.from(
      new Set([...(hadThisSocket ? [field] : []), ...expiredSocketFields])
    );

    if (remainingActive.length > 0) {
      if (fieldsToDelete.length > 0) {
        const multi = redis.multi();
        multi.hDel(key, fieldsToDelete);
        multi.expire(key, PRESENCE_RETENTION_SECONDS);
        await multi.exec();
      }
      return {
        userId,
        isOnline: true,
        transitioned: false,
        activeCount: remainingActive.length,
        lastSeenAt: storedLastSeenAt,
      };
    }

    // No active sockets left. Record `lastSeenAt` if we actually transitioned
    // offline (or had no previous lastSeenAt), preserving prior lastSeenAt on
    // idempotent duplicate inactive events.
    const nextLastSeenAt = wasOnline
      ? nowIso
      : maxTimestamp(storedLastSeenAt, expiredLastSeenAt) || nowIso;

    const shouldWriteLastSeen = wasOnline || !storedLastSeenAt || nextLastSeenAt !== storedLastSeenAt;

    if (fieldsToDelete.length > 0 || shouldWriteLastSeen) {
      const multi = redis.multi();
      if (fieldsToDelete.length > 0) {
        multi.hDel(key, fieldsToDelete);
      }
      if (shouldWriteLastSeen) {
        multi.hSet(key, LAST_SEEN_FIELD, nextLastSeenAt);
      }
      multi.expire(key, PRESENCE_RETENTION_SECONDS);
      await multi.exec();
    }

    return {
      userId,
      isOnline: false,
      transitioned: wasOnline,
      activeCount: 0,
      lastSeenAt: nextLastSeenAt,
    };
  } catch (err) {
    logger.error('Failed to mark socket inactive in Redis', {
      userId,
      message: err?.message,
    });
    return {
      userId,
      isOnline: false,
      transitioned: false,
      activeCount: 0,
      lastSeenAt: nowIso,
    };
  }
}

/**
 * Force all active sockets for a user offline in Redis (e.g., full session revocation).
 *
 * @param {string} userId
 * @param {{ nowMs?: number, ttlMs?: number, redis?: any }} [options]
 */
export async function clearUserActiveSockets(
  userId,
  { nowMs = Date.now(), ttlMs = PRESENCE_TTL_MS, redis: injectedRedis = null } = {}
) {
  const nowIso = new Date(nowMs).toISOString();
  if (!userId) {
    return { userId: '', isOnline: false, transitioned: false, activeCount: 0, lastSeenAt: null };
  }

  const redis = await getRedisClient(injectedRedis);
  if (!redis) {
    return { userId, isOnline: false, transitioned: false, activeCount: 0, lastSeenAt: nowIso };
  }

  try {
    const key = presenceKey(userId);
    const hash = await redis.hGetAll(key);
    const { activeSocketFields, expiredSocketFields, storedLastSeenAt } = inspectPresenceHash(
      hash,
      nowMs,
      ttlMs
    );
    const allSocketFields = [...activeSocketFields, ...expiredSocketFields];
    const wasOnline = activeSocketFields.length > 0;
    const nextLastSeenAt = wasOnline ? nowIso : storedLastSeenAt || nowIso;

    const multi = redis.multi();
    if (allSocketFields.length > 0) {
      multi.hDel(key, allSocketFields);
    }
    multi.hSet(key, LAST_SEEN_FIELD, nextLastSeenAt);
    multi.expire(key, PRESENCE_RETENTION_SECONDS);
    await multi.exec();

    return {
      userId,
      isOnline: false,
      transitioned: wasOnline,
      activeCount: 0,
      lastSeenAt: nextLastSeenAt,
    };
  } catch (err) {
    logger.error('Failed to clear user active sockets in Redis', {
      userId,
      message: err?.message,
    });
    return { userId, isOnline: false, transitioned: false, activeCount: 0, lastSeenAt: nowIso };
  }
}

/**
 * Fetch presence metadata for multiple users from Redis in a single pipelined batch.
 * Lazily prunes any expired socket fields (e.g., after browser crash or power loss).
 *
 * @param {string[]} userIds
 * @param {{
 *   nowMs?: number,
 *   ttlMs?: number,
 *   fallbackLastSeenMap?: Map<string, string | Date | null>,
 *   redis?: any,
 * }} [options]
 * @returns {Promise<Map<string, { userId: string, isOnline: boolean, lastSeenAt: string | null }>>}
 */
export async function getPresenceBatch(
  userIds,
  {
    nowMs = Date.now(),
    ttlMs = PRESENCE_TTL_MS,
    fallbackLastSeenMap = null,
    redis: injectedRedis = null,
  } = {}
) {
  const uniqueIds = Array.from(new Set((userIds || []).filter(Boolean)));
  /** @type {Map<string, { userId: string, isOnline: boolean, lastSeenAt: string | null }>} */
  const result = new Map();

  if (uniqueIds.length === 0) return result;

  const fallbackEntry = (id) => ({
    userId: id,
    isOnline: false,
    lastSeenAt: normalizeIsoTimestamp(fallbackLastSeenMap?.get(id) || null),
  });

  const redis = await getRedisClient(injectedRedis);
  if (!redis) {
    for (const id of uniqueIds) {
      result.set(id, fallbackEntry(id));
    }
    return result;
  }

  try {
    const hashes = await Promise.all(uniqueIds.map((id) => redis.hGetAll(presenceKey(id))));
    /** @type {Array<{ key: string, staleFields: string[], nextLastSeenAt: string | null }>} */
    const cleanups = [];

    for (let i = 0; i < uniqueIds.length; i += 1) {
      const id = uniqueIds[i];
      const hash = hashes[i] || {};
      const {
        activeSocketFields,
        expiredSocketFields,
        storedLastSeenAt,
        expiredLastSeenAt,
      } = inspectPresenceHash(hash, nowMs, ttlMs);

      const fallbackIso = normalizeIsoTimestamp(fallbackLastSeenMap?.get(id) || null);
      const isOnline = activeSocketFields.length > 0;
      const effectiveLastSeenAt = isOnline
        ? maxTimestamp(storedLastSeenAt, fallbackIso)
        : maxTimestamp(maxTimestamp(storedLastSeenAt, expiredLastSeenAt), fallbackIso);

      if (expiredSocketFields.length > 0) {
        cleanups.push({
          key: presenceKey(id),
          staleFields: expiredSocketFields,
          nextLastSeenAt: !isOnline ? effectiveLastSeenAt : null,
        });
      }

      result.set(id, {
        userId: id,
        isOnline,
        lastSeenAt: effectiveLastSeenAt,
      });
    }

    if (cleanups.length > 0) {
      const multi = redis.multi();
      for (const item of cleanups) {
        multi.hDel(item.key, item.staleFields);
        if (item.nextLastSeenAt) {
          multi.hSet(item.key, LAST_SEEN_FIELD, item.nextLastSeenAt);
        }
        multi.expire(item.key, PRESENCE_RETENTION_SECONDS);
      }
      multi.exec().catch((err) => {
        logger.warn('Failed to prune expired presence socket fields', { message: err?.message });
      });
    }

    return result;
  } catch (err) {
    logger.error('Failed to batch-read presence from Redis', { message: err?.message });
    for (const id of uniqueIds) {
      result.set(id, fallbackEntry(id));
    }
    return result;
  }
}

/**
 * Fetch presence metadata for a single user from Redis.
 *
 * @param {string} userId
 * @param {{
 *   nowMs?: number,
 *   ttlMs?: number,
 *   fallbackLastSeenAt?: string | Date | null,
 *   redis?: any,
 * }} [options]
 * @returns {Promise<{ userId: string, isOnline: boolean, lastSeenAt: string | null }>}
 */
export async function getPresence(
  userId,
  { nowMs = Date.now(), ttlMs = PRESENCE_TTL_MS, fallbackLastSeenAt = null, redis = null } = {}
) {
  if (!userId) {
    return { userId: '', isOnline: false, lastSeenAt: null };
  }
  const fallbackMap = fallbackLastSeenAt ? new Map([[userId, fallbackLastSeenAt]]) : null;
  const batch = await getPresenceBatch([userId], {
    nowMs,
    ttlMs,
    fallbackLastSeenMap: fallbackMap,
    redis,
  });
  return batch.get(userId) || {
    userId,
    isOnline: false,
    lastSeenAt: normalizeIsoTimestamp(fallbackLastSeenAt),
  };
}
