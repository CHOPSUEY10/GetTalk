/**
 * Attachments Validator (issues #14, #15)
 *
 * Uploads are raw encrypted bytes (`application/octet-stream`). Message id
 * and encrypted metadata travel in headers so the body stays binary.
 */

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
