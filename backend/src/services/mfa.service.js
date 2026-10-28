import bcrypt from 'bcrypt';
import * as usersRepo from '../repositories/users.repository.js';
import AppError from '../errors/AppError.js';
import {
  INVALID_CREDENTIALS,
  MFA_ALREADY_ENABLED,
  MFA_NOT_ENABLED,
  VALIDATION_ERROR,
} from '../errors/error-codes.js';
import {
  createTotpUri,
  decryptMfaSecret,
  encryptMfaSecret,
  findTotpStep,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
} from '../utils/mfa.js';

function requirePassword(user, password) {
  return bcrypt.compare(password, user.password_hash);
}

export async function beginSetup(userId, password) {
  const user = await usersRepo.findById(userId);
  if (!user || !(await requirePassword(user, password))) {
    throw new AppError('Password is incorrect', 401, INVALID_CREDENTIALS);
  }
  if (user.mfa_enabled) {
    throw new AppError('MFA is already enabled', 409, MFA_ALREADY_ENABLED);
  }

  const secret = generateTotpSecret();
  return {
    encryptedSecret: encryptMfaSecret(secret),
    secret,
    otpauthUri: createTotpUri(secret, user.email),
  };
}

export async function enable(userId, encryptedPendingSecret, code) {
  if (!encryptedPendingSecret) {
    throw new AppError('MFA setup has expired; start setup again', 400, VALIDATION_ERROR);
  }
  const secret = decryptMfaSecret(encryptedPendingSecret);
  const totpStep = findTotpStep(secret, code);
  if (totpStep === null) {
    throw new AppError('Invalid authenticator code', 400, INVALID_CREDENTIALS);
  }

  const recoveryCodes = generateRecoveryCodes();
  const enabled = await usersRepo.enableMfa(
    userId,
    encryptMfaSecret(secret),
    recoveryCodes.map(hashRecoveryCode),
    totpStep
  );
  if (!enabled) {
    throw new AppError('MFA is already enabled', 409, MFA_ALREADY_ENABLED);
  }
  return recoveryCodes;
}

export async function verifyChallenge(userId, code) {
  const user = await usersRepo.findById(userId);
  if (!user?.mfa_enabled || !user.mfa_secret) return false;

  const totpStep = findTotpStep(decryptMfaSecret(user.mfa_secret), code);
  if (totpStep !== null) return usersRepo.consumeMfaTotpStep(userId, totpStep);

  const recoveryHash = hashRecoveryCode(code);
  return usersRepo.consumeMfaRecoveryCode(userId, recoveryHash);
}

export async function disable(userId, password, code) {
  const user = await usersRepo.findById(userId);
  if (!user || !(await requirePassword(user, password))) {
    throw new AppError('Password is incorrect', 401, INVALID_CREDENTIALS);
  }
  if (!user.mfa_enabled || !user.mfa_secret) {
    throw new AppError('MFA is not enabled', 409, MFA_NOT_ENABLED);
  }

  const totpStep = findTotpStep(decryptMfaSecret(user.mfa_secret), code);
  const validTotp = totpStep !== null
    && await usersRepo.disableMfaWithTotpStep(userId, totpStep);
  const validRecovery = !validTotp
    && await usersRepo.disableMfaWithRecoveryCode(userId, hashRecoveryCode(code));
  if (!validTotp && !validRecovery) {
    throw new AppError('Invalid authenticator or recovery code', 401, INVALID_CREDENTIALS);
  }
}
