import logger, { sanitize, sanitizeString, sanitizeUrl, isSafeErrorCode } from '../lib/logger.js';

export { sanitizeUrl };

/**
 * Standard API error categories and machine-readable error codes.
 */
export const API_ERROR_CATEGORIES = Object.freeze({
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  SERVER_ERROR: 'SERVER_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
});

export const API_ERROR_CODES = Object.freeze({
  // Network & transport
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  INVALID_RESPONSE: 'INVALID_RESPONSE',

  // Validation & client request
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  // Authentication
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  MFA_ALREADY_ENABLED: 'MFA_ALREADY_ENABLED',
  MFA_NOT_ENABLED: 'MFA_NOT_ENABLED',
  INVALID_MFA_CODE: 'INVALID_MFA_CODE',
  INVALID_RESET_TOKEN: 'INVALID_RESET_TOKEN',
  RESET_TOKEN_EXPIRED: 'RESET_TOKEN_EXPIRED',

  // Authorization
  FORBIDDEN: 'FORBIDDEN',
  NOT_CONVERSATION_MEMBER: 'NOT_CONVERSATION_MEMBER',
  NOT_MESSAGE_OWNER: 'NOT_MESSAGE_OWNER',

  // Resource / Not found
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',

  // Conflict
  CONFLICT: 'CONFLICT',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  FRIENDSHIP_ALREADY_EXISTS: 'FRIENDSHIP_ALREADY_EXISTS',

  // Rate limit
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',

  // E2EE key registry API codes
  INVALID_PUBLIC_KEY: 'INVALID_PUBLIC_KEY',
  IDENTITY_KEY_NOT_FOUND: 'IDENTITY_KEY_NOT_FOUND',
  KEY_REGISTRY_UNAVAILABLE: 'KEY_REGISTRY_UNAVAILABLE',

  // Server & fallback
  SERVER_ERROR: 'SERVER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
});

/** @type {Set<string>} */
const KNOWN_API_CODES = new Set(Object.values(API_ERROR_CODES));

/**
 * Patterns indicating internal server details that must never be preserved as client-facing messages.
 */
const INTERNAL_SERVER_PATTERNS = [
  /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b[\s\S]*?\b(FROM|INTO|TABLE|SET|WHERE)\b/i,
  /\b(postgres|postgresql|pg_hba|prisma|sequelize|redis|typeorm|knex|syntax error at or near)\b/i,
  /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EACCES|EPERM)\b/,
  /(\r?\n\s*at\s+[^\r\n]+)/,
  /(?:[a-zA-Z]:\\(?:[^\\\s'"]+\\)+[^\\\s'"]+|\/(?:var|usr|etc|home|opt|app|srv|tmp|root|proc)\/[^\s'"]+)/,
  /\b(ReferenceError|TypeError|SyntaxError|RangeError|UnhandledPromiseRejection)\s*:/
];

/**
 * Determine if a message string contains raw internal server or runtime leak patterns.
 * @param {string} msg
 * @returns {boolean}
 */
function hasInternalServerDetails(msg) {
  if (typeof msg !== 'string' || !msg) return false;
  return INTERNAL_SERVER_PATTERNS.some((pattern) => pattern.test(msg));
}

/**
 * Map HTTP status code to a high-level API error category.
 * @param {number | null | undefined} status
 * @param {string} [fallbackCategory]
 * @returns {string}
 */
export function mapStatusToCategory(status, fallbackCategory = API_ERROR_CATEGORIES.UNKNOWN_ERROR) {
  if (typeof status !== 'number' || status <= 0) {
    return fallbackCategory;
  }
  if (status === 400 || status === 422) return API_ERROR_CATEGORIES.VALIDATION_ERROR;
  if (status === 401) return API_ERROR_CATEGORIES.UNAUTHORIZED;
  if (status === 403) return API_ERROR_CATEGORIES.FORBIDDEN;
  if (status === 404) return API_ERROR_CATEGORIES.NOT_FOUND;
  if (status === 408) return API_ERROR_CATEGORIES.REQUEST_TIMEOUT;
  if (status === 409) return API_ERROR_CATEGORIES.CONFLICT;
  if (status === 413) return API_ERROR_CATEGORIES.PAYLOAD_TOO_LARGE;
  if (status === 423) return API_ERROR_CATEGORIES.UNAUTHORIZED;
  if (status === 429) return API_ERROR_CATEGORIES.TOO_MANY_REQUESTS;
  if (status >= 500) return API_ERROR_CATEGORIES.SERVER_ERROR;
  return fallbackCategory;
}

/**
 * Map HTTP status code to a default canonical error code.
 * @param {number | null | undefined} status
 * @param {string} [fallbackCode]
 * @returns {string}
 */
export function mapStatusToCode(status, fallbackCode = API_ERROR_CODES.UNKNOWN_ERROR) {
  if (typeof status !== 'number' || status <= 0) {
    return fallbackCode;
  }
  if (status === 400) return API_ERROR_CODES.BAD_REQUEST;
  if (status === 401) return API_ERROR_CODES.UNAUTHORIZED;
  if (status === 403) return API_ERROR_CODES.FORBIDDEN;
  if (status === 404) return API_ERROR_CODES.NOT_FOUND;
  if (status === 408) return API_ERROR_CODES.REQUEST_TIMEOUT;
  if (status === 409) return API_ERROR_CODES.CONFLICT;
  if (status === 413) return API_ERROR_CODES.PAYLOAD_TOO_LARGE;
  if (status === 422) return API_ERROR_CODES.VALIDATION_ERROR;
  if (status === 423) return API_ERROR_CODES.LOGIN_LOCKED;
  if (status === 429) return API_ERROR_CODES.TOO_MANY_REQUESTS;
  if (status >= 500) return API_ERROR_CODES.SERVER_ERROR;
  return fallbackCode;
}

/**
 * Default safe technical message per error code.
 * @param {string} code
 * @param {number | null} [status]
 * @returns {string}
 */
function defaultTechnicalMessage(code, status) {
  switch (code) {
    case API_ERROR_CODES.NETWORK_ERROR:
      return 'Network request failed';
    case API_ERROR_CODES.REQUEST_TIMEOUT:
      return 'API request timed out';
    case API_ERROR_CODES.INVALID_RESPONSE:
      return 'Invalid or malformed API response';
    case API_ERROR_CODES.UNAUTHORIZED:
    case API_ERROR_CODES.SESSION_EXPIRED:
    case API_ERROR_CODES.INVALID_CREDENTIALS:
      return 'Authentication required or failed';
    case API_ERROR_CODES.FORBIDDEN:
      return 'Access forbidden';
    case API_ERROR_CODES.NOT_FOUND:
    case API_ERROR_CODES.RESOURCE_NOT_FOUND:
      return 'Requested resource not found';
    case API_ERROR_CODES.CONFLICT:
      return 'Resource conflict';
    case API_ERROR_CODES.TOO_MANY_REQUESTS:
      return 'Rate limit exceeded';
    case API_ERROR_CODES.VALIDATION_ERROR:
    case API_ERROR_CODES.BAD_REQUEST:
      return 'Request validation failed';
    case API_ERROR_CODES.SERVER_ERROR:
    case API_ERROR_CODES.INTERNAL_ERROR:
      return status ? `Server error (${status})` : 'Internal server error';
    default:
      return status ? `API request failed (${status})` : 'API request failed';
  }
}

/**
 * Sanitize metadata specifically for API error logging.
 * Ensures URLs have no query strings, bodies/headers/tokens/credentials are redacted,
 * and nested strings are scrubbed.
 *
 * @param {Record<string, any>} [meta]
 * @returns {Record<string, any>}
 */
export function sanitizeApiMetadata(meta = {}) {
  if (!meta || typeof meta !== 'object') {
    return {};
  }
  return sanitize(meta);
}

/**
 * Normalized API Error class.
 * Supports both options object `new ApiError({ code, status, message, ... })`
 * and legacy positional `new ApiError(status, message, data, code)`.
 */
export class ApiError extends Error {
  /**
   * @param {number | {
   *   code?: string,
   *   category?: string,
   *   status?: number | null,
   *   message?: string,
   *   endpoint?: string,
   *   method?: string,
   *   logged?: boolean
   * }} statusOrOptions
   * @param {string} [message]
   * @param {any} [data]
   * @param {string} [code]
   */
  constructor(statusOrOptions, message, data, code) {
    if (statusOrOptions && typeof statusOrOptions === 'object') {
      const opts = statusOrOptions;
      const resolvedStatus = typeof opts.status === 'number' ? opts.status : null;
      const resolvedCode =
        opts.code && KNOWN_API_CODES.has(opts.code)
          ? opts.code
          : mapStatusToCode(resolvedStatus, API_ERROR_CODES.UNKNOWN_ERROR);
      const resolvedCategory =
        opts.category || mapStatusToCategory(resolvedStatus, resolvedCode);
      const safeMsg = sanitizeApiErrorMessage(opts.message, resolvedCode, resolvedStatus);

      super(safeMsg);
      this.name = 'ApiError';
      this.code = resolvedCode;
      this.category = resolvedCategory;
      this.source = 'api';
      this.status = resolvedStatus;
      this.endpoint = opts.endpoint ? sanitizeUrl(opts.endpoint) : undefined;
      this.method = opts.method ? String(opts.method).toUpperCase() : undefined;
      this.logged = Boolean(opts.logged);
    } else {
      const resolvedStatus = typeof statusOrOptions === 'number' ? statusOrOptions : null;
      const extractedBackendCode =
        code ||
        data?.error?.code ||
        data?.code;
      const resolvedCode = resolveCanonicalApiCode(resolvedStatus, extractedBackendCode);
      const resolvedCategory = mapStatusToCategory(resolvedStatus, resolvedCode);
      const safeMsg = sanitizeApiErrorMessage(message, resolvedCode, resolvedStatus);

      super(safeMsg);
      this.name = 'ApiError';
      this.code = resolvedCode;
      this.category = resolvedCategory;
      this.source = 'api';
      this.status = resolvedStatus;
      this.logged = false;
    }
  }

  toJSON() {
    return {
      code: this.code,
      category: this.category,
      source: this.source,
      status: this.status,
      message: this.message
    };
  }
}

/**
 * Resolve a canonical API error code from HTTP status and optional backend error code.
 * @param {number | null | undefined} status
 * @param {any} rawCode
 * @param {any} [data]
 * @returns {string}
 */
function resolveCanonicalApiCode(status, rawCode, data) {
  const candidate = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';

  if (candidate === API_ERROR_CODES.INTERNAL_ERROR) {
    return API_ERROR_CODES.SERVER_ERROR;
  }

  // For 500+ errors, only preserve explicit safe service-unavailable codes like KEY_REGISTRY_UNAVAILABLE
  if (typeof status === 'number' && status >= 500) {
    if (candidate === API_ERROR_CODES.KEY_REGISTRY_UNAVAILABLE) {
      return API_ERROR_CODES.KEY_REGISTRY_UNAVAILABLE;
    }
    return API_ERROR_CODES.SERVER_ERROR;
  }

  if (candidate && KNOWN_API_CODES.has(candidate)) {
    return candidate;
  }

  if (
    status === 400 &&
    (Array.isArray(data?.error?.details) || Array.isArray(data?.errors) || data?.error?.fields)
  ) {
    return API_ERROR_CODES.VALIDATION_ERROR;
  }

  return mapStatusToCode(status, API_ERROR_CODES.UNKNOWN_ERROR);
}

/**
 * Sanitize an API error message so internal backend details, SQL, stack traces,
 * and sensitive tokens/passwords are never stored on the error instance.
 *
 * @param {any} rawMessage
 * @param {string} code
 * @param {number | null} status
 * @returns {string}
 */
function sanitizeApiErrorMessage(rawMessage, code, status) {
  if (typeof status === 'number' && status >= 500 && code === API_ERROR_CODES.SERVER_ERROR) {
    return defaultTechnicalMessage(code, status);
  }

  if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
    return defaultTechnicalMessage(code, status);
  }

  if (hasInternalServerDetails(rawMessage)) {
    return defaultTechnicalMessage(code, status);
  }

  const scrubbed = sanitizeString(rawMessage.trim());
  if (!scrubbed) {
    return defaultTechnicalMessage(code, status);
  }

  return scrubbed;
}

/**
 * Detect whether an error represents a request timeout / abort.
 * @param {any} error
 * @param {Record<string, any>} [context]
 * @returns {boolean}
 */
function isTimeoutError(error, context = {}) {
  if (
    context.code === API_ERROR_CODES.REQUEST_TIMEOUT ||
    context.category === API_ERROR_CATEGORIES.REQUEST_TIMEOUT ||
    context.status === 408
  ) {
    return true;
  }
  if (!error) return false;
  const name = String(error.name || '');
  const code = String(error.code || '').toUpperCase();
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    code === 'REQUEST_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    code === 'ABORT_ERR'
  ) {
    return true;
  }
  return false;
}

/**
 * Detect whether an error represents an invalid/malformed API response.
 * @param {any} error
 * @param {Record<string, any>} [context]
 * @returns {boolean}
 */
function isInvalidResponseError(error, context = {}) {
  if (
    context.code === API_ERROR_CODES.INVALID_RESPONSE ||
    context.category === API_ERROR_CATEGORIES.INVALID_RESPONSE
  ) {
    return true;
  }
  if (!error) return false;
  return error.name === 'SyntaxError' || error.code === API_ERROR_CODES.INVALID_RESPONSE;
}

/**
 * Detect whether an error represents a network connectivity failure.
 * @param {any} error
 * @param {Record<string, any>} [context]
 * @returns {boolean}
 */
function isNetworkFailure(error, context = {}) {
  if (
    context.code === API_ERROR_CODES.NETWORK_ERROR ||
    context.category === API_ERROR_CATEGORIES.NETWORK_ERROR
  ) {
    return true;
  }
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  if (
    code === 'NETWORK_ERROR' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ERR_NETWORK' ||
    code === 'ECONNRESET'
  ) {
    return true;
  }
  if (error instanceof TypeError && !context.status && !(/** @type {any} */ (error).status)) {
    return true;
  }
  return false;
}

/**
 * Normalize any error from fetch, HTTP response, or API layer into a consistent `ApiError`.
 *
 * @param {any} error
 * @param {{
 *   status?: number | null,
 *   code?: string,
 *   category?: string,
 *   endpoint?: string,
 *   url?: string,
 *   method?: string,
 *   data?: any
 * }} [context]
 * @returns {ApiError}
 */
export function normalizeApiError(error, context = {}) {
  if (error instanceof ApiError) {
    if (context.endpoint && !error.endpoint) {
      error.endpoint = sanitizeUrl(context.endpoint);
    }
    if (context.method && !error.method) {
      error.method = String(context.method).toUpperCase();
    }
    return error;
  }

  const endpoint = context.endpoint || context.url || error?.endpoint || error?.url;
  const method = context.method || error?.method;

  // 1. Timeout / Abort
  if (isTimeoutError(error, context)) {
    return new ApiError({
      code: API_ERROR_CODES.REQUEST_TIMEOUT,
      category: API_ERROR_CATEGORIES.REQUEST_TIMEOUT,
      status: context.status ?? error?.status ?? 408,
      message: defaultTechnicalMessage(API_ERROR_CODES.REQUEST_TIMEOUT, 408),
      endpoint,
      method,
      logged: Boolean(error?.logged)
    });
  }

  // 2. Invalid / unparseable API response
  if (isInvalidResponseError(error, context)) {
    return new ApiError({
      code: API_ERROR_CODES.INVALID_RESPONSE,
      category: API_ERROR_CATEGORIES.INVALID_RESPONSE,
      status: context.status ?? error?.status ?? null,
      message: defaultTechnicalMessage(API_ERROR_CODES.INVALID_RESPONSE, null),
      endpoint,
      method,
      logged: Boolean(error?.logged)
    });
  }

  // 3. Network connectivity error
  if (isNetworkFailure(error, context)) {
    return new ApiError({
      code: API_ERROR_CODES.NETWORK_ERROR,
      category: API_ERROR_CATEGORIES.NETWORK_ERROR,
      status: 0,
      message: defaultTechnicalMessage(API_ERROR_CODES.NETWORK_ERROR, 0),
      endpoint,
      method,
      logged: Boolean(error?.logged)
    });
  }

  // 4. HTTP status or backend structured error
  const status =
    typeof context.status === 'number'
      ? context.status
      : typeof error?.status === 'number'
        ? error.status
        : typeof error?.statusCode === 'number'
          ? error.statusCode
          : null;

  const data = context.data ?? error?.data ?? null;
  const rawCode =
    context.code ||
    data?.error?.code ||
    data?.code ||
    (isSafeErrorCode(error?.code) ? error.code : undefined);

  const resolvedCode = resolveCanonicalApiCode(status, rawCode, data);
  const resolvedCategory =
    context.category || mapStatusToCategory(status, resolvedCode);

  const rawMessage =
    data?.error?.message ||
    (typeof data?.error === 'string' ? data.error : null) ||
    data?.message ||
    error?.message ||
    defaultTechnicalMessage(resolvedCode, status);

  return new ApiError({
    code: resolvedCode,
    category: resolvedCategory,
    status,
    message: sanitizeApiErrorMessage(rawMessage, resolvedCode, status),
    endpoint,
    method,
    logged: Boolean(error?.logged)
  });
}

/**
 * Normalize and securely log an API error without leaking sensitive payloads,
 * headers, credentials, or query parameters.
 *
 * @param {any} error
 * @param {{
 *   status?: number | null,
 *   code?: string,
 *   category?: string,
 *   endpoint?: string,
 *   url?: string,
 *   method?: string,
 *   data?: any,
 *   meta?: Record<string, any>,
 *   silent?: boolean,
 *   forceLog?: boolean
 * }} [context]
 * @returns {ApiError}
 */
export function logApiError(error, context = {}) {
  const normalized = normalizeApiError(error, context);

  if ((normalized.logged && !context.forceLog) || context.silent) {
    return normalized;
  }

  /** @type {Record<string, any>} */
  const safeLogMeta = {
    code: normalized.code,
    category: normalized.category,
    source: normalized.source
  };

  if (typeof normalized.status === 'number' && normalized.status > 0) {
    safeLogMeta.status = normalized.status;
  }
  if (normalized.method) {
    safeLogMeta.method = normalized.method;
  }
  if (normalized.endpoint) {
    safeLogMeta.endpoint = sanitizeUrl(normalized.endpoint);
  }
  if (context.meta && typeof context.meta === 'object') {
    safeLogMeta.context = sanitizeApiMetadata(context.meta);
  }

  const rawDiagnostic =
    typeof error?.message === 'string' && error.message
      ? sanitizeString(error.message)
      : normalized.message;

  logger.error(`API Error [${normalized.code}]: ${rawDiagnostic}`, safeLogMeta);
  normalized.logged = true;

  return normalized;
}

/**
 * Normalize and handle an API error (logging once unless `silent: true`).
 *
 * @param {any} error
 * @param {Parameters<typeof logApiError>[1]} [context]
 * @returns {ApiError}
 */
export function handleApiError(error, context = {}) {
  return logApiError(error, context);
}

export default {
  API_ERROR_CATEGORIES,
  API_ERROR_CODES,
  ApiError,
  mapStatusToCategory,
  mapStatusToCode,
  sanitizeUrl,
  sanitizeApiMetadata,
  normalizeApiError,
  logApiError,
  handleApiError
};
