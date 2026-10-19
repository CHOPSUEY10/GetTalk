/**
 * Attachments Validator
 *
 * Issue #15: plaintext filename/MIME type and plaintext checksums are no
 * longer accepted. Clients send an encrypted metadata blob instead.
 */

export function validateUploadAttachment(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  if (body.originalName !== undefined || body.filename !== undefined ||
      body.mimeType !== undefined || body.checksum !== undefined) {
    return {
      valid: false,
      errors: [
        'Plaintext attachment metadata is not accepted. Encrypt filename/MIME type client-side and send metadataCiphertext + metadataNonce.',
      ],
    };
  }

  const { messageId, sizeBytes, metadataCiphertext, metadataNonce } = body;

  if (!messageId || typeof messageId !== 'string') {
    errors.push('messageId is required');
  }

  if (sizeBytes === undefined || typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    errors.push('sizeBytes must be a positive number');
  }

  if (!metadataCiphertext || typeof metadataCiphertext !== 'string' || metadataCiphertext.trim().length === 0) {
    errors.push('metadataCiphertext is required');
  }

  if (!metadataNonce || typeof metadataNonce !== 'string' || metadataNonce.trim().length === 0) {
    errors.push('metadataNonce is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
