import bcrypt from 'bcrypt';
import * as usersRepo from '../repositories/users.repository.js';
import AppError from '../errors/AppError.js';
import {
  INVALID_CREDENTIALS,
  LOGIN_LOCKED,
  USER_ALREADY_EXISTS,
  VALIDATION_ERROR,
} from '../errors/error-codes.js';

const SALT_ROUNDS = 12;

function loginLockedError(retryAfterSeconds) {
  const error = new AppError(
    `Too many failed login attempts. Please try again in ${retryAfterSeconds} seconds.`,
    429,
    LOGIN_LOCKED
  );
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

export async function register({ username, email, password }) {
  // Check existing user
  const existingEmail = await usersRepo.findByEmail(email);
  if (existingEmail) {
    throw new AppError('Email is already registered', 409, USER_ALREADY_EXISTS);
  }

  const existingUsername = await usersRepo.findByUsername(username);
  if (existingUsername) {
    throw new AppError('Username is already taken', 409, USER_ALREADY_EXISTS);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await usersRepo.create({ username, email, passwordHash });

  return { id: user.id, username: user.username };
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
  return { id: user.id, username: user.username };
}

export async function getSession(userId) {
  const user = await usersRepo.findById(userId);
  if (!user) return null;
  return { id: user.id, username: user.username };
}
