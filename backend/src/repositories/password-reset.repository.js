/**
 * Password Reset Tokens Repository — database access for password_reset_tokens table.
 */

import { query } from '../config/database.js';

/**
 * Create a new password reset token record.
 * Only the SHA-256 hash of the token is stored.
 *
 * @param {{ userId: string, tokenHash: string, expiresAt: Date }} params
 */
export async function create({ userId, tokenHash, expiresAt }) {
  const result = await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [userId, tokenHash, expiresAt]
  );
  return result.rows[0];
}

/**
 * Find all active (unused, not expired) token records for a user.
 *
 * @param {string} userId
 */
export async function findActiveByUserId(userId) {
  const result = await query(
    `SELECT id, user_id, token_hash, used, expires_at, created_at
     FROM password_reset_tokens
     WHERE user_id = $1 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

/**
 * Find a valid (unused, not expired) token record by its SHA-256 hash.
 *
 * @param {string} tokenHash
 */
export async function findValidByHash(tokenHash) {
  const result = await query(
    `SELECT id, user_id, token_hash, used, expires_at, created_at
     FROM password_reset_tokens
     WHERE token_hash = $1 AND used = FALSE AND expires_at > NOW()`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

/**
 * Atomically mark a token as used so it cannot be replayed concurrently.
 * Returns the updated row if it was still unused and unexpired, or null otherwise.
 *
 * @param {string} id
 */
export async function markUsed(id) {
  const result = await query(
    `UPDATE password_reset_tokens
     SET used = TRUE
     WHERE id = $1 AND used = FALSE AND expires_at > NOW()
     RETURNING id, user_id, token_hash, used, expires_at`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Invalidate all unused tokens for a user (called after a successful reset
 * to prevent any other outstanding token from being used).
 *
 * @param {string} userId
 */
export async function invalidateAllForUser(userId) {
  await query(
    `UPDATE password_reset_tokens SET used = TRUE
     WHERE user_id = $1 AND used = FALSE`,
    [userId]
  );
}

/**
 * Delete expired tokens (housekeeping).
 */
export async function deleteExpired() {
  await query(`DELETE FROM password_reset_tokens WHERE expires_at <= NOW()`);
}
