import { writable } from 'svelte/store';
import type { AdminUser } from '../lib/types/telemetry.ts';
import {
  enableAdminMfa,
  getAdminSession,
  loginAdmin,
  logoutAdmin,
  setupAdminMfa,
  verifyAdminMfa,
} from '../services/api/auth.api.ts';

export interface AuthState {
  user: AdminUser | null;
  authenticated: boolean;
  loading: boolean;
  mfaRequired: boolean;
  challengeId: string | null;
  error: string | null;
  errorCode: string | null;
}

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>({
    user: null,
    authenticated: false,
    loading: true,
    mfaRequired: false,
    challengeId: null,
    error: null,
    errorCode: null,
  });

  return {
    subscribe,
    initialize: async () => {
      update((s) => ({ ...s, loading: true, error: null, errorCode: null }));
      try {
        const res = await getAdminSession();
        set({
          user: res.user,
          authenticated: true,
          loading: false,
          mfaRequired: false,
          challengeId: null,
          error: null,
          errorCode: null,
        });
      } catch {
        set({
          user: null,
          authenticated: false,
          loading: false,
          mfaRequired: false,
          challengeId: null,
          error: null,
          errorCode: null,
        });
      }
    },
    login: async (username: string, password: string) => {
      update((s) => ({ ...s, error: null, errorCode: null }));
      try {
        const res = await loginAdmin({ username, password });
        if (res.mfaRequired && res.challengeId) {
          update((s) => ({
            ...s,
            mfaRequired: true,
            challengeId: res.challengeId || null,
            authenticated: false,
            user: null,
          }));
          return res;
        }
        set({
          user: res.user || null,
          authenticated: Boolean(res.user),
          loading: false,
          mfaRequired: false,
          challengeId: null,
          error: null,
          errorCode: null,
        });
        return res;
      } catch (err: any) {
        update((s) => ({
          ...s,
          error: err?.message || 'Login failed',
          errorCode: err?.code || 'UNAUTHORIZED',
        }));
        throw err;
      }
    },
    verifyMfa: async (challengeId: string, code: string) => {
      update((s) => ({ ...s, error: null, errorCode: null }));
      try {
        const res = await verifyAdminMfa({ challengeId, code });
        set({
          user: res.user,
          authenticated: true,
          loading: false,
          mfaRequired: false,
          challengeId: null,
          error: null,
          errorCode: null,
        });
        return res;
      } catch (err: any) {
        update((s) => ({
          ...s,
          error: err?.message || 'MFA verification failed',
          errorCode: err?.code || 'INVALID_MFA_CODE',
        }));
        throw err;
      }
    },
    setupMfa: () => setupAdminMfa(),
    enableMfa: async (code: string) => {
      const res = await enableAdminMfa(code);
      update((s) => ({
        ...s,
        user: s.user ? { ...s.user, mfaEnabled: true } : null,
      }));
      return res;
    },
    logout: async () => {
      try {
        await logoutAdmin();
      } catch {
        // Ignore logout network error
      } finally {
        set({
          user: null,
          authenticated: false,
          loading: false,
          mfaRequired: false,
          challengeId: null,
          error: null,
          errorCode: null,
        });
      }
    },
    setUnauthenticated: () => {
      set({
        user: null,
        authenticated: false,
        loading: false,
        mfaRequired: false,
        challengeId: null,
        error: null,
        errorCode: null,
      });
    },
  };
}

export const authStore = createAuthStore();
export default authStore;

