import { api } from './client.js';

/** @param {any} payload */
export const register = (payload) => {
  return api.post('/api/auth/register', payload);
};

/** @param {any} payload */
export const login = (payload) => {
  return api.post('/api/auth/login', payload, { suppressUnauthorizedEvent: true });
};

export const logout = () => {
  return api.post('/api/auth/logout');
};

export const getSession = () => {
  return api.get('/api/auth/session', { suppressUnauthorizedEvent: true });
};

/** @param {any} payload */
export const verifyMfa = (payload) => {
  return api.post('/api/auth/mfa/verify', payload, { suppressUnauthorizedEvent: true });
};

export const getMfaStatus = () => api.get('/api/auth/mfa/status');

export const setupMfa = (payload) => api.post('/api/auth/mfa/setup', payload);

export const enableMfa = (payload) => api.post('/api/auth/mfa/enable', payload);

export const disableMfa = (payload) => api.delete('/api/auth/mfa', { body: payload });
export const forgotPassword = (payload) => api.post('/api/auth/password/forgot', payload);

export const resetPassword = (payload) => api.post('/api/auth/password/reset', payload);
