/**
 * Friends Validator
 */

export function validateSendRequest(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const { userId } = body;
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    return { valid: false, errors: ['userId is required'] };
  }

  return { valid: true };
}
