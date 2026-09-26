import { Router } from 'express';
import * as usersController from '../controllers/users.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { validateSearchQuery } from '../validators/users.validator.js';

const router = Router();

router.use(authenticate);

router.get('/me', usersController.getMe);
router.get('/search', validate(validateSearchQuery), usersController.search);
router.get('/:userId', usersController.getById);

export default router;
