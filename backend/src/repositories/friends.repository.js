import { query } from '../config/database.js';

export async function findAllByUserId(userId) {
  const result = await query(
    `SELECT u.id AS "userId", u.username
     FROM friendships f
     JOIN users u ON (
       CASE WHEN f.from_user_id = $1 THEN f.to_user_id
            ELSE f.from_user_id END
     ) = u.id
     WHERE (f.from_user_id = $1 OR f.to_user_id = $1)
       AND f.status = 'accepted'
     ORDER BY u.username`,
    [userId]
  );
  return result.rows;
}

export async function findPendingRequests(userId) {
  const result = await query(
    `SELECT f.id, f.created_at AS "createdAt",
            u.id AS "fromUserId", u.username AS "fromUsername"
     FROM friendships f
     JOIN users u ON f.from_user_id = u.id
     WHERE f.to_user_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return result.rows.map(r => ({
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
