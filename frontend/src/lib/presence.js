/**
 * Client-side presence & Last Seen utilities.
 *
 * Pure helpers shared across Chat, AppShell, Home, Friends, and socketStore
 * so active status and Last Seen rendering are consistent everywhere without
 * duplicating business logic inside Svelte components (Rule #4, #25).
 */

/** Heartbeat cadence while the browser tab is visible and session is active. */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 20_000;

/** Idle timeout (3 minutes without interaction) before marking session inactive. */
export const PRESENCE_IDLE_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Determine whether the current browser document is visible & active.
 * Defaults to `true` in non-browser environments (e.g. Node unit tests).
 *
 * @returns {boolean}
 */
export function isBrowserDocumentActive() {
  if (typeof document === 'undefined') return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return document.visibilityState !== 'hidden';
}

/**
 * Format an ISO-8601 / Date Last Seen timestamp for Indonesian UI display.
 *
 * @param {string | Date | number | null | undefined} timestamp
 * @param {{ compact?: boolean, now?: number | Date }} [options]
 * @returns {string | null}
 */
export function formatLastSeen(timestamp, { compact = false, now = Date.now() } = {}) {
  if (!timestamp) return null;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const nowDate = now instanceof Date ? now : new Date(now);
  const timeText = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfTarget.getTime()) / 86_400_000);

  if (dayDiff === 0) {
    return compact
      ? `Terakhir dilihat ${timeText}`
      : `Terakhir dilihat hari ini pukul ${timeText}`;
  }

  if (dayDiff === 1) {
    return compact
      ? `Kemarin, ${timeText}`
      : `Terakhir dilihat kemarin pukul ${timeText}`;
  }

  const dateText = date.toLocaleDateString([], {
    day: '2-digit',
    month: 'short',
    ...(date.getFullYear() !== nowDate.getFullYear() ? { year: 'numeric' } : {}),
  });

  return compact
    ? `${dateText}, ${timeText}`
    : `Terakhir dilihat ${dateText}, ${timeText}`;
}

/**
 * Resolve effective peer presence (`isOnline`, `lastSeenAt`) by combining
 * real-time socket presence updates with the REST DTO fallback.
 *
 * When the local user's connection or session is inactive (`!selfConnected || !selfActive`),
 * `isOnline` is always `false` so the UI displays Last Seen instead of a stale active indicator.
 *
 * @param {{
 *   peer?: any,
 *   userId?: string | null,
 *   presenceMap?: Record<string, { isOnline?: boolean, lastSeenAt?: string | null }> | null,
 *   selfConnected?: boolean,
 *   selfActive?: boolean,
 * }} params
 * @returns {{ isOnline: boolean, lastSeenAt: string | null }}
 */
export function resolvePeerPresence({
  peer = null,
  userId = null,
  presenceMap = null,
  selfConnected = false,
  selfActive = true,
} = {}) {
  const resolvedId = userId || peer?.id || peer?.userId || null;
  const live = resolvedId && presenceMap ? presenceMap[resolvedId] : null;

  const lastSeenAt =
    live?.lastSeenAt !== undefined
      ? live.lastSeenAt
      : (peer?.lastSeenAt ?? peer?.last_seen_at ?? null);

  if (!selfConnected || !selfActive) {
    return {
      isOnline: false,
      lastSeenAt: lastSeenAt || null,
    };
  }

  const isOnline = live ? Boolean(live.isOnline) : Boolean(peer?.isOnline);
  return {
    isOnline,
    lastSeenAt: lastSeenAt || null,
  };
}
