import { api } from './client.js';

/** @param {any} payload */
export const register = (payload) => {
  return api.post('/api/auth/register', payload);
};

/** @param {any} payload */
export const login = (payload) => {
  return api.post('/api/auth/login', payload);
};

export const logout = () => {
  return api.post('/api/auth/logout');
};

export const getSession = () => {
  return api.get('/api/auth/session');
};

/** @param {any} payload */
export const verifyMfa = (payload) => {
  return api.post('/api/auth/mfa/verify', payload);
};

