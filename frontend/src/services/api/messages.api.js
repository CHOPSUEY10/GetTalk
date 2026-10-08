import { api } from './client.js';

/**
 * Fetch messages for a specific conversation.
 * @param {string} conversationId
 * @param {{ limit?: number, before?: string }} [params]
 * @returns {Promise<{ messages: any[], nextCursor: string | null }>}
 */
export const listMessages = (conversationId, params = {}) => {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.before) query.set('before', params.before);
  const qs = query.toString() ? `?${query.toString()}` : '';

  return api.get(`/api/conversations/${conversationId}/messages${qs}`);
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
