import { writable } from 'svelte/store';
import {
  getSession,
  register as apiRegister,
  login as apiLogin,
  logout as apiLogout,
  verifyMfa as apiVerifyMfa,
  getMfaStatus as apiGetMfaStatus,
  setupMfa as apiSetupMfa,
  enableMfa as apiEnableMfa,
  disableMfa as apiDisableMfa,
  forgotPassword as apiForgotPassword,
  resetPassword as apiResetPassword,
} from '../services/api/auth.api.js';
import { publishOwnIdentityKey } from '../services/crypto/identity-trust.js';
import { userStore } from './user.store.js';
import { API_ERROR_CODES, handleApiError, normalizeApiError } from '../lib/errors/apierror.js';
import { handleEncryptionError } from '../lib/errors/encryptionerror.js';
import { PAGE_ERROR_CODES, resolvePageError } from '../lib/errors/pageerror.js';

/**
 * Publish the E2EE identity public key once the session is known.
 * Failure is non-fatal: the key registry may be temporarily unavailable.
 * @param {any} user
 */
function publishIdentityKey(user) {
  if (!user?.id) return;
  publishOwnIdentityKey(user.id).catch((err) => {
    handleEncryptionError(err, { operation: 'publish-identity-key' });
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
 * @property {string | null} [errorCode]
 */

function createAuthStore() {
  /** @type {import('svelte/store').Writable<AuthState>} */
  const { subscribe, set, update } = writable({
    user: null,
    authenticated: false,
    loading: true,
    error: null,
    errorCode: null,
  });

  return {
    subscribe,
    initialize: async () => {
      update((state) => ({ ...state, loading: true, error: null, errorCode: null }));
      try {
        const response = await getSession();
        const user = response?.user || response;

        set({ user, authenticated: true, loading: false, error: null, errorCode: null });
        userStore.set(user);
        publishIdentityKey(user);
      } catch (err) {
        normalizeApiError(err);
        // Ketika user pertama kali membuka aplikasi / login dan belum memiliki session token,
        // jangan tampilkan PAGE_ERROR_CODES.NETWORK_ERROR atau error sesi awal pada UI login.
        set({
          user: null,
          authenticated: false,
          loading: false,
          error: null,
          errorCode: null,
        });
        userStore.set(null);
      }
    },
    clearError: () => {
      update((state) => ({ ...state, error: null, errorCode: null }));
    },
    /** @param {{ username: string, email: string, password: string }} payload */
    register: async (payload) => {
      update((state) => ({ ...state, error: null, errorCode: null }));
      try {
        return await apiRegister(payload);
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/auth/register',
          method: 'POST',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'register',
          fallbackCode: PAGE_ERROR_CODES.VALIDATION_ERROR,
        });
        update((state) => ({
          ...state,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },
    /** @param {any} payload */
    login: async (payload) => {
      // NOTE: Do NOT set loading:true here. The global `loading` flag controls
      // the splash-screen vs Router toggle in App.svelte.
      update((state) => ({ ...state, error: null, errorCode: null }));
      try {
        const response = await apiLogin(payload);
        if (response?.mfaRequired) {
          update((state) => ({
            ...state,
            user: null,
            authenticated: false,
            error: null,
            errorCode: null,
          }));
          userStore.set(null);
          return response;
        }
        const user = response?.user || response;

        set({ user, authenticated: true, loading: false, error: null, errorCode: null });
        userStore.set(user);
        publishIdentityKey(user);
        return response;
      } catch (err) {
        const normalized = handleApiError(err, { endpoint: '/api/auth/login', method: 'POST' });
        const pageErr = resolvePageError(normalized, {
          context: 'login',
          fallbackCode: PAGE_ERROR_CODES.INVALID_CREDENTIALS,
        });
        update((state) => ({
          ...state,
          user: null,
          authenticated: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        userStore.set(null);
        throw normalized;
      }
    },
    /** @param {{ challengeId: string, code: string }} payload */
    verifyMfa: async (payload) => {
      // Same as login: avoid toggling the global loading flag.
      update((state) => ({ ...state, error: null, errorCode: null }));
      try {
        const response = await apiVerifyMfa(payload);
        const user = response?.user || response;
        set({ user, authenticated: true, loading: false, error: null, errorCode: null });
        userStore.set(user);
        publishIdentityKey(user);
        return response;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/auth/mfa/verify',
          method: 'POST',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'mfa',
          fallbackCode: PAGE_ERROR_CODES.INVALID_MFA_CODE,
        });
        update((state) => ({
          ...state,
          user: null,
          authenticated: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        userStore.set(null);
        throw normalized;
      }
    },
    getMfaStatus: async () => {
      try {
        return await apiGetMfaStatus();
      } catch (err) {
        throw handleApiError(err, {
          endpoint: '/api/auth/mfa/status',
          method: 'GET',
        });
      }
    },
    /** @param {{ password: string }} payload */
    setupMfa: async (payload) => {
      try {
        return await apiSetupMfa(payload);
      } catch (err) {
        throw handleApiError(err, {
          endpoint: '/api/auth/mfa/setup',
          method: 'POST',
        });
      }
    },
    /** @param {{ code: string }} payload */
    enableMfa: async (payload) => {
      try {
        const result = await apiEnableMfa(payload);
        update((state) => {
          const updatedUser = state.user ? { ...state.user, mfaEnabled: true } : state.user;
          userStore.set(updatedUser);
          return { ...state, user: updatedUser };
        });
        return result;
      } catch (err) {
        throw handleApiError(err, {
          endpoint: '/api/auth/mfa/enable',
          method: 'POST',
        });
      }
    },
    /** @param {{ password: string, code: string }} payload */
    disableMfa: async (payload) => {
      try {
        const result = await apiDisableMfa(payload);
        update((state) => {
          const updatedUser = state.user ? { ...state.user, mfaEnabled: false } : state.user;
          userStore.set(updatedUser);
          return { ...state, user: updatedUser };
        });
        return result;
      } catch (err) {
        throw handleApiError(err, {
          endpoint: '/api/auth/mfa',
          method: 'DELETE',
        });
      }
    },
    logout: async () => {
      try {
        await apiLogout();
      } catch (error) {
        handleApiError(error, { endpoint: '/api/auth/logout', method: 'POST' });
      } finally {
        set({ user: null, authenticated: false, loading: false, error: null, errorCode: null });
        userStore.set(null);
      }
    },
    /** @param {any} userData */
    updateUser: (userData) => {
      update((state) => ({ ...state, user: userData }));
      userStore.set(userData);
    },
    setUnauthenticated: () => {
      set({ user: null, authenticated: false, loading: false, error: null, errorCode: null });
      userStore.set(null);
    },
    /** @param {{ email: string }} payload */
    forgotPassword: async (payload) => {
      // Avoid setting global `loading: true` which would unmount the Router in App.svelte
      update((state) => ({ ...state, loading: false, error: null, errorCode: null }));
      try {
        const response = await apiForgotPassword(payload);
        return response;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/auth/password/forgot',
          method: 'POST',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'forgot-password',
          fallbackCode: PAGE_ERROR_CODES.OTP_SEND_FAILED,
        });
        update((state) => ({
          ...state,
          loading: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },
    /** @param {{ email: string, token: string, password?: string, newPassword?: string }} payload */
    resetPassword: async (payload) => {
      update((state) => ({ ...state, loading: false, error: null, errorCode: null }));
      try {
        const resolvedPassword = payload.newPassword ?? payload.password;
        const response = await apiResetPassword({
          email: payload.email,
          token: payload.token,
          newPassword: resolvedPassword,
          password: resolvedPassword,
        });
        return response;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/auth/password/reset',
          method: 'POST',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'reset-password',
          fallbackCode: PAGE_ERROR_CODES.INVALID_RESET_TOKEN,
        });
        update((state) => ({
          ...state,
          loading: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },
  };
}

export const authStore = createAuthStore();
