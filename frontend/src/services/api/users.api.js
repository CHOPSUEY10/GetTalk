import { api } from './client.js';

export const getCurrentUser = () => {
  return api.get('/api/users/me');
};

/** @param {string} query */
export const searchUsers = (query) => {
  const safeQuery = encodeURIComponent(query);
  return api.get(`/api/users/search?q=${safeQuery}`);
};

/** @param {string} userId */
export const getUser = (userId) => {
  const safeUserId = encodeURIComponent(userId);
  return api.get(`/api/users/${safeUserId}`);
};

/**
 * Upload the user's ECDH public key (base64url) for peer key exchange.
 * @param {string} publicKey
 */
export const uploadPublicKey = (publicKey) => {
  return api.post('/api/users/me/public-key', { publicKey });
};

/**
 * Fetch a peer's ECDH public key (base64url) for key exchange.
 * @param {string} userId
 * @returns {Promise<{ userId: string, publicKey: string | null }>}
 */
export const getUserPublicKey = (userId) => {
  const safeUserId = encodeURIComponent(userId);
  return api.get(`/api/users/${safeUserId}/public-key`);
};
