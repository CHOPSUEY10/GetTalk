import { writable } from 'svelte/store';
import {
  getSession,
  login as apiLogin,
  logout as apiLogout,
  verifyMfa as apiVerifyMfa,
} from '../services/api/auth.api.js';
import { publishOwnIdentityKey } from '../services/crypto/identity-trust.js';
import { userStore } from './user.store.js';
import logger from '../lib/logger.js';

/**
 * Publish the E2EE identity public key once the session is known.
 * Failure is non-fatal: the key registry may be temporarily unavailable.
 * @param {any} user
 */
function publishIdentityKey(user) {
  if (!user?.id) return;
  publishOwnIdentityKey(user.id).catch((err) => {
    logger.error('Failed to publish E2EE identity key', err);
  });
}

/**
 * @typedef {Object} User
 * @property {string} [id]
 * @property {string} [username]
 * @property {string} [email]
 * @property {string} [name]
 * @property {Record<string, any>} [profile]
 */

/**
 * @typedef {Object} AuthState
 * @property {User | any} user
 * @property {boolean} authenticated
 * @property {boolean} loading
 * @property {string | null} error
 */

function createAuthStore() {
  /** @type {import('svelte/store').Writable<AuthState>} */
  const { subscribe, set, update } = writable({
    user: null,
    authenticated: false,
    loading: true,
    error: null,
  });

  return {
    subscribe,
    initialize: async () => {
      update(state => ({ ...state, loading: true, error: null }));
      try {
        const response = await getSession();
        const user = response?.user || response;
        
        set({ user, authenticated: true, loading: false, error: null });
        userStore.set(user);
        publishIdentityKey(user);
      } catch (err) {
        const error = /** @type {any} */ (err);
        // Only treat as error if it's a server/network error, not a standard unauthenticated response
        // Usually 401 means unauthenticated, while others might be actual errors.
        const isAuthFailure = error.status === 401 || error.status === 403;
        const errorMessage = isAuthFailure ? null : error.message;

        set({ 
          user: null, 
          authenticated: false, 
          loading: false, 
          error: errorMessage 
        });
        userStore.set(null);
      }
    },
    /** @param {any} payload */
    login: async (payload) => {
      update(state => ({ ...state, loading: true, error: null }));
      try {
        const response = await apiLogin(payload);
        if (response?.mfaRequired) {
          set({ user: null, authenticated: false, loading: false, error: null });
          userStore.set(null);
          return response;
        }
        const user = response?.user || response;
        
        set({ user, authenticated: true, loading: false, error: null });
        userStore.set(user);
        publishIdentityKey(user);
        return response;
      } catch (err) {
        const error = /** @type {any} */ (err);
        set({ 
          user: null, 
          authenticated: false, 
          loading: false, 
          error: error.message 
        });
        userStore.set(null);
        throw error;
      }
    },
    /** @param {{ challengeId: string, code: string }} payload */
    verifyMfa: async (payload) => {
      update(state => ({ ...state, loading: true, error: null }));
      try {
        const response = await apiVerifyMfa(payload);
        const user = response?.user || response;
        set({ user, authenticated: true, loading: false, error: null });
        userStore.set(user);
        publishIdentityKey(user);
        return response;
      } catch (err) {
        const error = /** @type {any} */ (err);
        set({
          user: null,
          authenticated: false,
          loading: false,
          error: error.message,
        });
        userStore.set(null);
        throw error;
      }
    },
    logout: async () => {
      try {
        await apiLogout();
      } catch (error) {
        logger.error('Logout failed on the server', error);
      } finally {
        set({ user: null, authenticated: false, loading: false, error: null });
        userStore.set(null);
      }
    },
    /** @param {any} userData */
    updateUser: (userData) => {
      update(state => ({ ...state, user: userData }));
      userStore.set(userData);
    },
    setUnauthenticated: () => {
      set({ user: null, authenticated: false, loading: false, error: null });
      userStore.set(null);
    }
  };
}

export const authStore = createAuthStore();
