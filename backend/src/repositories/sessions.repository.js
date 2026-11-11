/**
 * Sessions Repository — database access for sessions table.
 *
 * The `sessions` table is managed by connect-pg-simple (express-session).
 * Schema: sid (PK), sess (JSON containing { userId, ... }), expire.
 *
 * We query the `sess` JSONB column to find sessions belonging to a user.
 * All collective session queries enforce strict pagination bounds (Rule #9).
 */

import { query } from '../config/database.js';
import { MAX_PAGE_LIMIT } from '../validators/pagination.validator.js';

const revokedSessionIds = new Set();

export function isSessionRevoked(sid) {
  return Boolean(sid && revokedSessionIds.has(sid));
}

export function describeUserAgent(ua = '') {
  if (!ua || typeof ua !== 'string') return 'Perangkat Tidak Dikenal';
  const lower = ua.toLowerCase();

  let browser = 'Browser';
  if (lower.includes('edg/')) browser = 'Edge';
  else if (lower.includes('opr/') || lower.includes('opera')) browser = 'Opera';
  else if (lower.includes('chrome/') && !lower.includes('edg/')) browser = 'Chrome';
  else if (lower.includes('firefox/')) browser = 'Firefox';
  else if (lower.includes('safari/') && !lower.includes('chrome/')) browser = 'Safari';
  else if (lower.includes('curl')) browser = 'cURL';
  else if (lower.includes('node') || lower.includes('superagent')) browser = 'Aplikasi Klien';

  let os = '';
  if (lower.includes('windows')) os = 'Windows';
  else if (lower.includes('android')) os = 'Android';
  else if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ios')) os = 'iOS';
  else if (lower.includes('mac os') || lower.includes('macintosh')) os = 'macOS';
  else if (lower.includes('linux')) os = 'Linux';

  return os ? `${browser} di ${os}` : browser;
}

function mapSessionRow(row, currentSid = null) {
  const sess = typeof row.sess === 'string' ? JSON.parse(row.sess) : (row.sess || {});
  const userAgent = sess.userAgent || null;
  return {
    id: row.sid,
    sid: row.sid,
    userAgent,
    deviceName: describeUserAgent(userAgent),
    ipAddress: sess.ipAddress || null,
    createdAt: sess.createdAt || null,
    lastActiveAt: sess.lastActiveAt || sess.createdAt || row.expire || null,
    expire: row.expire,
    expiresAt: row.expire,
    isCurrent: Boolean(currentSid && row.sid === currentSid),
  };
}

/**
 * Persist or update session metadata in PostgreSQL `sessions` table.
 */
export async function upsertSession(sid, sessData, expireDate) {
  if (!sid || !sessData?.userId) return;
  revokedSessionIds.delete(sid);
  const expire = expireDate instanceof Date ? expireDate : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const result = await query(
    `SELECT sess FROM sessions WHERE sid = $1`,
    [sid]
  );
  const existingSess = result.rows[0]?.sess || {};
  const mergedSess = {
    ...existingSess,
    ...sessData,
  };

  await query(
    `INSERT INTO sessions (sid, sess, expire)
     VALUES ($1, $2::json, $3)
     ON CONFLICT (sid) DO UPDATE SET
       sess = EXCLUDED.sess,
       expire = EXCLUDED.expire`,
    [sid, JSON.stringify(mergedSess), expire]
  );
}

/**
 * List active sessions for a user with strict pagination bounds (Rule #9).
 *
 * @param {string} userId
 * @param {{ limit?: number, offset?: number, after?: string | null, currentSid?: string | null }} [options]
 */
export async function findByUserId(userId, { limit = 20, offset = 0, after = null, currentSid = null } = {}) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), MAX_PAGE_LIMIT);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const countRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM sessions
     WHERE sess->>'userId' = $1 AND expire > NOW()`,
    [userId]
  );
  const total = countRes.rows[0]?.total ?? 0;

  let result;
  if (after) {
    result = await query(
      `SELECT sid, sess, expire
       FROM sessions
       WHERE sess->>'userId' = $1
         AND expire > NOW()
         AND (
           expire < COALESCE((SELECT expire FROM sessions WHERE sid = $2), NOW() + INTERVAL '100 years')
           OR (
             expire = (SELECT expire FROM sessions WHERE sid = $2)
             AND sid > $2
           )
         )
       ORDER BY expire DESC, sid ASC
       LIMIT $3`,
      [userId, after, safeLimit]
    );
  } else {
    result = await query(
      `SELECT sid, sess, expire
       FROM sessions
       WHERE sess->>'userId' = $1 AND expire > NOW()
       ORDER BY expire DESC, sid ASC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, safeOffset]
    );
  }

  const rows = result.rows.map((row) => mapSessionRow(row, currentSid));
  Object.defineProperty(rows, 'total', {
    value: total,
    enumerable: false,
    writable: true,
  });
  return rows;
}

/**
 * Delete a specific session belonging to a user.
 *
 * @param {string} userId
 * @param {string} sid
 * @returns {Promise<boolean>}
 */
export async function deleteBySidForUser(userId, sid) {
  const result = await query(
    `DELETE FROM sessions
     WHERE sid = $1 AND sess->>'userId' = $2
     RETURNING sid`,
    [sid, userId]
  );
  if (result.rowCount > 0) {
    revokedSessionIds.add(sid);
    return true;
  }
  return false;
}

/**
 * Delete all active sessions for a user except the current session.
 *
 * @param {string} userId
 * @param {string} currentSid
 * @returns {Promise<number>} number of sessions deleted
 */
export async function deleteOtherSessionsByUserId(userId, currentSid) {
  const result = await query(
    `DELETE FROM sessions
     WHERE sess->>'userId' = $1 AND ($2::varchar IS NULL OR sid <> $2)
     RETURNING sid`,
    [userId, currentSid || null]
  );
  for (const row of result.rows) {
    revokedSessionIds.add(row.sid);
  }
  return result.rowCount;
}

/**
 * Delete all sessions for a given user id.
 *
 * @param {string} userId
 * @returns {Promise<number>} number of sessions deleted
 */
export async function deleteAllByUserId(userId) {
  const result = await query(
    `DELETE FROM sessions WHERE sess->>'userId' = $1 RETURNING sid`,
    [userId]
  );
  for (const row of result.rows) {
    revokedSessionIds.add(row.sid);
  }
  return result.rowCount;
}
