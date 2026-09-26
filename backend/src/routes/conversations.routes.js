import { Router } from 'express';
import * as conversationsController from '../controllers/conversations.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { validateCreateConversation } from '../validators/conversations.validator.js';

const router = Router();

router.use(authenticate);

router.get('/', conversationsController.list);
router.get('/:conversationId', conversationsController.getById);
router.post('/', validate(validateCreateConversation), conversationsController.create);

export default router;
