import { Router } from 'express';
import * as attachmentsController from '../controllers/attachments.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { rateLimiter } from '../middleware/rate-limit.middleware.js';
import { validateUploadAttachment } from '../validators/attachments.validator.js';

const router = Router();

router.use(authenticate);

router.post('/', rateLimiter({ name: 'attachments:upload', limit: 30, windowSeconds: 60 }), validate(validateUploadAttachment), attachmentsController.upload);
router.get('/:attachmentId', attachmentsController.getById);
router.delete('/:attachmentId', attachmentsController.remove);

export default router;
