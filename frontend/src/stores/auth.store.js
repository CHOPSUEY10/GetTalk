import { writable } from 'svelte/store';
import { getSession, login as apiLogin, logout as apiLogout } from '../services/api/auth.api.js';
import { userStore } from './user.store.js';

function createAuthStore() {
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
        const user = response?.user || response;
        
        set({ user, authenticated: true, loading: false, error: null });
        userStore.set(user);
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
    logout: async () => {
      try {
        await apiLogout();
      } catch (error) {
        console.error('Logout failed on the server', error);
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

