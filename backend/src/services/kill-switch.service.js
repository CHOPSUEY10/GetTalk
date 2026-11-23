import env from '../config/env.js';
import { connectRedis } from '../config/redis.js';
import logger from '../utils/logger.js';

/**
 * Chat Server Kill Switch Service.
 *
 * Reads the active/inactive state of the GetTalk Chat Server from Upstash Redis
 * (via REST API when configured) or falls back to the shared Redis client.
 * Controlled remotely by SecAdmin through the SIEM backend (`security/backend`).
 *
 * Security:
 *  - Never logs or returns Upstash REST URLs, Bearer tokens, or Redis credentials.
 *  - Fails open (enabled = true) if Redis is unconfigured/unreachable so local dev
 *    and tests without Redis continue to run normally.
 */

let cachedEnabled = true;
let cacheExpiresAt = 0;

/** @type {((key: string) => Promise<string | null>) | null} */
let customReader = null;

/**
 * Override the state reader in unit/integration tests.
 * Pass `null` to restore the default Upstash/Redis reader.
 * @param {((key: string) => Promise<string | null>) | null} readerFn
 */
export function setKillSwitchReaderForTests(readerFn) {
  customReader = typeof readerFn === 'function' ? readerFn : null;
  clearKillSwitchCache();
}

/**
 * Clear the short-lived in-memory cache so the next check queries Redis immediately.
 */
export function clearKillSwitchCache() {
  cachedEnabled = true;
  cacheExpiresAt = 0;
}

/**
 * Parse a raw Redis string/boolean value into a kill-switch enabled boolean.
 * Defaults to `true` unless explicitly `"false"` (case-insensitive) or `"0"`.
 * @param {unknown} rawValue
 * @returns {boolean}
 */
export function parseKillSwitchValue(rawValue) {
  if (rawValue === false) return false;
  if (rawValue === null || rawValue === undefined) return true;
  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return true;
}

/**
 * Query Upstash Redis REST API (`["GET", key]`) without ever exposing credentials in errors.
 * @param {string} restUrl
 * @param {string} restToken
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function fetchUpstashKey(restUrl, restToken, key) {
  const baseUrl = String(restUrl || '').trim().replace(/\/+$/, '');
  const token = String(restToken || '').trim();
  if (!baseUrl || !token) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['GET', key]),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error('Kill switch state store unavailable');
    }

    const parsed = await res.json();
    if (parsed?.error) {
      throw new Error('Kill switch state store returned an error');
    }
    return parsed?.result ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read the raw kill switch key value from the configured backend store.
 * @param {string} key
 * @returns {Promise<string | null>}
 */
async function readRawKillSwitchState(key) {
  if (customReader) {
    return customReader(key);
  }

  if (env.upstashRedisRestUrl && env.upstashRedisRestToken) {
    return fetchUpstashKey(env.upstashRedisRestUrl, env.upstashRedisRestToken, key);
  }

  // Fallback to standard Redis client only if REDIS_URL is explicitly configured and reachable
  if (env.redisUrl) {
    const redis = await connectRedis();
    return redis.get(key);
  }

  return null;
}

/**
 * Determine whether the GetTalk Chat Server is enabled (`true`) or disabled (`false`)
 * by the SIEM Administrator Kill Switch.
 *
 * @param {{ bypassCache?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
export async function isChatBackendEnabled(options = {}) {
  const now = Date.now();
  const ttlMs = customReader ? 0 : (env.killSwitchCacheTtlMs ?? 1000);

  if (!options.bypassCache && ttlMs > 0 && now < cacheExpiresAt) {
    return cachedEnabled;
  }

  const key = env.killSwitchRedisKey || 'siem:backend:enabled';

  try {
    const raw = await readRawKillSwitchState(key);
    const enabled = parseKillSwitchValue(raw);
    if (ttlMs > 0) {
      cachedEnabled = enabled;
      cacheExpiresAt = now + ttlMs;
    }
    return enabled;
  } catch {
    // Log safely without leaking Upstash URL, token, or Redis connection URI
    logger.warn('Kill switch state check failed; keeping chat backend fail-open');
    return true;
  }
}
