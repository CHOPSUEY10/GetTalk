import * as authService from '../services/auth.service.js';
import AppError from '../errors/AppError.js';
import { UNAUTHORIZED } from '../errors/error-codes.js';

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
      req.session.userId = user.id;
      await saveSession(req.session);
    }
    return res.json({
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (err) {
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
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function mfaVerify(req, res, next) {
  try {
    // Stub for MFA challenge verification
    return res.status(400).json({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'MFA verification is not configured for this account',
      },
    });
  } catch (err) {
    return next(err);
  }
}
