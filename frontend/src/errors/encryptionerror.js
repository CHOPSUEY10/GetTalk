import logger, { sanitize, sanitizeString, isSafeErrorCode } from '../lib/logger.js';

/**
 * Standard encryption error categories and machine-readable codes.
 */
export const ENCRYPTION_ERROR_CATEGORIES = Object.freeze({
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  KEY_EXCHANGE_FAILED: 'KEY_EXCHANGE_FAILED',
  KEY_UNAVAILABLE: 'KEY_UNAVAILABLE',
  INVALID_CIPHERTEXT: 'INVALID_CIPHERTEXT',
  IDENTITY_KEY_CHANGED: 'IDENTITY_KEY_CHANGED'
});

export const ENCRYPTION_ERROR_CODES = Object.freeze({
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  KEY_EXCHANGE_FAILED: 'KEY_EXCHANGE_FAILED',
  KEY_DERIVATION_FAILED: 'KEY_DERIVATION_FAILED',
  KEY_UNAVAILABLE: 'KEY_UNAVAILABLE',
  KEY_STORAGE_FAILED: 'KEY_STORAGE_FAILED',
  INVALID_CIPHERTEXT: 'INVALID_CIPHERTEXT',
  IDENTITY_KEY_CHANGED: 'IDENTITY_KEY_CHANGED',
  IDENTITY_KEY_NOT_FOUND: 'IDENTITY_KEY_NOT_FOUND',
  INVALID_PUBLIC_KEY: 'INVALID_PUBLIC_KEY',
  KEY_REGISTRY_UNAVAILABLE: 'KEY_REGISTRY_UNAVAILABLE',
  FILE_ENCRYPTION_FAILED: 'FILE_ENCRYPTION_FAILED',
  FILE_DECRYPTION_FAILED: 'FILE_DECRYPTION_FAILED'
});

/** @type {Set<string>} */
const KNOWN_ENCRYPTION_CODES = new Set(Object.values(ENCRYPTION_ERROR_CODES));

/**
 * Allowed non-secret context keys for encryption error logs.
 * Any key outside this set (or containing sensitive values) is redacted.
 * @type {Set<string>}
 */
const SAFE_CRYPTO_CONTEXT_KEYS = new Set([
  'operation',
  'conversationid',
  'stage',
  'reason'
]);

/**
 * Map a specific encryption error code to its canonical category.
 * @param {string} code
 * @returns {string}
 */
export function mapEncryptionCodeToCategory(code) {
  switch (code) {
    case ENCRYPTION_ERROR_CODES.ENCRYPTION_FAILED:
    case ENCRYPTION_ERROR_CODES.FILE_ENCRYPTION_FAILED:
      return ENCRYPTION_ERROR_CATEGORIES.ENCRYPTION_FAILED;
    case ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED:
    case ENCRYPTION_ERROR_CODES.FILE_DECRYPTION_FAILED:
      return ENCRYPTION_ERROR_CATEGORIES.DECRYPTION_FAILED;
    case ENCRYPTION_ERROR_CODES.INVALID_CIPHERTEXT:
      return ENCRYPTION_ERROR_CATEGORIES.INVALID_CIPHERTEXT;
    case ENCRYPTION_ERROR_CODES.KEY_EXCHANGE_FAILED:
    case ENCRYPTION_ERROR_CODES.KEY_DERIVATION_FAILED:
    case ENCRYPTION_ERROR_CODES.INVALID_PUBLIC_KEY:
      return ENCRYPTION_ERROR_CATEGORIES.KEY_EXCHANGE_FAILED;
    case ENCRYPTION_ERROR_CODES.KEY_UNAVAILABLE:
    case ENCRYPTION_ERROR_CODES.KEY_STORAGE_FAILED:
    case ENCRYPTION_ERROR_CODES.IDENTITY_KEY_NOT_FOUND:
    case ENCRYPTION_ERROR_CODES.KEY_REGISTRY_UNAVAILABLE:
      return ENCRYPTION_ERROR_CATEGORIES.KEY_UNAVAILABLE;
    case ENCRYPTION_ERROR_CODES.IDENTITY_KEY_CHANGED:
      return ENCRYPTION_ERROR_CATEGORIES.IDENTITY_KEY_CHANGED;
    default:
      return ENCRYPTION_ERROR_CATEGORIES.ENCRYPTION_FAILED;
  }
}

/**
 * Default safe technical message per encryption error code.
 * @param {string} code
 * @returns {string}
 */
function defaultCryptoTechnicalMessage(code) {
  switch (code) {
    case ENCRYPTION_ERROR_CODES.ENCRYPTION_FAILED:
    case ENCRYPTION_ERROR_CODES.FILE_ENCRYPTION_FAILED:
      return 'Encryption operation failed';
    case ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED:
    case ENCRYPTION_ERROR_CODES.FILE_DECRYPTION_FAILED:
      return 'Decryption operation failed';
    case ENCRYPTION_ERROR_CODES.INVALID_CIPHERTEXT:
      return 'Invalid or corrupted ciphertext payload';
    case ENCRYPTION_ERROR_CODES.KEY_EXCHANGE_FAILED:
    case ENCRYPTION_ERROR_CODES.KEY_DERIVATION_FAILED:
    case ENCRYPTION_ERROR_CODES.INVALID_PUBLIC_KEY:
      return 'Key exchange or derivation failed';
    case ENCRYPTION_ERROR_CODES.KEY_UNAVAILABLE:
    case ENCRYPTION_ERROR_CODES.KEY_STORAGE_FAILED:
    case ENCRYPTION_ERROR_CODES.IDENTITY_KEY_NOT_FOUND:
    case ENCRYPTION_ERROR_CODES.KEY_REGISTRY_UNAVAILABLE:
      return 'Required cryptographic key is unavailable';
    case ENCRYPTION_ERROR_CODES.IDENTITY_KEY_CHANGED:
      return 'Peer identity key changed; verification required';
    default:
      return 'Cryptographic operation failed';
  }
}

/**
 * Sanitize metadata for encryption errors.
 * Never logs plaintext, private keys, shared secrets, derived keys, ciphertexts, nonces, or salts.
 *
 * @param {Record<string, any>} [meta]
 * @returns {Record<string, any>}
 */
export function sanitizeEncryptionMetadata(meta = {}) {
  if (!meta || typeof meta !== 'object') {
    return {};
  }

  /** @type {Record<string, any>} */
  const safeMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    const normalizedKey = key.toLowerCase().replace(/[-_\s.]/g, '');

    if (SAFE_CRYPTO_CONTEXT_KEYS.has(normalizedKey) && (typeof value === 'string' || typeof value === 'number')) {
      safeMeta[key] = typeof value === 'string' ? sanitizeString(value) : value;
    } else if (normalizedKey === 'code' && isSafeErrorCode(value)) {
      safeMeta[key] = value;
    } else {
      safeMeta[key] = '[REDACTED]';
    }
  }

  return sanitize(safeMeta);
}

/**
 * Normalized Encryption Error class.
 */
export class EncryptionError extends Error {
  /**
   * @param {string | {
   *   code?: string,
   *   category?: string,
   *   message?: string,
   *   operation?: string,
   *   conversationId?: string,
   *   logged?: boolean
   * }} codeOrOptions
   * @param {string} [message]
   * @param {{
   *   category?: string,
   *   operation?: string,
   *   conversationId?: string,
   *   logged?: boolean
   * }} [options]
   */
  constructor(codeOrOptions, message, options = {}) {
    if (codeOrOptions && typeof codeOrOptions === 'object') {
      const opts = codeOrOptions;
      const resolvedCode =
        opts.code && KNOWN_ENCRYPTION_CODES.has(opts.code)
          ? opts.code
          : ENCRYPTION_ERROR_CODES.ENCRYPTION_FAILED;
      const resolvedCategory = opts.category || mapEncryptionCodeToCategory(resolvedCode);
      const safeMsg = sanitizeCryptoErrorMessage(opts.message, resolvedCode);

      super(safeMsg);
      this.name = 'EncryptionError';
      this.code = resolvedCode;
      this.category = resolvedCategory;
      this.source = 'encryption';
      this.operation = opts.operation ? sanitizeString(String(opts.operation)) : undefined;
      this.logged = Boolean(opts.logged);
    } else {
      const candidateCode = typeof codeOrOptions === 'string' ? codeOrOptions.toUpperCase() : '';
      const resolvedCode = KNOWN_ENCRYPTION_CODES.has(candidateCode)
        ? candidateCode
        : ENCRYPTION_ERROR_CODES.ENCRYPTION_FAILED;
      const resolvedCategory = options.category || mapEncryptionCodeToCategory(resolvedCode);
      const safeMsg = sanitizeCryptoErrorMessage(message, resolvedCode);

      super(safeMsg);
      this.name = 'EncryptionError';
      this.code = resolvedCode;
      this.category = resolvedCategory;
      this.source = 'encryption';
      this.operation = options.operation ? sanitizeString(String(options.operation)) : undefined;
      this.logged = Boolean(options.logged);
    }
  }

  toJSON() {
    return {
      code: this.code,
      category: this.category,
      source: this.source,
      operation: this.operation,
      message: this.message
    };
  }
}

/**
 * Sanitize an encryption error message to strip any embedded keys, secrets, plaintexts,
 * ciphertexts, nonces, or stack traces.
 *
 * @param {any} rawMessage
 * @param {string} code
 * @returns {string}
 */
function sanitizeCryptoErrorMessage(rawMessage, code) {
  if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
    return defaultCryptoTechnicalMessage(code);
  }
  const scrubbed = sanitizeString(rawMessage.trim());
  return scrubbed || defaultCryptoTechnicalMessage(code);
}

/**
 * Resolve the canonical encryption error code from an error instance and operation context.
 *
 * @param {any} error
 * @param {{
 *   code?: string,
 *   operation?: string
 * }} [context]
 * @returns {string}
 */
function resolveEncryptionErrorCode(error, context = {}) {
  if (error instanceof EncryptionError && KNOWN_ENCRYPTION_CODES.has(error.code)) {
    return error.code;
  }

  if (error?.name === 'IdentityKeyChangedError' || error?.code === ENCRYPTION_ERROR_CODES.IDENTITY_KEY_CHANGED) {
    return ENCRYPTION_ERROR_CODES.IDENTITY_KEY_CHANGED;
  }

  if (typeof error?.code === 'string') {
    const upper = error.code.toUpperCase();
    if (KNOWN_ENCRYPTION_CODES.has(upper)) {
      return upper;
    }
  }

  if (typeof context.code === 'string') {
    const upper = context.code.toUpperCase();
    if (KNOWN_ENCRYPTION_CODES.has(upper)) {
      return upper;
    }
  }

  const op = String(context.operation || error?.operation || '').toLowerCase();
  if (op.includes('file-encrypt')) return ENCRYPTION_ERROR_CODES.FILE_ENCRYPTION_FAILED;
  if (op.includes('file-decrypt')) return ENCRYPTION_ERROR_CODES.FILE_DECRYPTION_FAILED;
  if (op.includes('invalid-ciphertext')) return ENCRYPTION_ERROR_CODES.INVALID_CIPHERTEXT;
  if (op.includes('decrypt')) return ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED;
  if (op.includes('exchange') || op.includes('derive') || op.includes('session')) {
    return ENCRYPTION_ERROR_CODES.KEY_EXCHANGE_FAILED;
  }
  if (op.includes('store') || op.includes('unavailable') || op.includes('load-key') || op.includes('key')) {
    return ENCRYPTION_ERROR_CODES.KEY_UNAVAILABLE;
  }

  return ENCRYPTION_ERROR_CODES.ENCRYPTION_FAILED;
}

/**
 * Normalize any error from Web Crypto, IndexedDB key store, or E2EE helpers into an `EncryptionError`.
 *
 * @param {any} error
 * @param {{
 *   code?: string,
 *   category?: string,
 *   operation?: string,
 *   conversationId?: string,
 *   message?: string
 * }} [context]
 * @returns {EncryptionError}
 */
export function normalizeEncryptionError(error, context = {}) {
  if (error instanceof EncryptionError && (!context.code || error.code === context.code)) {
    if (context.operation && !error.operation) {
      error.operation = sanitizeString(context.operation);
    }
    return error;
  }

  const resolvedCode = resolveEncryptionErrorCode(error, context);
  const resolvedCategory = context.category || mapEncryptionCodeToCategory(resolvedCode);
  const rawMessage =
    context.message ||
    (typeof error?.message === 'string' && error.message ? error.message : defaultCryptoTechnicalMessage(resolvedCode));

  return new EncryptionError({
    code: resolvedCode,
    category: resolvedCategory,
    message: rawMessage,
    operation: context.operation || error?.operation,
    logged: Boolean(error?.logged)
  });
}

/**
 * Normalize and securely log an encryption error without exposing plaintext,
 * private keys, shared secrets, derived keys, nonces, salts, or raw ciphertexts.
 *
 * @param {any} error
 * @param {{
 *   code?: string,
 *   category?: string,
 *   operation?: string,
 *   conversationId?: string,
 *   message?: string,
 *   meta?: Record<string, any>,
 *   silent?: boolean,
 *   forceLog?: boolean
 * }} [context]
 * @returns {EncryptionError}
 */
export function logEncryptionError(error, context = {}) {
  const normalized = normalizeEncryptionError(error, context);

  if ((normalized.logged && !context.forceLog) || context.silent) {
    return normalized;
  }

  /** @type {Record<string, any>} */
  const safeLogMeta = {
    code: normalized.code,
    category: normalized.category,
    source: normalized.source
  };

  if (normalized.operation) {
    safeLogMeta.operation = normalized.operation;
  }
  if (context.conversationId) {
    safeLogMeta.conversationId = sanitizeString(String(context.conversationId));
  }
  if (context.meta && typeof context.meta === 'object') {
    safeLogMeta.context = sanitizeEncryptionMetadata(context.meta);
  }

  logger.error(
    `Encryption Error [${normalized.code}]: ${defaultCryptoTechnicalMessage(normalized.code)}`,
    safeLogMeta
  );
  normalized.logged = true;

  return normalized;
}

/**
 * Normalize and handle an encryption error (logging once unless `silent: true`).
 *
 * @param {any} error
 * @param {Parameters<typeof logEncryptionError>[1]} [context]
 * @returns {EncryptionError}
 */
export function handleEncryptionError(error, context = {}) {
  return logEncryptionError(error, context);
}

export default {
  ENCRYPTION_ERROR_CATEGORIES,
  ENCRYPTION_ERROR_CODES,
  EncryptionError,
  mapEncryptionCodeToCategory,
  sanitizeEncryptionMetadata,
  normalizeEncryptionError,
  logEncryptionError,
  handleEncryptionError
};

