/**
 * Users Validator
 */

export function validateSearchQuery(body, req) {
  const q = req?.query?.q;
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return {
      valid: false,
      errors: ['Query parameter "q" is required'],
    };
  }
  return { valid: true };
}
