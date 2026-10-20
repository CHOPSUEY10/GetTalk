/**
 * Identity key validator (issue #11).
 *
 * Only shape is checked here; the service performs the actual EC point
 * validation before anything is stored.
 */
export function validateRegisterIdentityKey(body) {
  const publicKey = body?.publicKey;

  if (typeof publicKey !== 'string' || publicKey.trim() === '') {
    return {
      valid: false,
      errors: ['publicKey is required'],
    };
  }

  if (publicKey.length > 100) {
    return {
      valid: false,
      errors: ['publicKey has an invalid length'],
    };
  }

  return { valid: true };
}
