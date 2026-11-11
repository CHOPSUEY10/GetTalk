/**
 * Users Validator
 */

import { validatePaginationQuery } from './pagination.validator.js';

export const DEFAULT_USER_SEARCH_LIMIT = 10;
export const MAX_USER_SEARCH_LIMIT = 30;

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,50}$/;
const VISIBILITY_THREE_LEVELS = new Set(['everyone', 'friends', 'nobody']);
const VISIBILITY_TWO_LEVELS = new Set(['everyone', 'friends']);
const ALLOWED_DISAPPEARING_TIMERS = new Set([0, 86400, 604800, 7776000]);

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

/**
 * PATCH /api/users/me/profile
 */
export function validateUpdateProfile(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const hasUsername = Object.prototype.hasOwnProperty.call(body, 'username');
  const hasNickname = Object.prototype.hasOwnProperty.call(body, 'nickname');
  const hasBio = Object.prototype.hasOwnProperty.call(body, 'bio');

  if (!hasUsername && !hasNickname && !hasBio) {
    return {
      valid: false,
      errors: ['At least one profile field (username, nickname, or bio) must be provided'],
    };
  }

  if (hasUsername) {
    if (typeof body.username !== 'string' || !USERNAME_REGEX.test(body.username.trim())) {
      errors.push('Username must be 3-50 characters long and contain only letters, numbers, underscores, or hyphens');
    }
  }

  if (hasNickname && body.nickname !== null) {
    if (typeof body.nickname !== 'string') {
      errors.push('Nickname must be a string');
    } else if (body.nickname.trim().length > 60) {
      errors.push('Nickname must not exceed 60 characters');
    }
  }

  if (hasBio && body.bio !== null) {
    if (typeof body.bio !== 'string') {
      errors.push('Bio must be a string');
    } else if (body.bio.trim().length > 160) {
      errors.push('Bio must not exceed 160 characters');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * PATCH /api/users/me/privacy
 */
export function validateUpdatePrivacy(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body is required'] };
  }

  const allowedKeys = [
    'lastSeenVisibility',
    'onlineVisibility',
    'readReceiptsEnabled',
    'typingIndicatorEnabled',
    'whoCanMessage',
    'whoCanAddToGroups',
    'defaultDisappearingTimer',
    'securityChangeNotifications',
  ];

  const providedKeys = allowedKeys.filter((k) => Object.prototype.hasOwnProperty.call(body, k));
  if (providedKeys.length === 0) {
    return {
      valid: false,
      errors: ['At least one privacy setting field must be provided'],
    };
  }

  if (body.lastSeenVisibility !== undefined && !VISIBILITY_THREE_LEVELS.has(body.lastSeenVisibility)) {
    errors.push('lastSeenVisibility must be one of: everyone, friends, nobody');
  }

  if (body.onlineVisibility !== undefined && !VISIBILITY_THREE_LEVELS.has(body.onlineVisibility)) {
    errors.push('onlineVisibility must be one of: everyone, friends, nobody');
  }

  if (body.readReceiptsEnabled !== undefined && typeof body.readReceiptsEnabled !== 'boolean') {
    errors.push('readReceiptsEnabled must be a boolean');
  }

  if (body.typingIndicatorEnabled !== undefined && typeof body.typingIndicatorEnabled !== 'boolean') {
    errors.push('typingIndicatorEnabled must be a boolean');
  }

  if (body.whoCanMessage !== undefined && !VISIBILITY_TWO_LEVELS.has(body.whoCanMessage)) {
    errors.push('whoCanMessage must be one of: everyone, friends');
  }

  if (body.whoCanAddToGroups !== undefined && !VISIBILITY_TWO_LEVELS.has(body.whoCanAddToGroups)) {
    errors.push('whoCanAddToGroups must be one of: everyone, friends');
  }

  if (body.defaultDisappearingTimer !== undefined) {
    const timer = Number(body.defaultDisappearingTimer);
    if (!Number.isInteger(timer) || !ALLOWED_DISAPPEARING_TIMERS.has(timer)) {
      errors.push('defaultDisappearingTimer must be one of: 0, 86400, 604800, 7776000');
    }
  }

  if (body.securityChangeNotifications !== undefined && typeof body.securityChangeNotifications !== 'boolean') {
    errors.push('securityChangeNotifications must be a boolean');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * GET /api/users/me/blocked?limit=&offset=&after=
 */
export function validateBlockedUsersQuery(body, req) {
  return validatePaginationQuery(req?.query, {
    maxLimit: 100,
    allowOffset: true,
    allowCursor: true,
  });
}
