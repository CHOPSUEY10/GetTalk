import { UUID_REGEX } from '../utils/pagination.js';

/**
 * Attachments Validator (issues #14, #15)
 *
 * Uploads are raw encrypted bytes (`application/octet-stream`). Message id
 * and encrypted metadata travel in headers (direct upload) or JSON body
 * (pre-signed upload request). Plaintext metadata is strictly forbidden.
 */

/** 25 MiB plaintext client limit + AES-GCM overhead (matches 26mb route limit). */
export const MAX_ATTACHMENT_BYTES = 26 * 1024 * 1024;

export function validateUploadAttachment(body, req) {
  const errors = [];
  const headers = req?.headers || {};

  const messageId = headers['x-message-id'];
  const metadataCiphertext = headers['x-metadata-ciphertext'];
  const metadataNonce = headers['x-metadata-nonce'];

  if (!Buffer.isBuffer(body) || body.length === 0) {
    errors.push(
      'Encrypted attachment body is required (Content-Type: application/octet-stream)'
    );
  } else if (body.length > MAX_ATTACHMENT_BYTES) {
    errors.push(`Encrypted attachment exceeds maximum size of ${MAX_ATTACHMENT_BYTES} bytes`);
  }

  if (!messageId || typeof messageId !== 'string') {
    errors.push('X-Message-Id header is required');
  }

  if (!metadataCiphertext || typeof metadataCiphertext !== 'string') {
    errors.push('X-Metadata-Ciphertext header is required');
  }

  if (!metadataNonce || typeof metadataNonce !== 'string') {
    errors.push('X-Metadata-Nonce header is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * POST /api/attachments/presign
 * Requests a short-lived pre-signed PUT URL for uploading an encrypted file.
 */
export function validatePresignAttachment(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  // Strictly forbid plaintext metadata or server-controlled fields (API contract §1, §10, §12).
  if (
    body.filename !== undefined ||
    body.originalName !== undefined ||
    body.mimeType !== undefined ||
    body.plaintext !== undefined
  ) {
    return {
      valid: false,
      errors: [
        'Plaintext attachment metadata is strictly forbidden. Send metadataCiphertext and metadataNonce.',
      ],
    };
  }

  if (body.uploaderId !== undefined || body.storageKey !== undefined) {
    return {
      valid: false,
      errors: ['uploaderId and storageKey must not be supplied by the client'],
    };
  }

  const { messageId, metadataCiphertext, metadataNonce, sizeBytes } = body;

  if (!messageId || typeof messageId !== 'string' || !UUID_REGEX.test(messageId)) {
    errors.push('messageId must be a valid id');
  }

  if (
    !metadataCiphertext ||
    typeof metadataCiphertext !== 'string' ||
    metadataCiphertext.trim().length === 0
  ) {
    errors.push('metadataCiphertext is required');
  }

  if (
    !metadataNonce ||
    typeof metadataNonce !== 'string' ||
    metadataNonce.trim().length === 0
  ) {
    errors.push('metadataNonce is required');
  }

  const parsedSize = Number(sizeBytes);
  if (!Number.isInteger(parsedSize) || parsedSize <= 0) {
    errors.push('sizeBytes must be a positive integer');
  } else if (parsedSize > MAX_ATTACHMENT_BYTES) {
    errors.push(`sizeBytes must not exceed ${MAX_ATTACHMENT_BYTES} bytes`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateAttachmentIdParam(_body, req) {
  const attachmentId = req?.params?.attachmentId;
  if (!attachmentId || !UUID_REGEX.test(attachmentId)) {
    return { valid: false, errors: ['attachmentId must be a valid id'] };
  }
  return { valid: true, errors: [] };
}
