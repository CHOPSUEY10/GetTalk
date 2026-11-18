/**
 * Sanitized browser logger compliant with GetTalk Rule #34.
 * Never logs passwords, session secrets, CSRF tokens, MFA secrets, SQL queries, or internal server paths.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'secret',
  'sessionsecret',
  'mfasecret',
  'totpsecret',
  'csrftoken',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'setcookie',
  'privatekey',
  'cipherkey',
  'sql',
  'stack',
  'stacktrace',
]);

export function sanitizeUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      return parsed.pathname || '/';
    }
  } catch {
    // Fall through
  }
  return trimmed.split('?')[0].split('#')[0] || '/';
}

export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') return input;
  let out = input;

  // Redact Bearer / Basic tokens
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]');
  // Redact sensitive key=value pairs
  out = out.replace(
    /\b(password|secret|token|csrf_?token|mfa_?secret|session_?id|gt_sec_session)\s*[:=]\s*([^\s,'";\n\r}\]]+)/gi,
    '$1=[REDACTED]'
  );
  // Redact SQL statements
  out = out.replace(
    /\b(SELECT\s+[\s\S]+?\s+FROM\s+\S+|INSERT\s+INTO\s+\S+[\s\S]*|UPDATE\s+\S+\s+SET\s+[\s\S]*|DELETE\s+FROM\s+\S+[\s\S]*|DROP\s+TABLE\s+\S+)/gi,
    '[REDACTED_SQL]'
  );
  // Strip stack traces
  out = out.replace(/(\r?\n\s*at\s+[^\r\n]+)+/g, '');
  // Redact server filesystem paths
  out = out.replace(
    /(?:[a-zA-Z]:\\(?:[^\\\s'"]+\\)+[^\\\s'"]+|\/(?:var|usr|etc|home|opt|srv|tmp|root|proc)\/[^\s'"]+)/g,
    '[REDACTED_PATH]'
  );

  return out;
}

export function sanitize(data: any, depth = 0): any {
  if (depth > 4) return '[Truncated]';
  if (data === null || data === undefined) return data;
  if (typeof data === 'number' || typeof data === 'boolean') return data;
  if (typeof data === 'string') return sanitizeString(data);
  if (Array.isArray(data)) return data.map((item) => sanitize(item, depth + 1));

  if (typeof data === 'object') {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      const norm = k.toLowerCase().replace(/[-_\s.]/g, '');
      if (SENSITIVE_KEYS.has(norm)) {
        clean[k] = '[REDACTED]';
      } else {
        clean[k] = sanitize(v, depth + 1);
      }
    }
    return clean;
  }
  return '[Unserializable]';
}

export const logger = {
  info: (msg: string, meta?: any) => {
    if (meta !== undefined) {
      console.info(`[INFO] ${sanitizeString(msg)}`, sanitize(meta));
    } else {
      console.info(`[INFO] ${sanitizeString(msg)}`);
    }
  },
  warn: (msg: string, meta?: any) => {
    if (meta !== undefined) {
      console.warn(`[WARN] ${sanitizeString(msg)}`, sanitize(meta));
    } else {
      console.warn(`[WARN] ${sanitizeString(msg)}`);
    }
  },
  error: (msg: string, meta?: any) => {
    if (meta !== undefined) {
      console.error(`[ERROR] ${sanitizeString(msg)}`, sanitize(meta));
    } else {
      console.error(`[ERROR] ${sanitizeString(msg)}`);
    }
  },
};

export default logger;

