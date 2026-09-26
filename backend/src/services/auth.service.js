import bcrypt from 'bcrypt';
import * as usersRepo from '../repositories/users.repository.js';
import AppError from '../errors/AppError.js';
import {
  INVALID_CREDENTIALS,
  USER_ALREADY_EXISTS,
  VALIDATION_ERROR,
} from '../errors/error-codes.js';

const SALT_ROUNDS = 12;

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

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AppError('Invalid email or password', 401, INVALID_CREDENTIALS);
  }

  return { id: user.id, username: user.username };
}

export async function getSession(userId) {
  const user = await usersRepo.findById(userId);
  if (!user) return null;
  return { id: user.id, username: user.username };
}
