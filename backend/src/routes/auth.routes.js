import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validation.middleware.js';
import { rateLimiter } from '../middleware/rate-limit.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { createPaginationValidator } from '../validators/pagination.validator.js';
import {
  validateRegister,
  validateLogin,
  validateMfaVerify,
  validateMfaCode,
  validateMfaSetup,
  validateMfaDisable,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword,
  validateEmailChangeRequest,
  validateEmailChangeVerify,
  validateRegenerateRecoveryCodes,
} from '../validators/auth.validator.js';

const router = Router();

router.post('/register', rateLimiter({ name: 'auth:register', limit: 10, windowSeconds: 60 }), validate(validateRegister), authController.register);
router.post('/login', rateLimiter({ name: 'auth:login', limit: 10, windowSeconds: 60 }), validate(validateLogin), authController.login);
router.post('/logout', authController.logout);
router.get('/session', authController.session);
router.post('/mfa/verify', rateLimiter({ name: 'auth:mfa', limit: 10, windowSeconds: 60 }), validate(validateMfaVerify), authController.mfaVerify);
router.get('/mfa/status', authenticate, authController.mfaStatus);
router.post(
  '/mfa/setup',
  authenticate,
  rateLimiter({ name: 'auth:mfa:setup', limit: 5, windowSeconds: 60 }),
  validate(validateMfaSetup),
  authController.mfaSetup
);
router.post(
  '/mfa/enable',
  authenticate,
  rateLimiter({ name: 'auth:mfa:enable', limit: 10, windowSeconds: 60 }),
  validate(validateMfaCode),
  authController.mfaEnable
);
router.delete(
  '/mfa',
  authenticate,
  rateLimiter({ name: 'auth:mfa:disable', limit: 5, windowSeconds: 60 }),
  validate(validateMfaDisable),
  authController.mfaDisable
);
router.post(
  '/mfa/disable',
  authenticate,
  rateLimiter({ name: 'auth:mfa:disable', limit: 5, windowSeconds: 60 }),
  validate(validateMfaDisable),
  authController.mfaDisable
);
router.post(
  '/mfa/recovery-codes/regenerate',
  authenticate,
  rateLimiter({ name: 'auth:mfa:regenerate', limit: 5, windowSeconds: 60 }),
  validate(validateRegenerateRecoveryCodes),
  authController.regenerateRecoveryCodes
);

// ── Password Management ────────────────────────────────────────
router.post(
  '/password',
  authenticate,
  rateLimiter({ name: 'auth:password:change', limit: 10, windowSeconds: 60 }),
  validate(validateChangePassword),
  authController.changePassword
);
router.post(
  '/password/forgot',
  rateLimiter({ name: 'auth:password:forgot', limit: 3, windowSeconds: 900 }),
  validate(validateForgotPassword),
  authController.forgotPassword
);
router.post(
  '/password/reset',
  rateLimiter({ name: 'auth:password:reset', limit: 10, windowSeconds: 900 }),
  validate(validateResetPassword),
  authController.resetPassword
);

// ── Email Change Verification ──────────────────────────────────
router.post(
  '/email/change-request',
  authenticate,
  rateLimiter({ name: 'auth:email:change', limit: 5, windowSeconds: 300 }),
  validate(validateEmailChangeRequest),
  authController.requestEmailChange
);
router.post(
  '/email/verify',
  authenticate,
  rateLimiter({ name: 'auth:email:verify', limit: 10, windowSeconds: 300 }),
  validate(validateEmailChangeVerify),
  authController.verifyEmailChange
);

// ── Active Sessions Management ─────────────────────────────────
router.get(
  '/sessions',
  authenticate,
  validate(createPaginationValidator({ maxLimit: 50, allowOffset: true, allowCursor: true })),
  authController.listSessions
);
router.delete(
  '/sessions/:sessionId',
  authenticate,
  authController.revokeSession
);
router.delete(
  '/sessions',
  authenticate,
  authController.revokeAllOtherSessions
);

export default router;
