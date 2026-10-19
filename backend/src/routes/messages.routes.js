import { Router } from 'express';
import * as messagesController from '../controllers/messages.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { rateLimiter } from '../middleware/rate-limit.middleware.js';
import { validateSendMessage } from '../validators/messages.validator.js';

// mergeParams: true ensures :conversationId from parent router is available
const router = Router({ mergeParams: true });

router.use(authenticate);

// Nested under /api/conversations/:conversationId/messages
router.get('/', messagesController.list);
router.post('/', rateLimiter({ name: 'messages:send', limit: 120, windowSeconds: 60 }), validate(validateSendMessage), messagesController.create);

export default router;
