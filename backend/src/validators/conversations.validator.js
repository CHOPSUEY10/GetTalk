/**
 * Conversations Validator
 */

import { UUID_REGEX, validatePaginationQuery } from './pagination.validator.js';

export const DEFAULT_CONVERSATIONS_LIMIT = 20;
export const MAX_CONVERSATIONS_LIMIT = 50;
export const CONVERSATION_CLEAR_SCOPES = Object.freeze(['me', 'everyone']);

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

/**
 * DELETE /api/conversations/:conversationId?scope=me|everyone
 * Validates conversationId UUID and optional scope ('me' | 'everyone', default 'me').
 */
export function validateClearConversation(body, req) {
  const errors = [];
  const conversationId = req?.params?.conversationId;

  if (!conversationId || typeof conversationId !== 'string' || !UUID_REGEX.test(conversationId)) {
    errors.push('conversationId must be a valid id');
  }

  const rawScope =
    req?.query?.scope !== undefined && req?.query?.scope !== ''
      ? req.query.scope
      : body?.scope;

  if (rawScope !== undefined && rawScope !== null && rawScope !== '') {
    if (typeof rawScope !== 'string') {
      errors.push("scope must be 'me' or 'everyone'");
    } else {
      const normalized = rawScope.trim().toLowerCase();
      if (!CONVERSATION_CLEAR_SCOPES.includes(normalized)) {
        errors.push("scope must be 'me' or 'everyone'");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
