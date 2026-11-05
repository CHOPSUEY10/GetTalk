import { writable, get } from 'svelte/store';
import {
  friendLists,
  friendRequestList,
  friendRequest,
  acceptFriendRequests,
  rejectFriendRequests,
  deleteFromFriendList,
} from '../services/api/friends.api.js';
import { searchUsers } from '../services/api/users.api.js';
import { socket } from '../services/socket/client.js';
import * as events from '../services/socket/events.js';
import { ApiError, API_ERROR_CODES, handleApiError } from '../lib/errors/apierror.js';
import { PAGE_ERROR_CODES, resolvePageError } from '../lib/errors/pageerror.js';

export const DEFAULT_FRIENDS_PAGE_LIMIT = 20;
export const DEFAULT_REQUESTS_PAGE_LIMIT = 20;

/**
 * @typedef {Object} FriendsPaginationState
 * @property {number} limit
 * @property {number} offset
 * @property {number} total
 * @property {boolean} hasMore
 * @property {string | null} nextCursor
 */

/**
 * @typedef {Object} RequestsPaginationState
 * @property {number} limit
 * @property {string | null} nextCursor
 * @property {boolean} hasMore
 */

/**
 * @typedef {Object} FriendsState
 * @property {any[]} friends
 * @property {any[]} requests
 * @property {boolean} loading
 * @property {boolean} loadingMoreFriends
 * @property {boolean} loadingMoreRequests
 * @property {FriendsPaginationState} friendsPagination
 * @property {RequestsPaginationState} requestsPagination
 * @property {string | null} error
 * @property {string | null} [errorCode]
 */

/** @type {FriendsState} */
const initialState = {
  friends: [],
  requests: [],
  loading: false,
  loadingMoreFriends: false,
  loadingMoreRequests: false,
  friendsPagination: {
    limit: DEFAULT_FRIENDS_PAGE_LIMIT,
    offset: 0,
    total: 0,
    hasMore: false,
    nextCursor: null,
  },
  requestsPagination: {
    limit: DEFAULT_REQUESTS_PAGE_LIMIT,
    nextCursor: null,
    hasMore: false,
  },
  error: null,
  errorCode: null,
};

function createFriendsStore() {
  const { subscribe, set, update } = writable(initialState);

  /** @type {(() => void) | null} */
  let cleanupListeners = null;

  return {
    subscribe,

    /**
     * Load initial friends list and pending requests from REST API with pagination metadata.
     * @param {{ friendsLimit?: number, requestsLimit?: number }} [options]
     */
    loadAll: async ({
      friendsLimit = DEFAULT_FRIENDS_PAGE_LIMIT,
      requestsLimit = DEFAULT_REQUESTS_PAGE_LIMIT,
    } = {}) => {
      update((s) => ({ ...s, loading: true, error: null, errorCode: null }));
      try {
        const [friendsRes, requestsRes] = await Promise.allSettled([
          friendLists({ limit: friendsLimit, offset: 0 }),
          friendRequestList({ limit: requestsLimit }),
        ]);

        /** @type {any[]} */
        let friends = [];
        /** @type {any[]} */
        let requests = [];
        /** @type {FriendsPaginationState} */
        let friendsPagination = {
          limit: friendsLimit,
          offset: 0,
          total: 0,
          hasMore: false,
          nextCursor: null,
        };
        /** @type {RequestsPaginationState} */
        let requestsPagination = {
          limit: requestsLimit,
          nextCursor: null,
          hasMore: false,
        };

        if (friendsRes.status === 'fulfilled') {
          const data = friendsRes.value;
          friends = Array.isArray(data) ? data : (data?.data || data?.friends || []);
          const pg = data?.pagination || {};
          const nextCursor = pg.nextCursor ?? data?.nextCursor ?? null;
          const total = pg.total ?? friends.length;
          const offset = pg.offset ?? 0;
          const limit = pg.limit ?? friendsLimit;
          const hasMore =
            pg.hasMore !== undefined
              ? Boolean(pg.hasMore)
              : data?.hasMore !== undefined
                ? Boolean(data.hasMore)
                : offset + friends.length < total || Boolean(nextCursor);
          friendsPagination = { limit, offset, total, hasMore, nextCursor };
        }

        if (requestsRes.status === 'fulfilled') {
          const data = requestsRes.value;
          requests = Array.isArray(data) ? data : (data?.data || data?.requests || []);
          const pg = data?.pagination || {};
          const nextCursor = pg.nextCursor ?? data?.nextCursor ?? null;
          const limit = pg.limit ?? requestsLimit;
          const hasMore =
            pg.hasMore !== undefined
              ? Boolean(pg.hasMore)
              : data?.hasMore !== undefined
                ? Boolean(data.hasMore)
                : Boolean(nextCursor);
          requestsPagination = { limit, nextCursor, hasMore };
        }

        if (friendsRes.status === 'rejected' && requestsRes.status === 'rejected') {
          const normalized = handleApiError(friendsRes.reason, {
            endpoint: '/api/friends',
            method: 'GET',
          });
          const pageErr = resolvePageError(normalized, {
            context: 'friends',
            fallbackCode: PAGE_ERROR_CODES.FRIENDS_LOAD_FAILED,
          });
          set({
            ...initialState,
            loading: false,
            error: pageErr.userMessage,
            errorCode: pageErr.code,
          });
          return;
        }

        set({
          friends,
          requests,
          loading: false,
          loadingMoreFriends: false,
          loadingMoreRequests: false,
          friendsPagination,
          requestsPagination,
          error: null,
          errorCode: null,
        });
      } catch (err) {
        const normalized = handleApiError(err, { endpoint: '/api/friends', method: 'GET' });
        const pageErr = resolvePageError(normalized, {
          context: 'friends',
          fallbackCode: PAGE_ERROR_CODES.FRIENDS_LOAD_FAILED,
        });
        update((s) => ({
          ...s,
          loading: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
      }
    },

    /**
     * Load next page of accepted friends using offset pagination.
     * @param {{ limit?: number }} [options]
     * @returns {Promise<any[]>}
     */
    loadMoreFriends: async ({ limit } = {}) => {
      const current = get({ subscribe });
      if (
        current.loading ||
        current.loadingMoreFriends ||
        !current.friendsPagination?.hasMore
      ) {
        return [];
      }

      const pageLimit = limit || current.friendsPagination.limit || DEFAULT_FRIENDS_PAGE_LIMIT;
      const nextOffset = current.friends.length;

      update((s) => ({
        ...s,
        loadingMoreFriends: true,
        error: null,
        errorCode: null,
      }));

      try {
        const data = await friendLists({ limit: pageLimit, offset: nextOffset });
        const incoming = Array.isArray(data) ? data : (data?.data || data?.friends || []);
        const pg = data?.pagination || {};

        /** @type {any[]} */
        let added = [];

        update((s) => {
          const existingIds = new Set(s.friends.map((f) => f.userId || f.id));
          added = incoming.filter((f) => !existingIds.has(f.userId || f.id));
          const merged = [...s.friends, ...added];
          const total = pg.total ?? s.friendsPagination.total ?? merged.length;
          const nextCursor = pg.nextCursor ?? data?.nextCursor ?? null;
          const hasMore =
            pg.hasMore !== undefined
              ? Boolean(pg.hasMore)
              : data?.hasMore !== undefined
                ? Boolean(data.hasMore)
                : merged.length < total;

          return {
            ...s,
            friends: merged,
            loadingMoreFriends: false,
            friendsPagination: {
              limit: pg.limit ?? pageLimit,
              offset: nextOffset,
              total,
              hasMore,
              nextCursor,
            },
          };
        });

        return added;
      } catch (err) {
        const normalized = handleApiError(err, { endpoint: '/api/friends', method: 'GET' });
        const pageErr = resolvePageError(normalized, {
          context: 'friends',
          fallbackCode: PAGE_ERROR_CODES.FRIENDS_LOAD_FAILED,
        });
        update((s) => ({
          ...s,
          loadingMoreFriends: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        return [];
      }
    },

    /**
     * Load next page of pending incoming friend requests using cursor pagination (`before`).
     * @param {{ limit?: number }} [options]
     * @returns {Promise<any[]>}
     */
    loadMoreRequests: async ({ limit } = {}) => {
      const current = get({ subscribe });
      const cursor = current.requestsPagination?.nextCursor;
      if (
        current.loading ||
        current.loadingMoreRequests ||
        !current.requestsPagination?.hasMore ||
        !cursor
      ) {
        return [];
      }

      const pageLimit = limit || current.requestsPagination.limit || DEFAULT_REQUESTS_PAGE_LIMIT;

      update((s) => ({
        ...s,
        loadingMoreRequests: true,
        error: null,
        errorCode: null,
      }));

      try {
        const data = await friendRequestList({ limit: pageLimit, before: cursor });
        const incoming = Array.isArray(data) ? data : (data?.data || data?.requests || []);
        const pg = data?.pagination || {};
        const nextCursor = pg.nextCursor ?? data?.nextCursor ?? null;
        const hasMore =
          pg.hasMore !== undefined
            ? Boolean(pg.hasMore)
            : data?.hasMore !== undefined
              ? Boolean(data.hasMore)
              : Boolean(nextCursor);

        /** @type {any[]} */
        let added = [];

        update((s) => {
          const existingIds = new Set(s.requests.map((r) => r.id || r.requestId));
          added = incoming.filter((r) => !existingIds.has(r.id || r.requestId));
          const merged = [...s.requests, ...added];

          return {
            ...s,
            requests: merged,
            loadingMoreRequests: false,
            requestsPagination: {
              limit: pg.limit ?? pageLimit,
              nextCursor,
              hasMore,
            },
          };
        });

        return added;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/friends/requests',
          method: 'GET',
        });
        const pageErr = resolvePageError(normalized, {
          context: 'friends',
          fallbackCode: PAGE_ERROR_CODES.FRIENDS_LOAD_FAILED,
        });
        update((s) => ({
          ...s,
          loadingMoreRequests: false,
          error: pageErr.userMessage,
          errorCode: pageErr.code,
        }));
        return [];
      }
    },

    /**
     * Send a friend request.
     *
     * The UI collects a username; the API contract requires a userId, so
     * resolve the exact username first (usernames are unique).
     *
     * @param {{ userId?: string, username?: string }} payload
     */
    sendRequest: async (payload) => {
      let userId = payload?.userId;
      const username = payload?.username?.trim();

      if (!userId && username) {
        const res = await searchUsers(username, { limit: 10, offset: 0 });
        const users = Array.isArray(res) ? res : (res?.data || res?.users || []);
        const match = users.find(
          (u) => u.username?.toLowerCase() === username.toLowerCase()
        );

        if (!match) {
          throw new ApiError({
            code: API_ERROR_CODES.USER_NOT_FOUND,
            status: 404,
            message: 'User not found',
            endpoint: '/api/users/search',
            method: 'GET',
            logged: true,
          });
        }

        userId = match.id;
      }

      if (!userId) {
        throw new ApiError({
          code: API_ERROR_CODES.VALIDATION_ERROR,
          status: 400,
          message: 'userId or username is required',
          endpoint: '/api/friends/requests',
          method: 'POST',
          logged: true,
        });
      }

      return friendRequest({ userId });
    },

    /**
     * Accept a friend request.
     * @param {string} requestId
     */
    accept: async (requestId) => {
      const result = await acceptFriendRequests(requestId);
      const friend = result?.friend || result;

      // Optimistically move the request from requests → friends
      update((s) => ({
        ...s,
        requests: s.requests.filter(
          (r) => r.id !== requestId && r.requestId !== requestId
        ),
        friends: friend
          ? [...s.friends, friend]
          : s.friends,
        friendsPagination: {
          ...s.friendsPagination,
          total: (s.friendsPagination?.total || s.friends.length) + (friend ? 1 : 0),
        },
      }));

      return result;
    },

    /**
     * Reject a friend request.
     * @param {string} requestId
     */
    reject: async (requestId) => {
      await rejectFriendRequests(requestId);

      update((s) => ({
        ...s,
        requests: s.requests.filter(
          (r) => r.id !== requestId && r.requestId !== requestId
        ),
      }));
    },

    /**
     * Remove a friend.
     * @param {string} friendUserId
     */
    remove: async (friendUserId) => {
      await deleteFromFriendList(friendUserId);

      update((s) => ({
        ...s,
        friends: s.friends.filter(
          (f) => f.userId !== friendUserId && f.id !== friendUserId
        ),
        friendsPagination: {
          ...s.friendsPagination,
          total: Math.max(0, (s.friendsPagination?.total || s.friends.length) - 1),
        },
      }));
    },

    /**
     * Register socket listeners for real-time friend events.
     * Call this once after socket connects. Returns cleanup function.
     * @returns {() => void}
     */
    initSocketListeners: () => {
      // Prevent double-registration
      if (cleanupListeners) {
        cleanupListeners();
      }

      /** @param {{ request: any }} payload */
      const onFriendRequest = (payload) => {
        if (!payload?.request) return;
        update((s) => {
          // Avoid duplicates
          const exists = s.requests.some(
            (r) => r.id === payload.request.id
          );
          if (exists) return s;
          return {
            ...s,
            requests: [payload.request, ...s.requests],
          };
        });
      };

      /** @param {{ friend: any, requestId?: string }} payload */
      const onFriendAccepted = (payload) => {
        if (!payload?.friend) return;
        update((s) => {
          // Add to friends list (avoid duplicates)
          const exists = s.friends.some(
            (f) =>
              f.userId === payload.friend.userId ||
              f.id === payload.friend.userId
          );
          // Remove the corresponding request if requestId is provided
          const filteredRequests = payload.requestId
            ? s.requests.filter((r) => r.id !== payload.requestId)
            : s.requests;

          return {
            ...s,
            friends: exists ? s.friends : [...s.friends, payload.friend],
            requests: filteredRequests,
            friendsPagination: {
              ...s.friendsPagination,
              total: exists
                ? s.friendsPagination.total
                : (s.friendsPagination?.total || s.friends.length) + 1,
            },
          };
        });
      };

      socket.on(events.FRIEND_REQUEST, onFriendRequest);
      socket.on(events.FRIEND_ACCEPTED, onFriendAccepted);

      cleanupListeners = () => {
        socket.off(events.FRIEND_REQUEST, onFriendRequest);
        socket.off(events.FRIEND_ACCEPTED, onFriendAccepted);
        cleanupListeners = null;
      };

      return cleanupListeners;
    },

    /**
     * Reset to initial state.
     */
    reset: () => {
      if (cleanupListeners) {
        cleanupListeners();
      }
      set(initialState);
    },
  };
}

export const friendsStore = createFriendsStore();
