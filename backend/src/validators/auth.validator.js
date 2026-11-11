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

  if (
    typeof code !== 'string'
    || (!/^\d{6}$/.test(code) && !/^[a-f\d-]{24,29}$/i.test(code))
  ) {
    errors.push('code must be a six-digit authenticator code or recovery code');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateMfaSetup(body) {
  if (!body || typeof body !== 'object' || typeof body.password !== 'string' || !body.password) {
    return { valid: false, errors: ['Password is required'] };
  }
  return { valid: true };
}

export function validateMfaCode(body) {
  if (
    !body
    || typeof body !== 'object'
    || typeof body.code !== 'string'
    || (!/^\d{6}$/.test(body.code) && !/^[a-f\d-]{24,29}$/i.test(body.code))
  ) {
    return {
      valid: false,
      errors: ['code must be a six-digit authenticator code or recovery code'],
    };
  }
  return { valid: true };
}

export function validateMfaDisable(body) {
  const errors = [];
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }
  if (typeof body.password !== 'string' || !body.password) {
    errors.push('Password is required');
  }
  if (
    typeof body.code !== 'string'
    || (!/^\d{6}$/.test(body.code) && !/^[a-f\d-]{24,29}$/i.test(body.code))
  ) {
    errors.push('code must be a six-digit authenticator code or recovery code');
  }
  return { valid: errors.length === 0, errors };
}

export function validateForgotPassword(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const { email } = body;

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    errors.push('A valid email address is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateResetPassword(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const { token, email, newPassword, password } = body;
  const resolvedPassword = newPassword ?? password;

  if (!token || typeof token !== 'string' || token.trim().length === 0 || token.length > 128) {
    errors.push('Reset token is required');
  }

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    errors.push('A valid email address is required');
  }

  if (!resolvedPassword || typeof resolvedPassword !== 'string' || resolvedPassword.length < 8) {
    errors.push('New password must be at least 8 characters long');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateChangePassword(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const { currentPassword, newPassword, mfaCode, code } = body;
  const resolvedMfaCode = mfaCode ?? code;

  if (!currentPassword || typeof currentPassword !== 'string' || currentPassword.length === 0) {
    errors.push('Current password is required');
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    errors.push('New password must be at least 8 characters long');
  } else if (newPassword.length > 128) {
    errors.push('New password must not exceed 128 characters');
  } else if (currentPassword && newPassword === currentPassword) {
    errors.push('New password must be different from current password');
  }

  if (
    resolvedMfaCode !== undefined &&
    resolvedMfaCode !== null &&
    resolvedMfaCode !== '' &&
    (typeof resolvedMfaCode !== 'string' ||
      (!/^\d{6}$/.test(resolvedMfaCode) && !/^[a-f\d-]{24,29}$/i.test(resolvedMfaCode)))
  ) {
    errors.push('mfaCode must be a six-digit authenticator code or recovery code');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateEmailChangeRequest(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const newEmail = body.newEmail ?? body.email;
  const currentPassword = body.currentPassword ?? body.password;

  if (!newEmail || typeof newEmail !== 'string' || !EMAIL_REGEX.test(newEmail.trim())) {
    errors.push('A valid new email address is required');
  }

  if (!currentPassword || typeof currentPassword !== 'string' || currentPassword.length === 0) {
    errors.push('Current password is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateEmailChangeVerify(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const otp = body.otp ?? body.code ?? body.token;
  const newEmail = body.newEmail ?? body.email;

  if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
    errors.push('A valid 6-digit verification OTP code is required');
  }

  if (newEmail !== undefined && newEmail !== null && newEmail !== '') {
    if (typeof newEmail !== 'string' || !EMAIL_REGEX.test(newEmail.trim())) {
      errors.push('A valid email address is required');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateRegenerateRecoveryCodes(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const password = body.password ?? body.currentPassword;
  const code = body.code ?? body.mfaCode;

  if (!password || typeof password !== 'string' || password.length === 0) {
    errors.push('Password is required');
  }

  if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    errors.push('A valid 6-digit TOTP authenticator code is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
