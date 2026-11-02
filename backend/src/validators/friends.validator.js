/**
 * Friends Validator
 */

import { validatePaginationQuery } from '../utils/pagination.js';

/**
 * GET /api/friends?limit=&after=
 * Alphabetical (ascending) order; `after` is the last friend userId of the previous page.
 */
export function validateListFriendsQuery(body, req) {
  return validatePaginationQuery(req?.query, 'after');
}

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
