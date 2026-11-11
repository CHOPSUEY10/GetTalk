import { Router } from 'express';
import * as usersController from '../controllers/users.controller.js';
import * as identityKeysController from '../controllers/identity-keys.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { rateLimiter } from '../middleware/rate-limit.middleware.js';
import {
  validateSearchQuery,
  validateUpdateProfile,
  validateUpdatePrivacy,
  validateBlockedUsersQuery,
} from '../validators/users.validator.js';
import { validateRegisterIdentityKey } from '../validators/identity-keys.validator.js';

const router = Router();

router.use(authenticate);

router.get('/me', usersController.getMe);
router.patch(
  '/me/profile',
  rateLimiter({ name: 'users:profile:update', limit: 20, windowSeconds: 60 }),
  validate(validateUpdateProfile),
  usersController.updateProfile
);
router.get('/me/privacy', usersController.getPrivacy);
router.patch(
  '/me/privacy',
  rateLimiter({ name: 'users:privacy:update', limit: 30, windowSeconds: 60 }),
  validate(validateUpdatePrivacy),
  usersController.updatePrivacy
);
router.get(
  '/me/blocked',
  validate(validateBlockedUsersQuery),
  usersController.listBlockedUsers
);

router.get('/search', validate(validateSearchQuery), usersController.search);

// E2EE identity public key registry (issue #11). Public keys are public;
// authentication only prevents anonymous enumeration.
router.put('/me/identity-key', validate(validateRegisterIdentityKey), identityKeysController.register);
router.delete('/me/identity-key', identityKeysController.remove);
router.get('/:userId/identity-key', identityKeysController.get);

router.post(
  '/:userId/block',
  rateLimiter({ name: 'users:block', limit: 30, windowSeconds: 60 }),
  usersController.blockUser
);
router.delete(
  '/:userId/block',
  rateLimiter({ name: 'users:unblock', limit: 30, windowSeconds: 60 }),
  usersController.unblockUser
);

router.get('/:userId', usersController.getById);

export default router;
