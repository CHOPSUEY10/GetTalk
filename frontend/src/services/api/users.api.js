import { api } from './client.js';

export const getCurrentUser = () => {
  return api.get('/api/users/me');
};

/**
 * Update the current user's profile (`username`, `nickname`, `bio`).
 * @param {{ username?: string, nickname?: string | null, bio?: string | null }} payload
 */
export const updateProfile = (payload) => {
  return api.patch('/api/users/me/profile', payload);
};

/**
 * Fetch the current user's chat privacy settings.
 */
export const getPrivacySettings = () => {
  return api.get('/api/users/me/privacy');
};

/**
 * Update the current user's chat privacy settings.
 * @param {Record<string, any>} payload
 */
export const updatePrivacySettings = (payload) => {
  return api.patch('/api/users/me/privacy', payload);
};

/**
 * Fetch blocked users with pagination (`limit`, `offset`, `after`).
 * @param {{ limit?: number, offset?: number, after?: string }} [params]
 */
export const getBlockedUsers = ({ limit = 20, offset = 0, after } = {}) => {
  const searchParams = new URLSearchParams();
  if (limit !== undefined && limit !== null) searchParams.set('limit', String(limit));
  if (offset !== undefined && offset !== null) searchParams.set('offset', String(offset));
  if (after) searchParams.set('after', String(after));
  const qs = searchParams.toString();
  return api.get(`/api/users/me/blocked${qs ? `?${qs}` : ''}`);
};

/**
 * Block a user by ID.
 * @param {string} userId
 */
export const blockUser = (userId) => {
  const safeId = encodeURIComponent(userId);
  return api.post(`/api/users/${safeId}/block`, {});
};

/**
 * Unblock a user by ID.
 * @param {string} userId
 */
export const unblockUser = (userId) => {
  const safeId = encodeURIComponent(userId);
  return api.delete(`/api/users/${safeId}/block`);
};

/**
 * Search users by username with optional pagination params (`limit`, `offset`).
 * Supports both `searchUsers('alice', { limit, offset })` and `searchUsers({ q: 'alice', limit, offset })`.
 *
 * @param {string | { q?: string, query?: string, limit?: number, offset?: number }} queryOrParams
 * @param {{ limit?: number, offset?: number }} [params]
 * @returns {Promise<{
 *   data: any[],
 *   users: any[],
 *   hasMore: boolean,
 *   pagination: { limit: number, offset: number, total: number, hasMore: boolean }
 * }>}
 */
export const searchUsers = (queryOrParams, params = {}) => {
  let q = '';
  let limit = params?.limit;
  let offset = params?.offset;

  if (typeof queryOrParams === 'string') {
    q = queryOrParams;
  } else if (queryOrParams && typeof queryOrParams === 'object') {
    q = queryOrParams.q ?? queryOrParams.query ?? '';
    if (queryOrParams.limit !== undefined) limit = queryOrParams.limit;
    if (queryOrParams.offset !== undefined) offset = queryOrParams.offset;
  }

  const searchParams = new URLSearchParams();
  searchParams.set('q', q);
  if (limit !== undefined && limit !== null) {
    searchParams.set('limit', String(limit));
  }
  if (offset !== undefined && offset !== null) {
    searchParams.set('offset', String(offset));
  }

  return api.get(`/api/users/search?${searchParams.toString()}`);
};

/** @param {string} userId */
export const getUser = (userId) => {
  const safeUserId = encodeURIComponent(userId);
  return api.get(`/api/users/${safeUserId}`);
};
