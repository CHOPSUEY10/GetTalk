import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validation.middleware.js';
import { rateLimiter } from '../middleware/rate-limit.middleware.js';
import {
  validateRegister,
  validateLogin,
  validateMfaVerify,
} from '../validators/auth.validator.js';

const router = Router();

router.post('/register', rateLimiter({ name: 'auth:register', limit: 10, windowSeconds: 60 }), validate(validateRegister), authController.register);
router.post('/login', rateLimiter({ name: 'auth:login', limit: 10, windowSeconds: 60 }), validate(validateLogin), authController.login);
router.post('/logout', authController.logout);
router.get('/session', authController.session);
router.post('/mfa/verify', rateLimiter({ name: 'auth:mfa', limit: 10, windowSeconds: 60 }), validate(validateMfaVerify), authController.mfaVerify);

export default router;
