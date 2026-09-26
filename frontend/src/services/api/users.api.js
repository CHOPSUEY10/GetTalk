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

