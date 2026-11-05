import { api } from './client.js';

/**
 * Fetch accepted friends for the authenticated user (offset/cursor-paginated).
 * @param {{ limit?: number, offset?: number, after?: string, cursor?: string }} [params]
 * @returns {Promise<{
 *   data: any[],
 *   friends: any[],
 *   nextCursor: string | null,
 *   hasMore: boolean,
 *   pagination: { limit: number, offset: number, total: number, hasMore: boolean, nextCursor?: string | null }
 * }>}
 */
export const friendLists = (params = {}) => {
  const query = new URLSearchParams();
  if (params.limit !== undefined && params.limit !== null) {
    query.set('limit', String(params.limit));
  }
  if (params.offset !== undefined && params.offset !== null) {
    query.set('offset', String(params.offset));
  }
  const afterCursor = params.after ?? params.cursor;
  if (afterCursor !== undefined && afterCursor !== null && afterCursor !== '') {
    query.set('after', String(afterCursor));
  }
  const qs = query.toString() ? `?${query.toString()}` : '';

  return api.get(`/api/friends${qs}`);
};

/**
 * Fetch incoming pending friend requests (cursor-paginated).
 * @param {{ limit?: number, before?: string, cursor?: string, offset?: number }} [params]
 * @returns {Promise<{
 *   data: any[],
 *   requests: any[],
 *   nextCursor: string | null,
 *   hasMore: boolean,
 *   pagination: { limit: number, nextCursor: string | null, hasMore: boolean }
 * }>}
 */
export const friendRequestList = (params = {}) => {
  const query = new URLSearchParams();
  if (params.limit !== undefined && params.limit !== null) {
    query.set('limit', String(params.limit));
  }
  const beforeCursor = params.before ?? params.cursor;
  if (beforeCursor !== undefined && beforeCursor !== null && beforeCursor !== '') {
    query.set('before', String(beforeCursor));
  }
  if (params.offset !== undefined && params.offset !== null) {
    query.set('offset', String(params.offset));
  }
  const qs = query.toString() ? `?${query.toString()}` : '';

  return api.get(`/api/friends/requests${qs}`);
};

// Aliases for consistency across modules
export const listFriends = friendLists;
export const listFriendRequests = friendRequestList;

// Menambahkan permintaan pertemanan
/** @param {any} payload */
export const friendRequest = (payload) => {
  return api.post('/api/friends/requests', payload);
};

// Menerima permintaan pertemanan
/** @param {string} requestId */
export const acceptFriendRequests = (requestId) => {
  return api.post(`/api/friends/requests/${requestId}/accept`, {});
};

// Menolak permintaan pertemanan
/** @param {string} requestId */
export const rejectFriendRequests = (requestId) => {
  return api.post(`/api/friends/requests/${requestId}/reject`, {});
};

// Menghapus dari daftar pertemanan
/** @param {any} requestId */
export const deleteFromFriendList = (requestId) => {
  return api.delete(`/api/friends/${requestId}`);
};
