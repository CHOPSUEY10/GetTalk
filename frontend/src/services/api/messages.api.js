import { api } from './client.js';

/**
 * Fetch messages for a specific conversation (cursor-paginated, max 50 per page per Rule #13).
 * @param {string} conversationId
 * @param {{ limit?: number, before?: string, cursor?: string, offset?: number }} [params]
 * @returns {Promise<{
 *   data: any[],
 *   messages: any[],
 *   nextCursor: string | null,
 *   hasMore: boolean,
 *   pagination: { limit: number, nextCursor: string | null, hasMore: boolean }
 * }>}
 */
export const listMessages = (conversationId, params = {}) => {
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

  return api.get(`/api/conversations/${encodeURIComponent(conversationId)}/messages${qs}`);
};

/**
 * Send an encrypted message payload via REST API (fallback / mutation).
 * @param {string} conversationId
 * @param {{ bodyCiphertext: string, nonce: string, clientMessageId?: string }} payload
 * @returns {Promise<{ message: any }>}
 */
export const sendMessage = (conversationId, payload) => {
  return api.post(`/api/conversations/${conversationId}/messages`, payload);
};

/**
 * Update / edit an existing message.
 * @param {string} messageId
 * @param {{ bodyCiphertext: string, nonce: string }} payload
 * @returns {Promise<{ message: any }>}
 */
export const updateMessage = (messageId, payload) => {
  return api.patch(`/api/messages/${messageId}`, payload);
};

/**
 * Delete a message.
 * @param {string} messageId
 * @returns {Promise<void>}
 */
export const deleteMessage = (messageId) => {
  return api.delete(`/api/messages/${messageId}`);
};

/**
 * Send delivery / read receipt for a message.
 * @param {string} messageId
 * @param {'delivered' | 'read'} status
 * @returns {Promise<void>}
 */
export const sendReceipt = (messageId, status) => {
  return api.post(`/api/messages/${messageId}/receipt`, { status });
};

// Aliases for backward compatibility
export const getMessages = listMessages;
export const sendMessages = (payload, convId) => sendMessage(convId, payload);
