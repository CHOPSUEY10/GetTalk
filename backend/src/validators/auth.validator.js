/**
 * Auth Validator
 *
 * Validation functions for authentication endpoints.
 * Separated from controllers per rule.md §30.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,50}$/;

export function validateRegister(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const { username, email, password } = body;

  if (!username || typeof username !== 'string' || !USERNAME_REGEX.test(username.trim())) {
    errors.push('Username must be 3-50 characters long and contain only letters, numbers, underscores, or hyphens');
  }

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    errors.push('A valid email address is required');
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateLogin(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const { email, password } = body;

  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    errors.push('Email is required');
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    errors.push('Password is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateMfaVerify(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const { challengeId, code } = body;

  if (!challengeId || typeof challengeId !== 'string') {
    errors.push('challengeId is required');
  }

  if (!code || typeof code !== 'string') {
    errors.push('code is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
