const getAppEnv = () => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_APP_ENV) {
    return import.meta.env.VITE_APP_ENV;
  }
  if (typeof process !== 'undefined' && process.env && process.env.VITE_APP_ENV) {
    return process.env.VITE_APP_ENV;
  }
  return 'development';
};

/**
 * Sensitive fields that must NEVER be logged into the browser console (rule §34).
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'oldpassword',
  'currentpassword',
  'confirmpassword',
  'passwd',
  'pwd',
  'pass',
  'privatekey',
  'publickey',
  'sharedsecret',
  'derivedkey',
  'masterkey',
  'cipherkey',
  'filekey',
  'encryptedfilekey',
  'rawkey',
  'rawfilekey',
  'basekey',
  'key',
  'keypair',
  'keymaterial',
  'secret',
  'clientsecret',
  'apisecret',
  'sessionsecret',
  'jwtsecret',
  'totpsecret',
  'mfasecret',
  'seed',
  'mnemonic',
  'salt',
  'iv',
  'nonce',
  'metadatanonce',
  'filenonce',
  'keynonce',
  'bodyciphertext',
  'metadataciphertext',
  'ciphertext',
  'encryptedcontent',
  'encryptedmetadata',
  'encryptedblob',
  'plaintext',
  'plaintextpreview',
  'messagetext',
  'messagebody',
  'body',
  'requestbody',
  'responsebody',
  'rawbody',
  'rawresponse',
  'data',
  'content',
  'file',
  'filedata',
  'blob',
  'buffer',
  'token',
  'accesstoken',
  'refreshtoken',
  'resettoken',
  'authtoken',
  'idtoken',
  'csrftoken',
  'apikey',
  'xapikey',
  'xauthtoken',
  'authorization',
  'auth',
  'cookie',
  'cookies',
  'setcookie',
  'session',
  'sessionid',
  'sid',
  'connectsid',
  'credential',
  'credentials',
  'pin',
  'otp',
  'otpcode',
  'mfacode',
  'recoverycode',
  'recoverycodes',
  'challengeid',
  'stack',
  'stacktrace',
  'sql',
  'query',
  'headers'
]);

const URL_KEYS = new Set(['url', 'endpoint', 'path', 'href', 'originalurl', 'requesturl']);

/**
 * Check whether a string looks like a safe machine-readable error code (e.g. 'NETWORK_ERROR').
 * @param {any} code
 * @returns {boolean}
 */
export function isSafeErrorCode(code) {
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code);
}

/**
 * Sanitize a URL or endpoint path so full origins, credentials, and query parameters are stripped.
 * @param {string} rawUrl
 * @returns {string}
 */
export function sanitizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return '';
  }

  const trimmed = rawUrl.trim();

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      return parsed.pathname || '/';
    }
  } catch {
    // Fall through to regex stripping
  }

  return (
    trimmed
      .replace(/^https?:\/\/[^/?#]+/i, '')
      .split('?')[0]
      .split('#')[0] || '/'
  );
}

/**
 * Sanitize a free-form string to redact tokens, passwords, private keys, plaintexts,
 * cookies, session IDs, SQL fragments, filesystem paths, and URL query strings.
 * @param {string} input
 * @returns {string}
 */
export function sanitizeString(input) {
  if (typeof input !== 'string' || input.length === 0) {
    return input;
  }

  let out = input;

  // 1. Redact PEM / key blocks
  out = out.replace(
    /-----BEGIN [A-Z0-9 _-]+-----[\s\S]*?(?:-----END [A-Z0-9 _-]+-----|$)/gi,
    '[REDACTED_KEY]'
  );

  // 2. Redact JWT tokens (header.payload.signature)
  out = out.replace(
    /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?\b/g,
    '[REDACTED_TOKEN]'
  );

  // 3. Redact Bearer / Basic authorization values
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]');

  // 4. Redact cookie/session key=value pairs
  out = out.replace(
    /\b(connect\.sid|session_?id|sid|csrf_?token|auth_?token|refresh_?token|access_?token)\s*=\s*[^;\s,'"]+/gi,
    '$1=[REDACTED]'
  );

  // 5. Redact sensitive key: "value" or key='value' (including spaces inside quotes)
  const sensitivePatternSource =
    'password|new[_\\s-]?password|old[_\\s-]?password|confirm[_\\s-]?password|passwd|pwd|' +
    'secret|shared[_\\s-]?secret|session[_\\s-]?secret|jwt[_\\s-]?secret|' +
    'private[_\\s-]?key|derived[_\\s-]?key|master[_\\s-]?key|cipher[_\\s-]?key|file[_\\s-]?key|api[_\\s-]?key|' +
    'access[_\\s-]?token|refresh[_\\s-]?token|reset[_\\s-]?token|auth[_\\s-]?token|id[_\\s-]?token|token|' +
    'session[_\\s-]?id|cookie|authorization|credential|credentials|' +
    'plaintext|plaintext[_\\s-]?preview|body[_\\s-]?ciphertext|metadata[_\\s-]?ciphertext|ciphertext|' +
    'metadata[_\\s-]?nonce|file[_\\s-]?nonce|key[_\\s-]?nonce|nonce|salt|seed|pin|otp|mfa[_\\s-]?code|recovery[_\\s-]?code';

  const quotedKvRegex = new RegExp(
    `\\b(${sensitivePatternSource})\\s*[:=]\\s*(['"\`])([\\s\\S]*?)\\2`,
    'gi'
  );
  out = out.replace(quotedKvRegex, '$1=[REDACTED]');

  const unquotedKvRegex = new RegExp(
    `\\b(${sensitivePatternSource})\\s*[:=]\\s*([^\\s,'";\\n\\r})\\]]+)`,
    'gi'
  );
  out = out.replace(unquotedKvRegex, '$1=[REDACTED]');

  const spaceQuotedRegex = new RegExp(
    `\\b(${sensitivePatternSource})\\s+(['"\`])([\\s\\S]*?)\\2`,
    'gi'
  );
  out = out.replace(spaceQuotedRegex, '$1 [REDACTED]');

  // 6. Sanitize full URLs and strip query parameters
  out = out.replace(/https?:\/\/[^\s,'")\]>]+/gi, (match) => sanitizeUrl(match));
  out = out.replace(/(\/[A-Za-z0-9._~:/[\]@!$&()*+,;=-]+)\?[^\s,'")\]>]+/g, '$1');

  // 7. Redact SQL queries
  out = out.replace(
    /\b(SELECT\s+[\s\S]+?\s+FROM\s+\S+|INSERT\s+INTO\s+\S+[\s\S]*|UPDATE\s+\S+\s+SET\s+[\s\S]*|DELETE\s+FROM\s+\S+[\s\S]*|DROP\s+TABLE\s+\S+)/gi,
    '[REDACTED_SQL]'
  );

  // 8. Strip stack trace lines
  out = out.replace(/(\r?\n\s*at\s+[^\r\n]+)+/g, '');

  // 9. Redact server/local filesystem paths
  out = out.replace(
    /(?:[a-zA-Z]:\\(?:[^\\\s'"]+\\)+[^\\\s'"]+|\/(?:var|usr|etc|home|opt|app|srv|tmp|root|proc)\/[^\s'"]+)/g,
    '[REDACTED_PATH]'
  );

  // 10. Redact long hex strings (e.g. 40+ hex chars representing keys/hashes/tokens)
  out = out.replace(/\b[A-Fa-f0-9]{40,}\b/g, '[REDACTED_HEX]');

  return out;
}

/**
 * Recursively sanitize objects, arrays, and strings to prevent leaking sensitive values in browser console.
 * @param {any} data
 * @param {number} [depth=0]
 * @returns {any}
 */
export function sanitize(data, depth = 0) {
  if (depth > 5) {
    return '[Truncated]';
  }

  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  if (typeof data === 'string') {
    return sanitizeString(data);
  }

  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return '[REDACTED]';
  }

  if (typeof CryptoKey !== 'undefined' && data instanceof CryptoKey) {
    return '[REDACTED]';
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return '[REDACTED]';
  }

  if (data instanceof Error) {
    const anyErr = /** @type {any} */ (data);
    /** @type {Record<string, any>} */
    const errSummary = {
      name: sanitizeString(data.name || 'Error'),
      message: sanitizeString(data.message || '')
    };

    if (typeof anyErr.status === 'number') {
      errSummary.status = anyErr.status;
    }
    if (isSafeErrorCode(anyErr.code)) {
      errSummary.code = anyErr.code;
    }
    if (typeof anyErr.category === 'string' && isSafeErrorCode(anyErr.category)) {
      errSummary.category = anyErr.category;
    }
    if (typeof anyErr.source === 'string') {
      errSummary.source = sanitizeString(anyErr.source);
    }
    if (typeof anyErr.operation === 'string') {
      errSummary.operation = sanitizeString(anyErr.operation);
    }
    if (typeof anyErr.endpoint === 'string') {
      errSummary.endpoint = sanitizeUrl(anyErr.endpoint);
    }
    return errSummary;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitize(item, depth + 1));
  }

  if (typeof data === 'object') {
    /** @type {Record<string, any>} */
    const clean = {};
    for (const [key, value] of Object.entries(data)) {
      const normalizedKey = key.toLowerCase().replace(/[-_\s.]/g, '');

      if (SENSITIVE_KEYS.has(normalizedKey)) {
        clean[key] = '[REDACTED]';
      } else if (URL_KEYS.has(normalizedKey)) {
        clean[key] = typeof value === 'string' ? sanitizeUrl(value) : '[REDACTED]';
      } else if (normalizedKey === 'code') {
        clean[key] = isSafeErrorCode(value) ? value : '[REDACTED]';
      } else {
        clean[key] = sanitize(value, depth + 1);
      }
    }
    return clean;
  }

  return '[Unserializable]';
}

const isProduction = getAppEnv() === 'production';

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
      const safeMessage = sanitizeString(String(message));
      if (meta !== undefined) {
        console.debug(`[DEBUG] ${safeMessage}`, sanitize(meta));
      } else {
        console.debug(`[DEBUG] ${safeMessage}`);
      }
    }
  },

  /**
   * @param {string} message
   * @param {any} [meta]
   */
  info: (message, meta) => {
    if (!isProduction) {
      const safeMessage = sanitizeString(String(message));
      if (meta !== undefined) {
        console.info(`[INFO] ${safeMessage}`, sanitize(meta));
      } else {
        console.info(`[INFO] ${safeMessage}`);
      }
    }
  },

  /**
   * @param {string} message
   * @param {any} [meta]
   */
  warn: (message, meta) => {
    const safeMessage = sanitizeString(String(message));
    if (meta !== undefined) {
      console.warn(`[WARN] ${safeMessage}`, sanitize(meta));
    } else {
      console.warn(`[WARN] ${safeMessage}`);
    }
  },

  /**
   * @param {string} message
   * @param {any} [meta]
   */
  error: (message, meta) => {
    const safeMessage = sanitizeString(String(message));
    if (meta !== undefined) {
      console.error(`[ERROR] ${safeMessage}`, sanitize(meta));
    } else {
      console.error(`[ERROR] ${safeMessage}`);
    }
  }
};

export default logger;
