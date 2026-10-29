/**
 * Password Reset Service
 *
 * Implements the forgot/reset password flow per Issue #21 with 6-digit OTP:
 *  - Cryptographically strong 6-digit OTP generated via crypto.randomBytes
 *  - SHA-256 hashed token storage (never store raw OTP)
 *  - crypto.timingSafeEqual for comparison (anti timing-attack)
 *  - Atomic single-use token consumption with 15-minute TTL
 *  - Session revocation + login lockout reset after successful password change
 *  - Anti user-enumeration (generic response regardless of email existence)
 *  - Security event audit logging
 */

import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import * as usersRepo from '../repositories/users.repository.js';
import * as resetRepo from '../repositories/password-reset.repository.js';
import * as sessionsRepo from '../repositories/sessions.repository.js';
import * as securityEventsRepo from '../repositories/security-events.repository.js';
import { sendPasswordResetEmail } from './mailer.service.js';
import AppError from '../errors/AppError.js';
import {
  INVALID_RESET_TOKEN,
  VALIDATION_ERROR,
} from '../errors/error-codes.js';
import logger from '../utils/logger.js';

const SALT_ROUNDS = 12;
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const OTP_MODULUS = 1_000_000;
const MAX_UNBIASED_UINT32 = Math.floor(0x1_0000_0000 / OTP_MODULUS) * OTP_MODULUS; // 4,294,000,000

/**
 * Generate an unbiased, cryptographically secure 6-digit numeric OTP
 * using crypto.randomBytes(4) with rejection sampling.
 *
 * @returns {string} 6-digit OTP (e.g. "048291")
 */
export function generateOtpToken() {
  while (true) {
    const randomUint32 = crypto.randomBytes(4).readUInt32BE(0);
    if (randomUint32 < MAX_UNBIASED_UINT32) {
      return String(randomUint32 % OTP_MODULUS).padStart(6, '0');
    }
  }
}

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
 * Request a password reset OTP.
 *
 * **Anti user-enumeration**: this function never throws when the email is not
 * found. It always returns cleanly so callers respond identically regardless
 * of whether the email exists.
 *
 * @param {string} email
 * @param {{ ipAddress?: string | null }} [options]
 * @returns {Promise<{ sent: boolean }>}
 */
export async function requestReset(email, { ipAddress = null } = {}) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await usersRepo.findByEmail(normalizedEmail);

  if (!user) {
    // Perform a dummy hash so execution time remains similar when email is not found
    hashToken(generateOtpToken());
    return { sent: false };
  }

  // Generate a cryptographically secure 6-digit OTP token
  const rawToken = generateOtpToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Invalidate any previous unused tokens for this user
  await resetRepo.invalidateAllForUser(user.id);

  // Store only the SHA-256 hash
  await resetRepo.create({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  // Dispatch the 6-digit OTP via mailer service
  await sendPasswordResetEmail({
    email: user.email,
    token: rawToken,
  });

  // Audit log (never stores raw token or hash)
  await securityEventsRepo.create({
    userId: user.id,
    eventType: 'PASSWORD_RESET_REQUESTED',
    ipAddress,
  });

  logger.info('Password reset token created', { userId: user.id });

  return { sent: true };
}

/**
 * Reset the password using a valid 6-digit OTP token.
 *
 * Steps:
 *  1. Validate new password strength (>= 8 chars)
 *  2. Look up user by email (case-insensitive)
 *  3. Fetch active (unused, unexpired) tokens for the user
 *  4. Constant-time compare SHA-256 hashes via crypto.timingSafeEqual
 *  5. Atomically mark the matched token as used (prevents race/replay)
 *  6. Hash the new password with bcrypt
 *  7. Update password hash and clear login lockout state in DB
 *  8. Invalidate all remaining reset tokens for the user
 *  9. Revoke all active sessions in PostgreSQL session store
 *
 * @param {{ token: string, email: string, newPassword: string, ipAddress?: string | null }} params
 */
export async function resetPassword({ token, email, newPassword, ipAddress = null }) {
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters long', 400, VALIDATION_ERROR);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const submittedHash = hashToken(token.trim());

  // Look up the user to bind the OTP token to the specific account
  const user = await usersRepo.findByEmail(normalizedEmail);
  if (!user) {
    // Constant-time dummy comparison + generic error to prevent enumeration
    safeCompare(submittedHash, submittedHash);
    throw new AppError('Invalid or expired reset token', 400, INVALID_RESET_TOKEN);
  }

  // Fetch active (unused, unexpired) tokens belonging to this user
  const activeTokens = await resetRepo.findActiveByUserId(user.id);
  if (!activeTokens || activeTokens.length === 0) {
    safeCompare(submittedHash, submittedHash);
    throw new AppError('Invalid or expired reset token', 400, INVALID_RESET_TOKEN);
  }

  // Constant-time comparison against the user's active token(s)
  let matchedRecord = null;
  for (const record of activeTokens) {
    if (safeCompare(submittedHash, record.token_hash)) {
      matchedRecord = record;
    }
  }

  if (!matchedRecord) {
    throw new AppError('Invalid or expired reset token', 400, INVALID_RESET_TOKEN);
  }

  // Atomically consume the token (single-use enforcement, prevents race conditions)
  const consumed = await resetRepo.markUsed(matchedRecord.id);
  if (!consumed) {
    throw new AppError('Invalid or expired reset token', 400, INVALID_RESET_TOKEN);
  }

  // 1. Hash new password with bcrypt
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // 2. Update password and reset any failed login lockout
  await usersRepo.updatePasswordHash(user.id, passwordHash);

  // 3. Invalidate all other reset tokens for this user
  await resetRepo.invalidateAllForUser(user.id);

  // 4. Revoke all active sessions — force logout across all devices
  const revokedCount = await sessionsRepo.deleteAllByUserId(user.id);

  // 5. Record security event
  await securityEventsRepo.create({
    userId: user.id,
    eventType: 'PASSWORD_RESET_COMPLETED',
    ipAddress,
    metadata: { sessionsRevoked: revokedCount },
  });

  logger.info('Password reset completed', {
    userId: user.id,
    sessionsRevoked: revokedCount,
  });
}
