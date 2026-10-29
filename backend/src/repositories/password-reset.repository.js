import { query } from '../config/database.js';

/**
 * Password Reset Repository
 * Database access for password_reset_tokens table.
 */

/**
 * Create a new password reset token. Invalidate any existing unused tokens for this user first.
 * @param {{ userId: string, tokenHash: string, expiresAt: Date }} param0
 */
export async function create({ userId, tokenHash, expiresAt }) {
  // Invalidate any older unused tokens for this user
  await query(
    `UPDATE password_reset_tokens
     SET used = true
     WHERE user_id = $1 AND used = false`,
    [userId]
  );

  const result = await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, used)
     VALUES ($1, $2, $3, false)
     RETURNING id, user_id, token_hash, expires_at, used, created_at`,
    [userId, tokenHash, expiresAt]
  );
  return result.rows[0];
}

/**
 * Find all active, unexpired tokens for a user.
 * @param {string} userId
 */
export async function findActiveByUserId(userId) {
  const result = await query(
    `SELECT id, user_id, token_hash, expires_at, used, created_at
     FROM password_reset_tokens
     WHERE user_id = $1 AND used = false AND expires_at > now()
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

/**
 * Find a token record by its SHA-256 hash.
 * @param {string} tokenHash
 */
export async function findByTokenHash(tokenHash) {
  const result = await query(
    `SELECT id, user_id, token_hash, expires_at, used, created_at
     FROM password_reset_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

/**
 * Atomically mark a token as used (single-use enforcement).
 * Returns the updated row if successful, null if already used.
 * @param {string} id
 */
export async function markAsUsed(id) {
  const result = await query(
    `UPDATE password_reset_tokens
     SET used = true
     WHERE id = $1 AND used = false
     RETURNING id, user_id, token_hash, expires_at, used`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Invalidate all tokens for a user.
 * @param {string} userId
 */
export async function invalidateAllForUser(userId) {
  const result = await query(
    `UPDATE password_reset_tokens
     SET used = true
     WHERE user_id = $1`,
    [userId]
  );
  return result.rowCount || 0;
}
