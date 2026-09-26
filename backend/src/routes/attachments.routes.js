import { Router } from 'express';
import * as attachmentsController from '../controllers/attachments.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { validateUploadAttachment } from '../validators/attachments.validator.js';

const router = Router();

router.use(authenticate);

router.post('/', validate(validateUploadAttachment), attachmentsController.upload);
router.get('/:attachmentId', attachmentsController.getById);
router.delete('/:attachmentId', attachmentsController.remove);

export default router;
