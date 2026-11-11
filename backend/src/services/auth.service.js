import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import * as usersRepo from '../repositories/users.repository.js';
import * as sessionsRepo from '../repositories/sessions.repository.js';
import * as securityEventsRepo from '../repositories/security-events.repository.js';
import * as mfaService from './mfa.service.js';
import * as mailerService from './mailer.service.js';
import AppError from '../errors/AppError.js';
import {
  INVALID_CREDENTIALS,
  INVALID_OTP_TOKEN,
  LOGIN_LOCKED,
  OTP_TOKEN_EXPIRED,
  SESSION_NOT_FOUND,
  UNAUTHORIZED,
  USER_ALREADY_EXISTS,
  USER_NOT_FOUND,
  VALIDATION_ERROR,
} from '../errors/error-codes.js';

const SALT_ROUNDS = 12;
const EMAIL_OTP_TTL_MS = 15 * 60 * 1000;

function formatAuthUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    nickname: user.nickname || null,
    bio: user.bio || null,
    mfaEnabled: Boolean(user.mfa_enabled),
    remainingRecoveryCodesCount: Array.isArray(user.mfa_recovery_codes)
      ? user.mfa_recovery_codes.length
      : 0,
  };
}

function hashEmailOtp(email, otp) {
  return crypto
    .createHash('sha256')
    .update(`email-change:${String(email).trim().toLowerCase()}:${String(otp).trim()}`)
    .digest('hex');
}

function loginLockedError(retryAfterSeconds) {
  const error = new AppError(
    `Too many failed login attempts. Please try again in ${retryAfterSeconds} seconds.`,
    429,
    LOGIN_LOCKED
  );
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

export async function register({ username, email, password, nickname = null, bio = null }) {
  const existingEmail = await usersRepo.findByEmail(email);
  if (existingEmail) {
    throw new AppError('Email is already registered', 409, USER_ALREADY_EXISTS);
  }

  const existingUsername = await usersRepo.findByUsername(username);
  if (existingUsername) {
    throw new AppError('Username is already taken', 409, USER_ALREADY_EXISTS);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await usersRepo.create({ username, email, passwordHash, nickname, bio });

  return formatAuthUser(user);
}

export async function login({ email, password }) {
  if (!email || !password) {
    throw new AppError('Email and password are required', 400, VALIDATION_ERROR);
  }

  const user = await usersRepo.findByEmail(email);
  if (!user) {
    throw new AppError('Invalid email or password', 401, INVALID_CREDENTIALS);
  }

  if (user.login_lock_remaining_seconds > 0) {
    throw loginLockedError(user.login_lock_remaining_seconds);
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const attempt = await usersRepo.recordFailedLogin(user.id);
    if (attempt.retry_after_seconds > 0) {
      throw loginLockedError(attempt.retry_after_seconds);
    }
    throw new AppError('Invalid email or password', 401, INVALID_CREDENTIALS);
  }

  await usersRepo.resetFailedLogins(user.id);
  return formatAuthUser(user);
}

export async function getSession(userId) {
  const user = await usersRepo.findById(userId);
  if (!user) return null;
  return formatAuthUser(user);
}

/**
 * Change password for an authenticated user and revoke all other active sessions.
 */
export async function changePassword(
  userId,
  { currentPassword, newPassword, mfaCode = null, currentSid = null, ipAddress = null }
) {
  if (!userId) {
    throw new AppError('Authentication required', 401, UNAUTHORIZED);
  }

  const user = await usersRepo.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404, USER_NOT_FOUND);
  }

  const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
  if (!validPassword) {
    throw new AppError('Current password is incorrect', 401, INVALID_CREDENTIALS);
  }

  if (user.mfa_enabled) {
    if (!mfaCode) {
      throw new AppError('Authenticator or recovery code is required', 401, INVALID_CREDENTIALS);
    }
    const validMfa = await mfaService.verifyChallenge(userId, mfaCode);
    if (!validMfa) {
      throw new AppError('Invalid authenticator or recovery code', 401, INVALID_CREDENTIALS);
    }
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await usersRepo.updatePasswordHash(userId, passwordHash);

  const revokedSessionsCount = await sessionsRepo.deleteOtherSessionsByUserId(userId, currentSid);

  await securityEventsRepo.create({
    userId,
    eventType: 'PASSWORD_CHANGED',
    ipAddress,
    metadata: { revokedSessionsCount },
  });

  return {
    message: 'Password updated successfully',
    revokedSessionsCount,
  };
}

/**
 * Request an email change by verifying the current password and sending a 6-digit OTP to the new email.
 */
export async function requestEmailChange(userId, { newEmail, currentPassword, ipAddress = null }) {
  if (!userId) {
    throw new AppError('Authentication required', 401, UNAUTHORIZED);
  }

  const user = await usersRepo.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404, USER_NOT_FOUND);
  }

  const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
  if (!validPassword) {
    throw new AppError('Current password is incorrect', 401, INVALID_CREDENTIALS);
  }

  const normalizedEmail = String(newEmail).trim().toLowerCase();
  if (normalizedEmail === String(user.email).trim().toLowerCase()) {
    throw new AppError('New email must be different from current email', 400, VALIDATION_ERROR);
  }

  const existingEmailUser = await usersRepo.findByEmail(normalizedEmail);
  if (existingEmailUser && existingEmailUser.id !== userId) {
    throw new AppError('Email is already registered', 409, USER_ALREADY_EXISTS);
  }

  const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const tokenHash = hashEmailOtp(normalizedEmail, otp);
  const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_MS);

  await usersRepo.setPendingEmailChange(userId, {
    pendingEmail: normalizedEmail,
    tokenHash,
    expiresAt,
  });

  await mailerService.sendEmailChangeOtp({
    email: normalizedEmail,
    token: otp,
  });

  await securityEventsRepo.create({
    userId,
    eventType: 'EMAIL_CHANGE_REQUESTED',
    ipAddress,
    metadata: {},
  });

  return {
    pendingEmail: normalizedEmail,
    expiresInSeconds: Math.floor(EMAIL_OTP_TTL_MS / 1000),
    message: 'Verification OTP sent to new email address',
  };
}

/**
 * Verify the 6-digit OTP sent to the new email address and commit the email change.
 */
export async function verifyEmailChange(userId, { newEmail = null, otp, ipAddress = null }) {
  if (!userId) {
    throw new AppError('Authentication required', 401, UNAUTHORIZED);
  }

  const user = await usersRepo.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404, USER_NOT_FOUND);
  }

  if (!user.pending_email || !user.email_change_token_hash || !user.email_change_expires_at) {
    throw new AppError('No pending email change request found', 400, INVALID_OTP_TOKEN);
  }

  const targetEmail = String(user.pending_email).trim().toLowerCase();
  if (newEmail && String(newEmail).trim().toLowerCase() !== targetEmail) {
    throw new AppError('Verification email does not match pending email change', 400, INVALID_OTP_TOKEN);
  }

  if (new Date(user.email_change_expires_at) <= new Date()) {
    throw new AppError('Verification OTP has expired', 400, OTP_TOKEN_EXPIRED);
  }

  const candidateHash = hashEmailOtp(targetEmail, otp);
  const expectedBuf = Buffer.from(user.email_change_token_hash, 'hex');
  const candidateBuf = Buffer.from(candidateHash, 'hex');

  if (expectedBuf.length !== candidateBuf.length || !crypto.timingSafeEqual(expectedBuf, candidateBuf)) {
    throw new AppError('Invalid verification code', 400, INVALID_OTP_TOKEN);
  }

  const existingEmailUser = await usersRepo.findByEmail(targetEmail);
  if (existingEmailUser && existingEmailUser.id !== userId) {
    throw new AppError('Email is already registered', 409, USER_ALREADY_EXISTS);
  }

  const updatedUser = await usersRepo.confirmEmailChange(userId, targetEmail);

  await securityEventsRepo.create({
    userId,
    eventType: 'EMAIL_CHANGED',
    ipAddress,
    metadata: {},
  });

  return {
    user: formatAuthUser(updatedUser),
    message: 'Email updated successfully',
  };
}

/**
 * List active sessions for a user with pagination.
 */
export async function listSessions(userId, currentSid, { limit = 20, offset = 0, after = null } = {}) {
  return sessionsRepo.findByUserId(userId, { limit, offset, after, currentSid });
}

/**
 * Revoke a single active session belonging to the user.
 */
export async function revokeSession(userId, sessionId, currentSid, { ipAddress = null } = {}) {
  if (!sessionId) {
    throw new AppError('sessionId is required', 400, VALIDATION_ERROR);
  }

  if (currentSid && sessionId === currentSid) {
    throw new AppError('Cannot revoke the current active session here; use logout instead', 400, VALIDATION_ERROR);
  }

  const deleted = await sessionsRepo.deleteBySidForUser(userId, sessionId);
  if (!deleted) {
    throw new AppError('Session not found', 404, SESSION_NOT_FOUND);
  }

  await securityEventsRepo.create({
    userId,
    eventType: 'SESSION_REVOKED',
    ipAddress,
    metadata: { sessionId },
  });

  return {
    revoked: true,
    sessionId,
  };
}

/**
 * Terminate all other active sessions for the user except the current session.
 */
export async function revokeAllOtherSessions(userId, currentSid, { ipAddress = null } = {}) {
  const revokedCount = await sessionsRepo.deleteOtherSessionsByUserId(userId, currentSid);

  await securityEventsRepo.create({
    userId,
    eventType: 'OTHER_SESSIONS_REVOKED',
    ipAddress,
    metadata: { revokedCount },
  });

  return {
    revokedCount,
  };
}
