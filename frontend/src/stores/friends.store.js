import { writable, get } from 'svelte/store';
import {
  friendLists,
  friendRequestList,
  friendRequest,
  acceptFriendRequests,
  rejectFriendRequests,
  deleteFromFriendList,
} from '../services/api/friends.api.js';
import { socket } from '../services/socket/client.js';
import * as events from '../services/socket/events.js';

/**
 * @typedef {Object} FriendsState
 * @property {any[]} friends
 * @property {any[]} requests
 * @property {boolean} loading
 * @property {string | null} error
 */

/** @type {FriendsState} */
const initialState = {
  friends: [],
  requests: [],
  loading: false,
  error: null,
};

function createFriendsStore() {
  const { subscribe, set, update } = writable(initialState);

  /** @type {(() => void) | null} */
  let cleanupListeners = null;

  return {
    subscribe,

    /**
     * Load friends list and pending requests from REST API.
     */
    loadAll: async () => {
      update((s) => ({ ...s, loading: true, error: null }));
      try {
        const [friendsRes, requestsRes] = await Promise.allSettled([
          friendLists(),
          friendRequestList(),
        ]);

        /** @type {any[]} */
        let friends = [];
        /** @type {any[]} */
        let requests = [];

        if (friendsRes.status === 'fulfilled') {
          const data = friendsRes.value;
          friends = Array.isArray(data) ? data : data?.friends || [];
        }
        if (requestsRes.status === 'fulfilled') {
          const data = requestsRes.value;
          requests = Array.isArray(data) ? data : data?.requests || [];
        }

        set({ friends, requests, loading: false, error: null });
      } catch (err) {
        const e = /** @type {any} */ (err);
        update((s) => ({
          ...s,
          loading: false,
          error: e.message || 'Failed to load friends data',
        }));
      }
    },

    /**
     * Send a friend request.
     * @param {{ userId?: string, username?: string }} payload
     */
    sendRequest: async (payload) => {
      const result = await friendRequest(payload);
      return result;
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
