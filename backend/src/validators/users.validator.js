/**
 * Users Validator
 */

import { validatePaginationQuery } from './pagination.validator.js';

export const DEFAULT_USER_SEARCH_LIMIT = 10;
export const MAX_USER_SEARCH_LIMIT = 30;

/**
 * GET /api/users/search?q=&limit=&offset=
 */
export function validateSearchQuery(body, req) {
  const q = req?.query?.q;
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return {
      valid: false,
      errors: ['Query parameter "q" is required'],
    };
  }

  return validatePaginationQuery(req?.query, {
    maxLimit: MAX_USER_SEARCH_LIMIT,
    allowOffset: true,
    allowCursor: false,
  });
}
