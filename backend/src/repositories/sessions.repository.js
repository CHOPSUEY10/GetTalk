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

/**
 * List active sessions for a user with strict pagination bounds (Rule #9).
 *
 * @param {string} userId
 * @param {{ limit?: number, offset?: number }} [options]
 */
export async function findByUserId(userId, { limit = 20, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), MAX_PAGE_LIMIT);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const countRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM sessions
     WHERE sess->>'userId' = $1 AND expire > NOW()`,
    [userId]
  );
  const total = countRes.rows[0]?.total ?? 0;

  const result = await query(
    `SELECT sid, expire
     FROM sessions
     WHERE sess->>'userId' = $1 AND expire > NOW()
     ORDER BY expire DESC, sid ASC
     LIMIT $2 OFFSET $3`,
    [userId, safeLimit, safeOffset]
  );

  const rows = result.rows;
  Object.defineProperty(rows, 'total', {
    value: total,
    enumerable: false,
    writable: true,
  });
  return rows;
}

/**
 * Delete all sessions for a given user id.
 *
 * connect-pg-simple stores the session payload as JSON in the `sess`
 * column. The `userId` field lives at `sess->>'userId'`.
 *
 * @param {string} userId
 * @returns {Promise<number>} number of sessions deleted
 */
export async function deleteAllByUserId(userId) {
  const result = await query(
    `DELETE FROM sessions WHERE sess->>'userId' = $1`,
    [userId]
  );
  return result.rowCount;
}
