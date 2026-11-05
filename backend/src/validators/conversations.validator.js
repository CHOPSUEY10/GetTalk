/**
 * Conversations Validator
 */

import { validatePaginationQuery } from './pagination.validator.js';

export const DEFAULT_CONVERSATIONS_LIMIT = 20;
export const MAX_CONVERSATIONS_LIMIT = 50;

/**
 * GET /api/conversations?limit=&before=
 * Newest activity first; `before` is the last conversation id or updated_at ISO string.
 */
export function validateListConversationsQuery(body, req) {
  return validatePaginationQuery(req?.query, {
    cursorParam: 'before',
    maxLimit: MAX_CONVERSATIONS_LIMIT,
    allowOffset: false,
    allowCursor: true,
  });
}

export function validateCreateConversation(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const { userId } = body;
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    return { valid: false, errors: ['userId is required'] };
  }

  return { valid: true };
}
