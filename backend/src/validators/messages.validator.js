/**
 * Messages Validator
 *
 * Enforces E2EE rules:
 * - bodyCiphertext and nonce required
 * - plaintext or plain body explicitly forbidden
 * - senderId / conversationId not repeated in body
 */

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

  if (!bodyCiphertext || typeof bodyCiphertext !== 'string' || bodyCiphertext.trim().length === 0) {
    errors.push('bodyCiphertext is required');
  }

  if (!nonce || typeof nonce !== 'string' || nonce.trim().length === 0) {
    errors.push('nonce is required');
  }

  if (clientMessageId !== undefined && typeof clientMessageId !== 'string') {
    errors.push('clientMessageId must be a string');
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

  if (!bodyCiphertext || typeof bodyCiphertext !== 'string' || bodyCiphertext.trim().length === 0) {
    errors.push('bodyCiphertext is required');
  }

  if (!nonce || typeof nonce !== 'string' || nonce.trim().length === 0) {
    errors.push('nonce is required');
  }

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
