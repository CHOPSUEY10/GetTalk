import * as authService from '../services/auth.service.js';
import * as mfaService from '../services/mfa.service.js';
import * as passwordResetService from '../services/password-reset.service.js';
import * as sessionsRepo from '../repositories/sessions.repository.js';
import AppError from '../errors/AppError.js';
import { UNAUTHORIZED } from '../errors/error-codes.js';
import { parseOffsetPaginationQuery, buildOffsetPage } from '../utils/pagination.js';
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

async function persistAuthenticatedSession(req, userId) {
  if (!req.session) return;
  const nowIso = new Date().toISOString();
  req.session.userId = userId;
  req.session.userAgent = req.get('user-agent') || null;
  req.session.ipAddress = req.ip || req.socket?.remoteAddress || null;
  req.session.createdAt = req.session.createdAt || nowIso;
  req.session.lastActiveAt = nowIso;
  await saveSession(req.session);

  if (req.sessionID) {
    const expireDate = req.session.cookie?.expires
      ? new Date(req.session.cookie.expires)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await sessionsRepo.upsertSession(
      req.sessionID,
      {
        userId,
        userAgent: req.session.userAgent,
        ipAddress: req.session.ipAddress,
        createdAt: req.session.createdAt,
        lastActiveAt: req.session.lastActiveAt,
      },
      expireDate
    );
  }
}

export async function register(req, res, next) {
  try {
    const { username, email, password, nickname, bio } = req.body;

    const user = await authService.register({ username, email, password, nickname, bio });
    await persistAuthenticatedSession(req, user.id);
    return res.status(201).json({
      user,
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
      await persistAuthenticatedSession(req, user.id);
    }
    return res.json({
      user,
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
    const userId = req.session?.userId;
    const sid = req.sessionID;
    if (userId && sid) {
      await sessionsRepo.deleteBySidForUser(userId, sid).catch(() => {});
    }
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
    if (req.sessionID && sessionsRepo.isSessionRevoked(req.sessionID)) {
      if (req.session) {
        req.session.destroy(() => {});
      }
      return next(new AppError('Unauthorized', 401, UNAUTHORIZED));
    }
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
      user,
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
    await persistAuthenticatedSession(req, user.id);
    return res.json({
      user,
    });
  } catch (err) {
    return next(err);
  }
}

export async function mfaStatus(req, res, next) {
  try {
    const user = await authService.getSession(req.user.id);
    if (!user) return next(new AppError('Unauthorized', 401, UNAUTHORIZED));
    return res.json({
      enabled: user.mfaEnabled,
      remainingRecoveryCodesCount: user.remainingRecoveryCodesCount,
    });
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
    return res.json({
      enabled: true,
      recoveryCodes,
      remainingRecoveryCodesCount: recoveryCodes.length,
      recoveryCodesRemaining: recoveryCodes.length,
    });
  } catch (err) {
    return next(err);
  }
}

export async function mfaDisable(req, res, next) {
  try {
    await mfaService.disable(req.user.id, req.body.password, req.body.code);
    delete req.session.pendingMfaSetup;
    await saveSession(req.session);
    return res.json({ enabled: false, remainingRecoveryCodesCount: 0, recoveryCodesRemaining: 0 });
  } catch (err) {
    return next(err);
  }
}

export async function regenerateRecoveryCodes(req, res, next) {
  try {
    const password = req.body.password ?? req.body.currentPassword;
    const code = req.body.code ?? req.body.mfaCode;
    const recoveryCodes = await mfaService.regenerateRecoveryCodes(
      req.user.id,
      password,
      code,
      {
        ipAddress: req.ip || req.socket?.remoteAddress || null,
      }
    );
    return res.json({
      recoveryCodes,
      remainingRecoveryCodesCount: recoveryCodes.length,
      recoveryCodesRemaining: recoveryCodes.length,
    });
  } catch (err) {
    return next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword, mfaCode, code } = req.body;
    const result = await authService.changePassword(req.user.id, {
      currentPassword,
      newPassword,
      mfaCode: mfaCode ?? code ?? null,
      currentSid: req.sessionID || null,
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function requestEmailChange(req, res, next) {
  try {
    const newEmail = req.body.newEmail ?? req.body.email;
    const currentPassword = req.body.currentPassword ?? req.body.password;
    const result = await authService.requestEmailChange(req.user.id, {
      newEmail,
      currentPassword,
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function verifyEmailChange(req, res, next) {
  try {
    const newEmail = req.body.newEmail ?? req.body.email ?? null;
    const otp = req.body.otp ?? req.body.code ?? req.body.token;
    const result = await authService.verifyEmailChange(req.user.id, {
      newEmail,
      otp,
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function listSessions(req, res, next) {
  try {
    if (req.sessionID && req.session?.userId) {
      const expireDate = req.session.cookie?.expires
        ? new Date(req.session.cookie.expires)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await sessionsRepo.upsertSession(
        req.sessionID,
        {
          userId: req.user.id,
          userAgent: req.session.userAgent || req.get('user-agent') || null,
          ipAddress: req.session.ipAddress || req.ip || req.socket?.remoteAddress || null,
          createdAt: req.session.createdAt || new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
        },
        expireDate
      );
    }

    const { limit, offset, cursor } = parseOffsetPaginationQuery(req.query, {
      defaultLimit: 20,
      cursorParam: 'after',
    });

    const rows = await authService.listSessions(req.user.id, req.sessionID, {
      limit,
      offset,
      after: cursor,
    });
    const total = rows.total ?? rows.length;
    const nextCursor =
      offset + rows.length < total && rows.length > 0 ? rows[rows.length - 1].sid : null;
    const page = buildOffsetPage(rows, { limit, offset, total, nextCursor });

    return res.json({
      ...page,
      sessions: rows,
    });
  } catch (err) {
    return next(err);
  }
}

export async function revokeSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    const result = await authService.revokeSession(req.user.id, sessionId, req.sessionID, {
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function revokeAllOtherSessions(req, res, next) {
  try {
    const result = await authService.revokeAllOtherSessions(req.user.id, req.sessionID, {
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/auth/password/forgot
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
