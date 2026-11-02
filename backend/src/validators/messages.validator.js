/**
 * Messages Validator
 *
 * Enforces E2EE and payload size rules (Rule #14, #26):
 * - bodyCiphertext and nonce required
 * - plaintext or plain body explicitly forbidden
 * - maximum text message payload is 10 KB (10,240 UTF-8 bytes)
 *   plus 16-byte AES-GCM authentication tag (= 10,256 ciphertext bytes,
 *   or up to 13,676 Base64/Base64URL characters)
 * - nonce length bounded to prevent abuse
 */

export const MAX_MESSAGE_TEXT_BYTES = 10 * 1024; // 10,240 bytes
export const GCM_TAG_BYTES = 16;
export const MAX_CIPHERTEXT_BYTES = MAX_MESSAGE_TEXT_BYTES + GCM_TAG_BYTES; // 10,256 bytes
export const MAX_BODY_CIPHERTEXT_LENGTH = 13676; // Base64/Base64URL of 10,256 bytes
export const MAX_NONCE_LENGTH = 64;
export const MAX_CLIENT_MESSAGE_ID_LENGTH = 128;

/**
 * Compute decoded byte length of a Base64 / Base64URL string.
 * @param {string} str
 * @returns {number}
 */
function getDecodedCiphertextBytes(str) {
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').byteLength;
}

/**
 * Validate ciphertext and nonce constraints shared by send and edit.
 * @param {string} bodyCiphertext
 * @param {string} nonce
 * @param {string[]} errors
 */
function validateCiphertextAndNonce(bodyCiphertext, nonce, errors) {
  if (!bodyCiphertext || typeof bodyCiphertext !== 'string' || bodyCiphertext.trim().length === 0) {
    errors.push('bodyCiphertext is required');
  } else if (
    bodyCiphertext.length > MAX_BODY_CIPHERTEXT_LENGTH ||
    getDecodedCiphertextBytes(bodyCiphertext) > MAX_CIPHERTEXT_BYTES
  ) {
    errors.push('bodyCiphertext exceeds maximum allowed size (10 KB plaintext limit)');
  }

  if (!nonce || typeof nonce !== 'string' || nonce.trim().length === 0) {
    errors.push('nonce is required');
  } else if (nonce.length > MAX_NONCE_LENGTH) {
    errors.push(`nonce must not exceed ${MAX_NONCE_LENGTH} characters`);
  }
}

export function validateSendMessage(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  // Explicitly disallow plaintext per API contract §9
  if (body.body !== undefined || body.plaintext !== undefined) {
    return {
      valid: false,
      errors: ['Plaintext message content is strictly forbidden. Send bodyCiphertext and nonce.'],
    };
  }

  const { bodyCiphertext, nonce, clientMessageId } = body;

  validateCiphertextAndNonce(bodyCiphertext, nonce, errors);

  if (clientMessageId !== undefined) {
    if (typeof clientMessageId !== 'string') {
      errors.push('clientMessageId must be a string');
    } else if (clientMessageId.length > MAX_CLIENT_MESSAGE_ID_LENGTH) {
      errors.push(`clientMessageId must not exceed ${MAX_CLIENT_MESSAGE_ID_LENGTH} characters`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateEditMessage(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  if (body.body !== undefined || body.plaintext !== undefined) {
    return {
      valid: false,
      errors: ['Plaintext message content is strictly forbidden. Send bodyCiphertext and nonce.'],
    };
  }

  const { bodyCiphertext, nonce } = body;

  validateCiphertextAndNonce(bodyCiphertext, nonce, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateReceipt(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const { status } = body;
  if (!status || !['delivered', 'read'].includes(status)) {
    return {
      valid: false,
      errors: ['status is required and must be either "delivered" or "read"'],
    };
  }

  return { valid: true };
}
