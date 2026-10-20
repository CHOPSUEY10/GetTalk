import { Router } from 'express';
import * as usersController from '../controllers/users.controller.js';
import * as identityKeysController from '../controllers/identity-keys.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { validateSearchQuery } from '../validators/users.validator.js';
import { validateRegisterIdentityKey } from '../validators/identity-keys.validator.js';

const router = Router();

router.use(authenticate);

router.get('/me', usersController.getMe);
router.get('/search', validate(validateSearchQuery), usersController.search);

// E2EE identity public key registry (issue #11). Public keys are public;
// authentication only prevents anonymous enumeration.
router.put('/me/identity-key', validate(validateRegisterIdentityKey), identityKeysController.register);
router.delete('/me/identity-key', identityKeysController.remove);
router.get('/:userId/identity-key', identityKeysController.get);

router.get('/:userId', usersController.getById);

export default router;
