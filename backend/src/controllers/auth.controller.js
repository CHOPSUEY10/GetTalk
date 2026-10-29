import * as authService from '../services/auth.service.js';
import * as mfaService from '../services/mfa.service.js';
import * as passwordResetService from '../services/password-reset.service.js';
import AppError from '../errors/AppError.js';
import { UNAUTHORIZED } from '../errors/error-codes.js';
import { randomUUID } from 'node:crypto';

/**
 * Persist the session before replying. Without this, a client that opens the
 * Socket.IO connection immediately after login can race the session store and
 * get "Authentication required".
 * @param {import('express-session').Session & { userId?: string }} session
 */
function saveSession(session) {
  return new Promise((resolve, reject) => {
    session.save((err) => (err ? reject(err) : resolve()));
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export async function register(req, res, next) {
  try {
    const { username, email, password } = req.body;

    const user = await authService.register({ username, email, password });
    if (req.session) {
      req.session.userId = user.id;
      await saveSession(req.session);
    }
    return res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        mfaEnabled: user.mfaEnabled,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await authService.login({ email, password });
    if (req.session) {
      await regenerateSession(req);
      if (user.mfaEnabled) {
        const challengeId = randomUUID();
        req.session.mfaChallenge = {
          challengeId,
          userId: user.id,
          expiresAt: Date.now() + 5 * 60 * 1000,
          attempts: 0,
        };
        await saveSession(req.session);
        return res.json({ mfaRequired: true, challengeId });
      }
      req.session.userId = user.id;
      await saveSession(req.session);
    }
    return res.json({
      user: {
        id: user.id,
        username: user.username,
        mfaEnabled: user.mfaEnabled,
      },
    });
  } catch (err) {
    if (err.retryAfterSeconds) {
      res.set('Retry-After', String(err.retryAfterSeconds));
    }
    return next(err);
  }
}

export async function logout(req, res, next) {
  try {
    if (req.session) {
      req.session.destroy(() => {
        res.clearCookie('gettalk.sid');
        return res.status(204).send();
      });
    } else {
      res.clearCookie('gettalk.sid');
      return res.status(204).send();
    }
  } catch (err) {
    return next(err);
  }
}

export async function session(req, res, next) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return next(new AppError('Unauthorized', 401, UNAUTHORIZED));
    }
    const user = await authService.getSession(userId);
    if (!user) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return next(new AppError('Unauthorized', 401, UNAUTHORIZED));
    }
    return res.json({
      user: {
        id: user.id,
        username: user.username,
        mfaEnabled: user.mfaEnabled,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function mfaVerify(req, res, next) {
  try {
    const challenge = req.session?.mfaChallenge;
    const { challengeId, code } = req.body;
    if (!challenge || challenge.challengeId !== challengeId) {
      return next(new AppError('MFA challenge is invalid or expired', 401, UNAUTHORIZED));
    }
    if (challenge.expiresAt <= Date.now()) {
      delete req.session.mfaChallenge;
      await saveSession(req.session);
      return next(new AppError('MFA challenge is invalid or expired', 401, UNAUTHORIZED));
    }

    if (challenge.attempts >= 5) {
      delete req.session.mfaChallenge;
      await saveSession(req.session);
      return next(new AppError('MFA challenge has expired', 401, UNAUTHORIZED));
    }

    const verified = await mfaService.verifyChallenge(challenge.userId, code);
    if (!verified) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) delete req.session.mfaChallenge;
      await saveSession(req.session);
      return next(new AppError('Invalid authenticator or recovery code', 401, UNAUTHORIZED));
    }

    const user = await authService.getSession(challenge.userId);
    if (!user) {
      delete req.session.mfaChallenge;
      await saveSession(req.session);
      return next(new AppError('Unauthorized', 401, UNAUTHORIZED));
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req.session);
    return res.json({
      user: {
        id: user.id,
        username: user.username,
        mfaEnabled: user.mfaEnabled,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function mfaStatus(req, res, next) {
  try {
    const user = await authService.getSession(req.user.id);
    if (!user) return next(new AppError('Unauthorized', 401, UNAUTHORIZED));
    return res.json({ enabled: user.mfaEnabled });
  } catch (err) {
    return next(err);
  }
}

export async function mfaSetup(req, res, next) {
  try {
    const setup = await mfaService.beginSetup(req.user.id, req.body.password);
    req.session.pendingMfaSetup = {
      encryptedSecret: setup.encryptedSecret,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    await saveSession(req.session);
    return res.json({ secret: setup.secret, otpauthUri: setup.otpauthUri });
  } catch (err) {
    return next(err);
  }
}

export async function mfaEnable(req, res, next) {
  try {
    const pending = req.session.pendingMfaSetup;
    if (!pending || pending.expiresAt <= Date.now()) {
      delete req.session.pendingMfaSetup;
      await saveSession(req.session);
      return next(new AppError('MFA setup has expired; start setup again', 400, 'VALIDATION_ERROR'));
    }

    const recoveryCodes = await mfaService.enable(
      req.user.id,
      pending.encryptedSecret,
      req.body.code
    );
    delete req.session.pendingMfaSetup;
    await saveSession(req.session);
    return res.json({ enabled: true, recoveryCodes });
  } catch (err) {
    return next(err);
  }
}

export async function mfaDisable(req, res, next) {
  try {
    await mfaService.disable(req.user.id, req.body.password, req.body.code);
    delete req.session.pendingMfaSetup;
    await saveSession(req.session);
    return res.json({ enabled: false });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/auth/password/forgot
 *
 * Always returns the exact same generic response regardless of whether the
 * email exists in the system (anti user-enumeration). Never exposes the
 * raw OTP token in the HTTP response body.
 */
export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    await passwordResetService.requestReset(email.trim(), {
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });

    return res.json({
      message: 'Jika email terdaftar, tautan pengaturan ulang kata sandi telah dikirimkan.',
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/auth/password/reset
 *
 * Validates the 6-digit OTP token, updates the password, and revokes all sessions.
 */
export async function resetPassword(req, res, next) {
  try {
    const { token, email, newPassword, password } = req.body;
    const resolvedPassword = newPassword ?? password;

    await passwordResetService.resetPassword({
      token: token.trim(),
      email: email.trim(),
      newPassword: resolvedPassword,
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });

    return res.json({
      message: 'Kata sandi berhasil diubah. Silakan login kembali.',
    });
  } catch (err) {
    return next(err);
  }
}
