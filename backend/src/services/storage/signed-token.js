import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Capability tokens for the local storage driver's pre-signed URLs.
 *
 * Format: base64url(JSON payload) "." base64url(HMAC-SHA256(payload))
 * Payload: { a: attachmentId, op: 'get' | 'put', exp: unixSeconds }
 *
 * The token carries the attachment id, never the internal storage key, so
 * storage layout is not exposed (rule.md §17). The HMAC key is
 * domain-separated from the configured secret so a token can never be
 * confused with any other value signed by the same secret.
 */

const TOKEN_CONTEXT = 'gettalk:attachment-presigned-url:v1';
const ALLOWED_OPS = new Set(['get', 'put']);

function deriveKey(secret) {
  return createHmac('sha256', secret).update(TOKEN_CONTEXT).digest();
}

function sign(key, data) {
  return createHmac('sha256', key).update(data).digest('base64url');
}

/**
 * @param {string} secret
 * @param {{ attachmentId: string, op: 'get' | 'put', expiresAt: Date }} params
 */
export function createToken(secret, { attachmentId, op, expiresAt }) {
  if (!ALLOWED_OPS.has(op)) throw new Error(`Unsupported token op: ${op}`);
  const payload = Buffer.from(
    JSON.stringify({ a: attachmentId, op, exp: Math.floor(expiresAt.getTime() / 1000) })
  ).toString('base64url');
  return `${payload}.${sign(deriveKey(secret), payload)}`;
}

/**
 * Verify signature, expiry and operation. Returns the attachment id or null.
 *
 * @param {string} secret
 * @param {string} token
 * @param {'get' | 'put'} expectedOp
 * @param {number} [nowMs]
 * @returns {string | null}
 */
export function verifyToken(secret, token, expectedOp, nowMs = Date.now()) {
  if (typeof token !== 'string' || token.length > 1024) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const expected = Buffer.from(sign(deriveKey(secret), payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!data || data.op !== expectedOp || typeof data.a !== 'string') return null;
  if (!Number.isInteger(data.exp) || data.exp * 1000 <= nowMs) return null;

  return data.a;
}

