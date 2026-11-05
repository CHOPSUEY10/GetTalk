import { query } from '../config/database.js';
import { UUID_REGEX } from '../validators/pagination.validator.js';

/**
 * Accepted friends ordered alphabetically by (username, id).
 * Supports standardized LIMIT / OFFSET pagination with total row count,
 * as well as `after` cursor for keyset navigation.
 *
 * @param {string} userId
 * @param {{ limit?: number, offset?: number, after?: string | null }} [options]
 */
export async function findAllByUserId(
  userId,
  { limit = 20, offset = 0, after = null } = {}
) {
  const countRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM friendships f
     WHERE (f.from_user_id = $1 OR f.to_user_id = $1)
       AND f.status = 'accepted'`,
    [userId]
  );
  const total = countRes.rows[0]?.total ?? 0;

  const params = [userId];
  let cursorSql = '';

  if (after && UUID_REGEX.test(after)) {
    params.push(after);
    cursorSql = `AND (u.username, u.id) > (
                   SELECT cu.username, cu.id
                   FROM users cu
                   JOIN friendships cf
                     ON cf.status = 'accepted'
                    AND ((cf.from_user_id = $1 AND cf.to_user_id = cu.id)
                      OR (cf.to_user_id = $1 AND cf.from_user_id = cu.id))
                   WHERE cu.id = $${params.length}
                 )`;
  }

  params.push(limit);
  const limitParamIdx = params.length;

  let offsetSql = '';
  if (!after) {
    params.push(offset);
    offsetSql = `OFFSET $${params.length}`;
  }

  const result = await query(
    `SELECT u.id AS "userId", u.username
     FROM friendships f
     JOIN users u ON (
       CASE WHEN f.from_user_id = $1 THEN f.to_user_id
            ELSE f.from_user_id END
     ) = u.id
     WHERE (f.from_user_id = $1 OR f.to_user_id = $1)
       AND f.status = 'accepted'
       ${cursorSql}
     ORDER BY u.username ASC, u.id ASC
     LIMIT $${limitParamIdx}
     ${offsetSql}`,
    params
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
 * Pending incoming friend requests ordered by (created_at DESC, id DESC),
 * supporting cursor-based (`before`) pagination.
 *
 * @param {string} userId
 * @param {{ limit?: number, before?: string | null }} [options]
 *   `limit` is the number of rows to fetch (service passes page size + 1).
 */
export async function findPendingRequests(userId, { limit = 21, before = null } = {}) {
  const params = [userId];
  let cursorSql = '';

  if (before) {
    params.push(before);
    if (UUID_REGEX.test(before)) {
      cursorSql = `AND (f.created_at, f.id) < (
                     SELECT cf.created_at, cf.id
                     FROM friendships cf
                     WHERE cf.id = $${params.length}
                       AND cf.to_user_id = $1
                       AND cf.status = 'pending'
                   )`;
    } else {
      cursorSql = `AND f.created_at < $${params.length}::timestamptz`;
    }
  }

  params.push(limit);

  const result = await query(
    `SELECT f.id, f.created_at AS "createdAt",
            u.id AS "fromUserId", u.username AS "fromUsername"
     FROM friendships f
     JOIN users u ON f.from_user_id = u.id
     WHERE f.to_user_id = $1 AND f.status = 'pending'
       ${cursorSql}
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map((r) => ({
    id: r.id,
    fromUser: { id: r.fromUserId, username: r.fromUsername },
    createdAt: r.createdAt,
  }));
}

export async function findRequestById(requestId) {
  const result = await query(
    `SELECT id, from_user_id, to_user_id, status, created_at
     FROM friendships WHERE id = $1`,
    [requestId]
  );
  return result.rows[0] || null;
}

export async function findExisting(userA, userB) {
  const result = await query(
    `SELECT id, from_user_id, to_user_id, status
     FROM friendships
     WHERE (from_user_id = $1 AND to_user_id = $2)
        OR (from_user_id = $2 AND to_user_id = $1)`,
    [userA, userB]
  );
  return result.rows[0] || null;
}

export async function createRequest(fromUserId, toUserId) {
  const result = await query(
    `INSERT INTO friendships (from_user_id, to_user_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING id, to_user_id AS "userId", status`,
    [fromUserId, toUserId]
  );
  return result.rows[0];
}

export async function updateStatus(requestId, status) {
  const result = await query(
    `UPDATE friendships SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, from_user_id, to_user_id, status`,
    [status, requestId]
  );
  return result.rows[0] || null;
}

export async function remove(userA, userB) {
  await query(
    `DELETE FROM friendships
     WHERE ((from_user_id = $1 AND to_user_id = $2)
        OR  (from_user_id = $2 AND to_user_id = $1))
       AND status = 'accepted'`,
    [userA, userB]
  );
}
