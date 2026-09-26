/**
 * Attachments Validator
 */

export function validateUploadAttachment(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const originalName = body.originalName || body.filename;
  const mimeType = body.mimeType;
  const sizeBytes = body.sizeBytes !== undefined ? body.sizeBytes : body.size;

  if (!originalName || typeof originalName !== 'string') {
    errors.push('originalName or filename is required');
  }

  if (!mimeType || typeof mimeType !== 'string') {
    errors.push('mimeType is required');
  }

  if (sizeBytes === undefined || typeof sizeBytes !== 'number' || sizeBytes <= 0) {
    errors.push('sizeBytes or size must be a positive number');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
