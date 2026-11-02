import { Router } from 'express';
import express from 'express';
import * as attachmentsController from '../controllers/attachments.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { rateLimiter } from '../middleware/rate-limit.middleware.js';
import {
  validateUploadAttachment,
  validatePresignAttachment,
  validateAttachmentIdParam,
} from '../validators/attachments.validator.js';

const router = Router();

router.use(authenticate);

const uploadRateLimit = rateLimiter({
  name: 'attachments:upload',
  limit: 30,
  windowSeconds: 60,
});

// Pre-signed upload flow:
//   1. POST /api/attachments/presign            -> { attachment, upload: { url, method, headers, expiresAt } }
//   2. PUT  <upload.url>                        -> raw encrypted bytes (S3/MinIO/Supabase or local signed endpoint)
//   3. POST /api/attachments/:id/complete       -> { attachment } + emits attachment:new
router.post(
  '/presign',
  uploadRateLimit,
  validate(validatePresignAttachment),
  attachmentsController.presignUpload
);
router.post(
  '/upload-url',
  uploadRateLimit,
  validate(validatePresignAttachment),
  attachmentsController.presignUpload
);
router.post(
  '/:attachmentId/complete',
  validate(validateAttachmentIdParam),
  attachmentsController.completeUpload
);

// Pre-signed download URL:
//   GET /api/attachments/:attachmentId/url      -> { url, expiresAt }
router.get(
  '/:attachmentId/url',
  validate(validateAttachmentIdParam),
  attachmentsController.getDownloadUrl
);
router.get(
  '/:attachmentId/presign',
  validate(validateAttachmentIdParam),
  attachmentsController.getDownloadUrl
);

// Direct binary upload (kept for backward compatibility): encrypted bytes as
// application/octet-stream; metadata travels in headers. 26 MB covers the
// 25 MB plaintext client limit plus GCM overhead.
router.post(
  '/',
  uploadRateLimit,
  express.raw({ type: 'application/octet-stream', limit: '26mb' }),
  validate(validateUploadAttachment),
  attachmentsController.upload
);
router.get(
  '/:attachmentId/content',
  validate(validateAttachmentIdParam),
  attachmentsController.getContent
);
router.get(
  '/:attachmentId',
  validate(validateAttachmentIdParam),
  attachmentsController.getById
);
router.delete(
  '/:attachmentId',
  validate(validateAttachmentIdParam),
  attachmentsController.remove
);

export default router;
