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

export const setupMfa = (payload) =>
  api.post('/api/auth/mfa/setup', payload, { suppressUnauthorizedEvent: true });

export const enableMfa = (payload) =>
  api.post('/api/auth/mfa/enable', payload, { suppressUnauthorizedEvent: true });

export const disableMfa = (payload) =>
  api.delete('/api/auth/mfa', { body: payload, suppressUnauthorizedEvent: true });

export const regenerateRecoveryCodes = (payload) =>
  api.post('/api/auth/mfa/recovery-codes/regenerate', payload, { suppressUnauthorizedEvent: true });

export const changePassword = (payload) =>
  api.post('/api/auth/password', payload, { suppressUnauthorizedEvent: true });

export const forgotPassword = (payload) => api.post('/api/auth/password/forgot', payload);

export const resetPassword = (payload) => api.post('/api/auth/password/reset', payload);

export const requestEmailChange = (payload) =>
  api.post('/api/auth/email/change-request', payload, { suppressUnauthorizedEvent: true });

export const verifyEmailChange = (payload) =>
  api.post('/api/auth/email/verify', payload);

/**
 * List active sessions for the current user with pagination (`limit`, `offset`, `after`).
 * @param {{ limit?: number, offset?: number, after?: string }} [params]
 */
export const getSessions = ({ limit = 20, offset = 0, after } = {}) => {
  const searchParams = new URLSearchParams();
  if (limit !== undefined && limit !== null) searchParams.set('limit', String(limit));
  if (offset !== undefined && offset !== null) searchParams.set('offset', String(offset));
  if (after) searchParams.set('after', String(after));
  const qs = searchParams.toString();
  return api.get(`/api/auth/sessions${qs ? `?${qs}` : ''}`);
};

/**
 * Revoke a specific session by ID.
 * @param {string} sessionId
 */
export const revokeSession = (sessionId) => {
  const safeId = encodeURIComponent(sessionId);
  return api.delete(`/api/auth/sessions/${safeId}`);
};

/**
 * Terminate all other active sessions except the current session.
 */
export const revokeOtherSessions = () => {
  return api.delete('/api/auth/sessions');
};
