import { api } from './client.js';

/**
 * E2EE identity public key registry (issue #11).
 * Only public keys are sent; private keys never leave IndexedDB.
 */

/** @param {string} publicKey Base64URL raw P-256 public key */
export const publishIdentityKey = (publicKey) => {
  return api.put('/api/users/me/identity-key', { publicKey });
};

/** @param {string} userId */
export const fetchIdentityKey = (userId) => {
  return api.get(`/api/users/${encodeURIComponent(userId)}/identity-key`);
};

export const deleteIdentityKey = () => {
  return api.delete('/api/users/me/identity-key');
};
