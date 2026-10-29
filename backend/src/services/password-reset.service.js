/**
 * Password Reset Service
 *
 * Implements the forgot/reset password flow per Issue #21:
 *  - Cryptographically strong tokens (crypto.randomBytes)
 *  - SHA-256 hashed token storage (never store raw)
 *  - crypto.timingSafeEqual for comparison (anti timing-attack)
 *  - Single-use tokens with 15-minute TTL
 *  - Session revocation after successful reset
 *  - Anti user-enumeration (generic response regardless of email existence)
 *  - Redis-backed rate limiting on forgot endpoint
 */

import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import * as usersRepo from '../repositories/users.repository.js';
import * as resetRepo from '../repositories/password-reset.repository.js';
import * as sessionsRepo from '../repositories/sessions.repository.js';
import AppError from '../errors/AppError.js';
import {
  INVALID_RESET_TOKEN,
  RESET_TOKEN_EXPIRED,
  VALIDATION_ERROR,
} from '../errors/error-codes.js';
import logger from '../utils/logger.js';

const SALT_ROUNDS = 12;
const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Hash a raw token with SHA-256 (hex digest).
 * @param {string} rawToken
 * @returns {string}
 */
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Constant-time comparison of two hex-encoded SHA-256 hashes.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Request a password reset.
 *
 * **Anti user-enumeration**: this function never throws when the email is not
 * found. It always returns the same generic result so callers (controller)
 * respond identically regardless of whether the email exists.
 *
 * @param {string} email
 * @returns {Promise<{ sent: boolean, rawToken?: string, userId?: string }>}
 *   `rawToken` is only present when the email was found (to be sent by the
 *   email transport; never returned to the client).
 */
export async function requestReset(email) {
  const user = await usersRepo.findByEmail(email);

  if (!user) {
    // Do NOT leak whether the email is registered.
    return { sent: false };
  }

  // Generate a cryptographically secure token
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Invalidate any previous unused tokens for this user
  await resetRepo.invalidateAllForUser(user.id);

  // Store only the hash
  await resetRepo.create({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  logger.info('Password reset token created', { userId: user.id });

  return { sent: true, rawToken, userId: user.id };
}

/**
 * Reset the password using a valid token.
 *
 * Steps:
 *  1. Validate new password strength
 *  2. Hash the submitted token and look up the record
 *  3. Constant-time compare the hashes
 *  4. Verify token is not expired and not used
 *  5. Hash the new password with bcrypt
 *  6. Update the password in the database
 *  7. Invalidate ALL reset tokens for this user
 *  8. Revoke ALL active sessions (force logout everywhere)
 *
 * @param {{ token: string, email: string, newPassword: string }} params
 */
export async function resetPassword({ token, email, newPassword }) {
  if (!newPassword || newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 400, VALIDATION_ERROR);
  }

  // Look up the user to bind token to the correct account
  const user = await usersRepo.findByEmail(email);
  if (!user) {
    // Generic error to prevent enumeration
    throw new AppError('Invalid or expired reset token', 400, INVALID_RESET_TOKEN);
  }

  // Hash the submitted token and look up a valid record
  const submittedHash = hashToken(token);
  const record = await resetRepo.findValidByHash(submittedHash);

  if (!record) {
    throw new AppError('Invalid or expired reset token', 400, INVALID_RESET_TOKEN);
  }

  // Verify the token belongs to this user
  if (record.user_id !== user.id) {
    throw new AppError('Invalid or expired reset token', 400, INVALID_RESET_TOKEN);
  }

  // Constant-time comparison (defense in depth — the DB already matched, but
  // this guards against hypothetical timing side-channels in the DB layer).
  if (!safeCompare(submittedHash, record.token_hash)) {
    throw new AppError('Invalid or expired reset token', 400, INVALID_RESET_TOKEN);
  }

  // Check expiry (belt-and-suspenders; the DB query already filters)
  if (new Date(record.expires_at) <= new Date()) {
    throw new AppError('Reset token has expired', 400, RESET_TOKEN_EXPIRED);
  }

  // ── All checks passed — perform the reset ────────────────────

  // 1. Hash new password with bcrypt
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // 2. Update password
  await usersRepo.updatePasswordHash(user.id, passwordHash);

  // 3. Invalidate ALL reset tokens for this user (single-use + prevent replay)
  await resetRepo.invalidateAllForUser(user.id);

  // 4. Revoke ALL active sessions — force logout everywhere
  const revokedCount = await sessionsRepo.deleteAllByUserId(user.id);

  logger.info('Password reset completed', {
    userId: user.id,
    sessionsRevoked: revokedCount,
  });
}
