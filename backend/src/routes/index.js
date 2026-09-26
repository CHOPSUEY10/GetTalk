import { Router } from 'express';

import authRoutes          from './auth.routes.js';
import usersRoutes         from './users.routes.js';
import friendsRoutes       from './friends.routes.js';
import conversationsRoutes from './conversations.routes.js';
import messagesRoutes      from './messages.routes.js';
import attachmentsRoutes   from './attachments.routes.js';

// Standalone message operations (edit, delete, receipt)
import * as messagesController from '../controllers/messages.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { validateEditMessage, validateReceipt } from '../validators/messages.validator.js';

const router = Router();

// ── Domain routes ──────────────────────────────────────────────
router.use('/auth',          authRoutes);
router.use('/users',         usersRoutes);
router.use('/friends',       friendsRoutes);
router.use('/conversations', conversationsRoutes);
router.use('/attachments',   attachmentsRoutes);

// Messages scoped under a conversation
router.use('/conversations/:conversationId/messages', messagesRoutes);

// Standalone message endpoints
router.patch('/messages/:messageId', authenticate, validate(validateEditMessage), messagesController.update);
router.delete('/messages/:messageId', authenticate, messagesController.remove);
router.post('/messages/:messageId/receipt', authenticate, validate(validateReceipt), messagesController.receipt);

export default router;
