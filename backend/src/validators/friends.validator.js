/**
 * Friends Validator
 */

import { validatePaginationQuery } from './pagination.validator.js';

export const DEFAULT_FRIENDS_LIMIT = 20;
export const MAX_FRIENDS_LIMIT = 50;
export const DEFAULT_FRIEND_REQUESTS_LIMIT = 20;
export const MAX_FRIEND_REQUESTS_LIMIT = 50;

/**
 * GET /api/friends?limit=&offset=&after=
 * Alphabetical (ascending) order; supports offset pagination (default limit 20, max 50)
 * as well as `after` cursor for keyset navigation.
 */
export function validateListFriendsQuery(body, req) {
  return validatePaginationQuery(req?.query, {
    cursorParam: 'after',
    maxLimit: MAX_FRIENDS_LIMIT,
    allowOffset: true,
    allowCursor: true,
  });
}

/**
 * GET /api/friends/requests?limit=&before=
 * Cursor-based pagination ordered by created_at DESC, id DESC.
 */
export function validateListFriendRequestsQuery(body, req) {
  return validatePaginationQuery(req?.query, {
    cursorParam: 'before',
    maxLimit: MAX_FRIEND_REQUESTS_LIMIT,
    allowOffset: false,
    allowCursor: true,
  });
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
