import { Router } from 'express';
import express from 'express';
import * as attachmentsController from '../controllers/attachments.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { rateLimiter } from '../middleware/rate-limit.middleware.js';
import { validateUploadAttachment } from '../validators/attachments.validator.js';

const router = Router();

router.use(authenticate);

// Encrypted bytes are uploaded as application/octet-stream; metadata travels
// in headers. 26 MB covers the 25 MB plaintext client limit plus GCM overhead.
router.post(
  '/',
  rateLimiter({ name: 'attachments:upload', limit: 30, windowSeconds: 60 }),
  express.raw({ type: 'application/octet-stream', limit: '26mb' }),
  validate(validateUploadAttachment),
  attachmentsController.upload
);
router.get('/:attachmentId/content', attachmentsController.getContent);
router.get('/:attachmentId', attachmentsController.getById);
router.delete('/:attachmentId', attachmentsController.remove);

export default router;
