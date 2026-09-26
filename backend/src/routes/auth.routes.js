import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validate } from '../middleware/validation.middleware.js';
import {
  validateRegister,
  validateLogin,
  validateMfaVerify,
} from '../validators/auth.validator.js';

const router = Router();

router.post('/register', validate(validateRegister), authController.register);
router.post('/login', validate(validateLogin), authController.login);
router.post('/logout', authController.logout);
router.get('/session', authController.session);
router.post('/mfa/verify', validate(validateMfaVerify), authController.mfaVerify);

export default router;
