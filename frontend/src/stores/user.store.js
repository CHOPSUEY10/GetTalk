import { writable, get } from 'svelte/store';
import {
  getCurrentUser as apiGetCurrentUser,
  searchUsers as apiSearchUsers,
  updateProfile as apiUpdateProfile,
  getPrivacySettings as apiGetPrivacySettings,
  updatePrivacySettings as apiUpdatePrivacySettings,
  getBlockedUsers as apiGetBlockedUsers,
  blockUser as apiBlockUser,
  unblockUser as apiUnblockUser,
} from '../services/api/users.api.js';
import {
  getOwnIdentityFingerprint,
  getAppLockConfig,
  setAppPasscode,
  verifyAppPasscode,
  disableAppPasscode,
} from '../services/crypto/identity-trust.js';
import { handleApiError } from '../lib/errors/apierror.js';
import {
  PAGE_ERROR_CODES,
  resolvePageError,
  createValidationError,
} from '../lib/errors/pageerror.js';
import {
  validateProfileInput,
  validatePasscodeInput,
} from '../lib/validators.js';

export const DEFAULT_PRIVACY_SETTINGS = Object.freeze({
  lastSeenVisibility: 'everyone',
  onlineVisibility: 'everyone',
  readReceiptsEnabled: true,
  typingIndicatorEnabled: true,
  whoCanMessage: 'everyone',
  whoCanAddToGroups: 'everyone',
  defaultDisappearingTimer: 0,
  securityChangeNotifications: true,
});

function createInitialState() {
  return {
    id: null,
    username: null,
    email: null,
    nickname: null,
    bio: null,
    lastSeenAt: null,
    mfaEnabled: false,
    remainingRecoveryCodesCount: 0,
    pendingEmail: null,
    profile: null,
    privacySettings: { ...DEFAULT_PRIVACY_SETTINGS },
    blockedUsers: [],
    blockedTotal: 0,
    blockedHasMore: false,
    blockedNextOffset: 0,
    blockedLimit: 20,
    identityKey: null,
    appLock: {
      enabled: false,
      autoLockMinutes: 5,
      locked: false,
      updatedAt: null,
    },
    loadingProfile: false,
    savingProfile: false,
    loadingPrivacy: false,
    savingPrivacy: false,
    loadingBlocked: false,
    loadingMoreBlocked: false,
    loadingIdentityKey: false,
    error: null,
    errorCode: null,
  };
}

function createUserStore() {
  const internalStore = writable(createInitialState());
  const { subscribe, update, set: rawSet } = internalStore;

  function applyUserPayload(userData) {
    if (!userData) {
      rawSet(createInitialState());
      return;
    }

    update((state) => {
      const mergedProfile = {
        ...(state.profile || {}),
        ...userData,
      };
      const nextPrivacy = userData.privacySettings
        ? { ...state.privacySettings, ...userData.privacySettings }
        : state.privacySettings;
      const appLockCfg = userData.id ? getAppLockConfig(userData.id) : state.appLock;

      return {
        ...state,
        id: mergedProfile.id ?? state.id,
        username: mergedProfile.username ?? state.username,
        email: mergedProfile.email ?? state.email,
        nickname: mergedProfile.nickname ?? null,
        bio: mergedProfile.bio ?? null,
        lastSeenAt: mergedProfile.lastSeenAt ?? state.lastSeenAt,
        mfaEnabled: Boolean(mergedProfile.mfaEnabled ?? state.mfaEnabled),
        remainingRecoveryCodesCount:
          typeof mergedProfile.remainingRecoveryCodesCount === 'number'
            ? mergedProfile.remainingRecoveryCodesCount
            : state.remainingRecoveryCodesCount,
        pendingEmail: mergedProfile.pendingEmail ?? state.pendingEmail,
        profile: mergedProfile,
        privacySettings: nextPrivacy,
        appLock: {
          ...state.appLock,
          ...appLockCfg,
        },
      };
    });
  }

  return {
    subscribe,
    set: (value) => {
      applyUserPayload(value);
    },
    update,
    reset: () => {
      rawSet(createInitialState());
    },
    clearUser: () => {
      rawSet(createInitialState());
    },
    clearError: () => {
      update((s) => ({ ...s, error: null, errorCode: null }));
    },

    searchUsers: async (query, params = {}) => {
      try {
        return await apiSearchUsers(query, params);
      } catch (err) {
        throw handleApiError(err, {
          endpoint: '/api/users/search',
          method: 'GET',
        });
      }
    },

    loadProfile: async () => {
      update((s) => ({ ...s, loadingProfile: true, error: null, errorCode: null }));
      try {
        const res = await apiGetCurrentUser();
        const user = res?.user || res;
        applyUserPayload(user);
        update((s) => ({ ...s, loadingProfile: false }));
        return user;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/users/me',
          method: 'GET',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'profile',
          fallbackCode: PAGE_ERROR_CODES.PROFILE_LOAD_FAILED,
        });
        update((s) => ({
          ...s,
          loadingProfile: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },

    /**
     * @param {{ username?: string, nickname?: string | null, bio?: string | null }} payload
     */
    updateProfile: async (payload) => {
      const validation = validateProfileInput(payload);
      if (!validation.valid) {
        const valErr = createValidationError(validation.code, 'profile');
        update((s) => ({
          ...s,
          error: valErr.userMessage,
          errorCode: valErr.code,
        }));
        throw valErr;
      }

      update((s) => ({ ...s, savingProfile: true, error: null, errorCode: null }));
      try {
        const res = await apiUpdateProfile(payload);
        const user = res?.user || res;
        applyUserPayload(user);
        update((s) => ({ ...s, savingProfile: false }));
        return user;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/users/me/profile',
          method: 'PATCH',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'profile',
          fallbackCode: PAGE_ERROR_CODES.PROFILE_UPDATE_FAILED,
        });
        update((s) => ({
          ...s,
          savingProfile: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },

    loadPrivacySettings: async () => {
      update((s) => ({ ...s, loadingPrivacy: true, error: null, errorCode: null }));
      try {
        const res = await apiGetPrivacySettings();
        const privacy = res?.privacy || res;
        update((s) => ({
          ...s,
          loadingPrivacy: false,
          privacySettings: {
            ...DEFAULT_PRIVACY_SETTINGS,
            ...privacy,
          },
        }));
        return privacy;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/users/me/privacy',
          method: 'GET',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'privacy',
          fallbackCode: PAGE_ERROR_CODES.PRIVACY_LOAD_FAILED,
        });
        update((s) => ({
          ...s,
          loadingPrivacy: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },

    /**
     * @param {Partial<typeof DEFAULT_PRIVACY_SETTINGS>} patch
     */
    updatePrivacySettings: async (patch) => {
      update((s) => ({ ...s, savingPrivacy: true, error: null, errorCode: null }));
      try {
        const res = await apiUpdatePrivacySettings(patch);
        const privacy = res?.privacy || res;
        update((s) => ({
          ...s,
          savingPrivacy: false,
          privacySettings: {
            ...s.privacySettings,
            ...privacy,
          },
        }));
        return privacy;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/users/me/privacy',
          method: 'PATCH',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'privacy',
          fallbackCode: PAGE_ERROR_CODES.PRIVACY_UPDATE_FAILED,
        });
        update((s) => ({
          ...s,
          savingPrivacy: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },

    loadBlockedUsers: async ({ limit = 20, offset = 0 } = {}) => {
      update((s) => ({ ...s, loadingBlocked: true, error: null, errorCode: null }));
      try {
        const res = await apiGetBlockedUsers({ limit, offset });
        const items = res?.blockedUsers || res?.items || res?.data || [];
        const pagination = res?.pagination || {};
        const total = pagination.total ?? res?.total ?? items.length;
        const hasMore = Boolean(pagination.hasMore ?? res?.hasMore ?? offset + items.length < total);

        update((s) => ({
          ...s,
          loadingBlocked: false,
          blockedUsers: items,
          blockedTotal: total,
          blockedHasMore: hasMore,
          blockedNextOffset: offset + items.length,
          blockedLimit: limit,
        }));
        return items;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/users/me/blocked',
          method: 'GET',
        });
        const pageErr = resolvePageError(normalized, {
          fallbackCode: PAGE_ERROR_CODES.BLOCKED_USERS_LOAD_FAILED,
        });
        update((s) => ({
          ...s,
          loadingBlocked: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },

    loadMoreBlockedUsers: async () => {
      const current = get(internalStore);
      if (current.loadingBlocked || current.loadingMoreBlocked || !current.blockedHasMore) {
        return [];
      }

      update((s) => ({ ...s, loadingMoreBlocked: true, error: null, errorCode: null }));
      try {
        const res = await apiGetBlockedUsers({
          limit: current.blockedLimit || 20,
          offset: current.blockedNextOffset || current.blockedUsers.length,
        });
        const items = res?.blockedUsers || res?.items || res?.data || [];
        const pagination = res?.pagination || {};
        const total = pagination.total ?? res?.total ?? current.blockedTotal;

        update((s) => {
          const existingIds = new Set(s.blockedUsers.map((u) => u.userId || u.id));
          const deduped = items.filter((u) => !existingIds.has(u.userId || u.id));
          const combined = [...s.blockedUsers, ...deduped];
          const nextOffset = (s.blockedNextOffset || 0) + items.length;
          const hasMore = Boolean(pagination.hasMore ?? res?.hasMore ?? nextOffset < total);

          return {
            ...s,
            loadingMoreBlocked: false,
            blockedUsers: combined,
            blockedTotal: total,
            blockedHasMore: hasMore,
            blockedNextOffset: nextOffset,
          };
        });
        return items;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/users/me/blocked',
          method: 'GET',
        });
        const pageErr = resolvePageError(normalized, {
          fallbackCode: PAGE_ERROR_CODES.BLOCKED_USERS_LOAD_FAILED,
        });
        update((s) => ({
          ...s,
          loadingMoreBlocked: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },

    blockUser: async (userId) => {
      update((s) => ({ ...s, error: null, errorCode: null }));
      try {
        const res = await apiBlockUser(userId);
        const blockedUser = res?.user;
        if (blockedUser) {
          update((s) => {
            const exists = s.blockedUsers.some((u) => (u.userId || u.id) === (blockedUser.userId || blockedUser.id));
            const nextList = exists ? s.blockedUsers : [blockedUser, ...s.blockedUsers];
            return {
              ...s,
              blockedUsers: nextList,
              blockedTotal: exists ? s.blockedTotal : s.blockedTotal + 1,
            };
          });
        }
        return res;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: `/api/users/${userId}/block`,
          method: 'POST',
        });
        const pageErr = resolvePageError(normalized, {
          fallbackCode: PAGE_ERROR_CODES.USER_BLOCK_FAILED,
        });
        update((s) => ({
          ...s,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },

    unblockUser: async (userId) => {
      update((s) => ({ ...s, error: null, errorCode: null }));
      try {
        const res = await apiUnblockUser(userId);
        update((s) => {
          const nextList = s.blockedUsers.filter((u) => (u.userId || u.id) !== userId);
          return {
            ...s,
            blockedUsers: nextList,
            blockedTotal: Math.max(0, s.blockedTotal - 1),
          };
        });
        return res;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: `/api/users/${userId}/block`,
          method: 'DELETE',
        });
        const pageErr = resolvePageError(normalized, {
          fallbackCode: PAGE_ERROR_CODES.USER_UNBLOCK_FAILED,
        });
        update((s) => ({
          ...s,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        throw normalized;
      }
    },

    loadOwnIdentityKey: async (userId) => {
      const targetUserId = userId || get(internalStore).id;
      if (!targetUserId) return null;

      update((s) => ({ ...s, loadingIdentityKey: true }));
      try {
        const info = await getOwnIdentityFingerprint(targetUserId);
        update((s) => ({
          ...s,
          loadingIdentityKey: false,
          identityKey: info,
        }));
        return info;
      } catch {
        update((s) => ({ ...s, loadingIdentityKey: false }));
        return null;
      }
    },

    setupAppLock: async (passcode, autoLockMinutes = 5) => {
      const validation = validatePasscodeInput(passcode);
      if (!validation.valid) {
        const valErr = createValidationError(validation.code);
        update((s) => ({ ...s, error: valErr.userMessage, errorCode: valErr.code }));
        throw valErr;
      }

      const currentUserId = get(internalStore).id || 'default';
      const cfg = await setAppPasscode(currentUserId, passcode, autoLockMinutes);
      update((s) => ({
        ...s,
        appLock: {
          ...cfg,
          locked: false,
        },
        error: null,
        errorCode: null,
      }));
      return cfg;
    },

    verifyAppLock: async (passcode) => {
      const currentUserId = get(internalStore).id || 'default';
      const ok = await verifyAppPasscode(currentUserId, passcode);
      if (!ok) {
        const valErr = createValidationError(PAGE_ERROR_CODES.PASSCODE_INCORRECT);
        update((s) => ({ ...s, error: valErr.userMessage, errorCode: valErr.code }));
        return false;
      }
      update((s) => ({
        ...s,
        appLock: { ...s.appLock, locked: false },
        error: null,
        errorCode: null,
      }));
      return true;
    },

    disableAppLock: async (passcode) => {
      const currentUserId = get(internalStore).id || 'default';
      const ok = await disableAppPasscode(currentUserId, passcode);
      if (!ok) {
        const valErr = createValidationError(PAGE_ERROR_CODES.PASSCODE_INCORRECT);
        update((s) => ({ ...s, error: valErr.userMessage, errorCode: valErr.code }));
        throw valErr;
      }
      update((s) => ({
        ...s,
        appLock: {
          enabled: false,
          autoLockMinutes: 5,
          locked: false,
          updatedAt: null,
        },
        error: null,
        errorCode: null,
      }));
      return true;
    },

    lockAppNow: () => {
      update((s) => {
        if (!s.appLock.enabled) return s;
        return {
          ...s,
          appLock: { ...s.appLock, locked: true },
        };
      });
    },
  };
}

export const userStore = createUserStore();
