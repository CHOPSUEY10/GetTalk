import env from '../config/env.js';

/**
 * Sensitive fields that must NEVER be logged into the browser console (rule §34).
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'privatekey',
  'private_key',
  'secret',
  'bodyciphertext',
  'body_ciphertext',
  'nonce',
  'plaintext',
  'token',
  'accesstoken',
  'access_token',
  'sessionsecret',
  'masterkey',
  'cipherkey',
  'key',
  'seed',
  'authorization',
  'cookie',
  'credential',
  'pin'
]);

/**
 * Recursively sanitize objects and arrays to prevent leaking sensitive values in browser console.
 * @param {any} data
 * @param {number} [depth=0]
 * @returns {any}
 */
function sanitize(data, depth = 0) {
  if (depth > 5 || data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (data instanceof Error) {
    const anyErr = /** @type {any} */ (data);
    return {
      name: data.name,
      message: data.message,
      ...(anyErr.status ? { status: anyErr.status } : {}),
      ...(anyErr.code ? { code: anyErr.code } : {})
    };
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitize(item, depth + 1));
  }

  if (typeof data === 'object') {
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
      if (SENSITIVE_KEYS.has(normalizedKey)) {
        clean[key] = '[REDACTED]';
      } else {
        clean[key] = sanitize(value, depth + 1);
      }
    }
    return clean;
  }

  return '[Unserializable]';
}

const isProduction = env.appEnv === 'production';

/**
 * Secure browser logging utility that prevents leaking cryptographic secrets, passwords, or payload text.
 */
export const logger = {
  /**
   * @param {string} message
   * @param {any} [meta]
   */
  debug: (message, meta) => {
    if (!isProduction) {
      if (meta !== undefined) {
        console.debug(`[DEBUG] ${message}`, sanitize(meta));
      } else {
        console.debug(`[DEBUG] ${message}`);
      }
    }
  },

  /**
   * @param {string} message
   * @param {any} [meta]
   */
  info: (message, meta) => {
    if (!isProduction) {
      if (meta !== undefined) {
        console.info(`[INFO] ${message}`, sanitize(meta));
      } else {
        console.info(`[INFO] ${message}`);
      }
    }
  },

  /**
   * @param {string} message
   * @param {any} [meta]
   */
  warn: (message, meta) => {
    if (meta !== undefined) {
      console.warn(`[WARN] ${message}`, sanitize(meta));
    } else {
      console.warn(`[WARN] ${message}`);
    }
  },

  /**
   * @param {string} message
   * @param {any} [meta]
   */
  error: (message, meta) => {
    if (meta !== undefined) {
      console.error(`[ERROR] ${message}`, sanitize(meta));
    } else {
      console.error(`[ERROR] ${message}`);
    }
  }
};

export default logger;
