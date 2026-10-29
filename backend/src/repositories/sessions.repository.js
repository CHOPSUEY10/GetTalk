/**
 * Sessions Repository — database access for sessions table.
 *
 * The `sessions` table is managed by connect-pg-simple (express-session).
 * Schema: sid (PK), sess (JSON containing { userId, ... }), expire.
 *
 * We query the `sess` JSONB column to find sessions belonging to a user.
 */

import { query } from '../config/database.js';

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
