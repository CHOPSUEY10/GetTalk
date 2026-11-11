import { writable } from 'svelte/store';

/**
 * @typedef {'info' | 'success' | 'warning' | 'error'} NotificationType
 */

/**
 * @typedef {Object} UINotification
 * @property {string} id
 * @property {NotificationType} type
 * @property {string} message
 * @property {number} timeout
 */

/**
 * @typedef {Object} UIModal
 * @property {string} id
 * @property {string} [title]
 * @property {string} [message]
 * @property {Record<string, any>} [props]
 */

/**
 * @typedef {Object} UIState
 * @property {UINotification[]} notifications
 * @property {UIModal | null} activeModal
 * @property {boolean} sidebarOpen
 */

/** @type {Set<NotificationType>} */
const VALID_TYPES = new Set(['info', 'success', 'warning', 'error']);

const DEFAULT_TIMEOUT_MS = 4000;

/** @type {UIState} */
const initialState = {
  notifications: [],
  activeModal: null,
  sidebarOpen: false,
};

/**
 * Separate reactive store for color theme ('light' | 'dark') so `get(uiStore)`
 * preserves its exact contract while supporting centralized dark/light mode.
 */
function createThemeStore() {
  const initialTheme =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light';
  const { subscribe, set, update } = writable(initialTheme);

  /** @param {'light' | 'dark'} next */
  const applyTheme = (next) => {
    const resolved = next === 'dark' ? 'dark' : 'light';
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', resolved);
    }
    set(resolved);
    return resolved;
  };

  return {
    subscribe,
    setTheme: applyTheme,
    toggleTheme: () => {
      let next = 'light';
      update((curr) => {
        next = curr === 'dark' ? 'light' : 'dark';
        if (typeof document !== 'undefined') {
          document.documentElement.setAttribute('data-theme', next);
        }
        return next;
      });
      return next;
    },
  };
}

export const themeStore = createThemeStore();

let notificationCounter = 0;

function createUIStore() {
  const { subscribe, set, update } = writable(initialState);
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();

  /** @param {string} id */
  const clearTimer = (id) => {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
  };

  const clearAllTimers = () => {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
  };

  const uiStore = {
    subscribe,

    /**
     * Push a toast/notification to the UI store.
     * Supports both `notify({ type, message, timeout, id })` and `notify(message, optionsOrType)`.
     *
     * @param {string | {
     *   id?: string,
     *   type?: NotificationType,
     *   message: string,
     *   timeout?: number
     * }} notificationOrMessage
     * @param {NotificationType | {
     *   id?: string,
     *   type?: NotificationType,
     *   timeout?: number
     * }} [options]
     * @returns {string} Notification ID
     */
    notify: (notificationOrMessage, options = {}) => {
      const opts =
        typeof notificationOrMessage === 'object' && notificationOrMessage !== null
          ? notificationOrMessage
          : typeof options === 'string'
            ? { message: String(notificationOrMessage ?? ''), type: options }
            : { ...(options || {}), message: String(notificationOrMessage ?? '') };

      const id =
        typeof opts.id === 'string' && opts.id.trim()
          ? opts.id.trim()
          : `notif-${Date.now()}-${++notificationCounter}`;

      const rawType = /** @type {NotificationType} */ (opts.type || 'info');
      /** @type {NotificationType} */
      const type = VALID_TYPES.has(rawType) ? rawType : 'info';
      const message = String(opts.message || '').trim();
      const timeout =
        typeof opts.timeout === 'number' && opts.timeout >= 0
          ? opts.timeout
          : DEFAULT_TIMEOUT_MS;

      if (!message) return id;

      clearTimer(id);

      /** @type {UINotification} */
      const entry = { id, type, message, timeout };

      update((s) => ({
        ...s,
        notifications: [...s.notifications.filter((n) => n.id !== id), entry],
      }));

      if (timeout > 0) {
        const timer = setTimeout(() => {
          uiStore.dismissNotification(id);
        }, timeout);
        timers.set(id, timer);
      }

      return id;
    },

    /**
     * Dismiss a notification by ID.
     * @param {string} id
     */
    dismissNotification: (id) => {
      if (!id) return;
      clearTimer(id);
      update((s) => ({
        ...s,
        notifications: s.notifications.filter((n) => n.id !== id),
      }));
    },

    /**
     * Clear all active notifications.
     */
    clearNotifications: () => {
      clearAllTimers();
      update((s) => ({
        ...s,
        notifications: [],
      }));
    },

    /**
     * Open a modal dialog.
     * @param {string | UIModal} modal
     * @param {Record<string, any>} [props]
     */
    openModal: (modal, props) => {
      if (!modal) return;
      const resolved =
        typeof modal === 'string'
          ? { id: modal, ...(props ? { props } : {}) }
          : { id: modal.id || 'default', ...modal };
      update((s) => ({
        ...s,
        activeModal: resolved,
      }));
    },

    /**
     * Close the currently active modal dialog.
     */
    closeModal: () => {
      update((s) => ({
        ...s,
        activeModal: null,
      }));
    },

    /**
     * Toggle mobile sidebar open/closed state (or set explicitly if boolean provided).
     * @param {boolean} [forceState]
     */
    toggleSidebar: (forceState) => {
      update((s) => ({
        ...s,
        sidebarOpen: typeof forceState === 'boolean' ? forceState : !s.sidebarOpen,
      }));
    },

    /**
     * Set mobile sidebar open state explicitly.
     * @param {boolean} isOpen
     */
    setSidebarOpen: (isOpen) => {
      update((s) => ({
        ...s,
        sidebarOpen: Boolean(isOpen),
      }));
    },

    /**
     * Reset all UI state to initial values.
     */
    reset: () => {
      clearAllTimers();
      set(initialState);
    },
  };

  return uiStore;
}

export const uiStore = createUIStore();
export default uiStore;

