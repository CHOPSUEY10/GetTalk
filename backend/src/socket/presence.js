import * as events from './events.js';
import * as rooms from './rooms.js';
import * as presenceService from '../services/presence.service.js';
import * as usersService from '../services/users.service.js';
import * as usersRepo from '../repositories/users.repository.js';
import * as friendsRepo from '../repositories/friends.repository.js';
import * as convRepo from '../repositories/conversations.repository.js';
import * as sessionsRepo from '../repositories/sessions.repository.js';
import logger from '../utils/logger.js';

const MAX_SYNC_USER_IDS = 100;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Find all distinct connected peer user IDs (friends + conversation co-members)
 * who currently have an open Socket.IO room on this server.
 *
 * @param {import('socket.io').Server} io
 * @param {string} userId
 * @param {string[] | null} [explicitPeerIds]
 * @returns {Promise<string[]>}
 */
async function resolveConnectedPeers(io, userId, explicitPeerIds = null) {
  if (!io?.sockets?.adapter?.rooms || !userId) return [];

  let candidateIds = [];
  if (Array.isArray(explicitPeerIds)) {
    candidateIds = explicitPeerIds;
  } else {
    try {
      const [friendIds, convPeerIds] = await Promise.all([
        friendsRepo.findAcceptedFriendIds(userId),
        convRepo.findPeerUserIds(userId),
      ]);
      candidateIds = [...friendIds, ...convPeerIds];
    } catch (err) {
      logger.warn('Failed to resolve presence peers from database', {
        userId,
        message: err?.message,
      });
      return [];
    }
  }

  const activeRooms = io.sockets.adapter.rooms;
  const connected = [];
  const seen = new Set();

  for (const peerId of candidateIds) {
    if (!peerId || peerId === userId || seen.has(peerId)) continue;
    seen.add(peerId);
    const room = activeRooms.get(rooms.userRoom(peerId));
    if (room && room.size > 0) {
      connected.push(peerId);
    }
  }

  return connected;
}

/**
 * Emit a privacy-filtered `user:online` or `user:offline` event for `userId`
 * to all connected peers (friends & conversation co-members) and to `userId`'s
 * own room for cross-tab synchronization.
 *
 * @param {import('socket.io').Server} io
 * @param {string} userId
 * @param {{ isOnline: boolean, lastSeenAt: string | null }} state
 */
export async function broadcastPresenceChange(io, userId, { isOnline, lastSeenAt }) {
  if (!io || !userId) return;

  const eventName = isOnline ? events.USER_ONLINE : events.USER_OFFLINE;

  // Keep the user's own connected tabs/sessions synchronized with authoritative presence.
  io.to(rooms.userRoom(userId)).emit(eventName, {
    userId,
    isOnline: Boolean(isOnline),
    lastSeenAt: lastSeenAt || null,
  });

  const connectedPeers = await resolveConnectedPeers(io, userId);
  if (connectedPeers.length === 0) return;

  await Promise.all(
    connectedPeers.map(async (peerId) => {
      try {
        const visibility = await usersService.getPresenceVisibility(peerId, userId);
        if (isOnline) {
          if (!visibility.canViewOnline) return;
          io.to(rooms.userRoom(peerId)).emit(events.USER_ONLINE, {
            userId,
            isOnline: true,
            lastSeenAt: visibility.canViewLastSeen ? (lastSeenAt || null) : null,
          });
        } else if (visibility.canViewOnline || visibility.canViewLastSeen) {
          io.to(rooms.userRoom(peerId)).emit(events.USER_OFFLINE, {
            userId,
            isOnline: false,
            lastSeenAt: visibility.canViewLastSeen ? (lastSeenAt || null) : null,
          });
        }
      } catch (err) {
        logger.warn('Failed to emit presence update to peer', {
          userId,
          peerId,
          message: err?.message,
        });
      }
    })
  );
}

/**
 * Re-evaluate and push presence visibility after privacy settings or block status changes.
 *
 * @param {import('socket.io').Server | null | undefined} io
 * @param {string} userId
 * @param {string[] | null} [specificPeerIds]
 */
export async function syncPresenceVisibilityForPeers(io, userId, specificPeerIds = null) {
  if (!io || !userId) return;

  try {
    const connectedPeers = await resolveConnectedPeers(io, userId, specificPeerIds);
    if (connectedPeers.length === 0) return;

    const allIds = [userId, ...connectedPeers];
    const validUuidIds = allIds.filter((id) => UUID_REGEX.test(id));
    let fallbackMap = new Map();
    if (validUuidIds.length > 0) {
      try {
        fallbackMap = await usersRepo.findLastSeenByIds(validUuidIds);
      } catch {
        // DB fallback optional
      }
    }

    const presenceMap = await presenceService.getPresenceBatch(allIds, {
      fallbackLastSeenMap: fallbackMap,
    });
    const selfPresence = presenceMap.get(userId) || {
      userId,
      isOnline: false,
      lastSeenAt: null,
    };

    const selfConnected = Boolean(io.sockets?.adapter?.rooms?.get(rooms.userRoom(userId))?.size);

    await Promise.all(
      connectedPeers.map(async (peerId) => {
        try {
          // 1. Update peer's view of `userId`
          const peerView = await usersService.getPresenceVisibility(peerId, userId);
          const peerSeesOnline = peerView.canViewOnline && selfPresence.isOnline;
          const peerSeesLastSeen = peerView.canViewLastSeen ? selfPresence.lastSeenAt : null;
          io.to(rooms.userRoom(peerId)).emit(
            peerSeesOnline ? events.USER_ONLINE : events.USER_OFFLINE,
            {
              userId,
              isOnline: peerSeesOnline,
              lastSeenAt: peerSeesLastSeen,
            }
          );

          // 2. Reciprocal: update `userId`'s view of `peerId`
          if (selfConnected) {
            const selfView = await usersService.getPresenceVisibility(userId, peerId);
            const peerPresence = presenceMap.get(peerId) || {
              userId: peerId,
              isOnline: false,
              lastSeenAt: null,
            };
            const selfSeesOnline = selfView.canViewOnline && peerPresence.isOnline;
            const selfSeesLastSeen = selfView.canViewLastSeen ? peerPresence.lastSeenAt : null;
            io.to(rooms.userRoom(userId)).emit(
              selfSeesOnline ? events.USER_ONLINE : events.USER_OFFLINE,
              {
                userId: peerId,
                isOnline: selfSeesOnline,
                lastSeenAt: selfSeesLastSeen,
              }
            );
          }
        } catch (err) {
          logger.warn('Failed to sync presence visibility for peer', {
            userId,
            peerId,
            message: err?.message,
          });
        }
      })
    );
  } catch (err) {
    logger.warn('Failed to sync presence visibility', {
      userId,
      message: err?.message,
    });
  }
}

/**
 * Mark a connected socket active in Redis and broadcast `user:online` if the user
 * transitioned from offline -> online.
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export async function handleSocketActive(io, socket) {
  const userId = socket?.data?.user?.id;
  if (!userId) return null;

  const sid = socket.data?.sessionId || socket.request?.sessionID || null;
  if (sid && sessionsRepo.isSessionRevoked(sid)) {
    await handleSocketInactive(io, socket);
    socket.disconnect(true);
    return null;
  }

  const nowMs = Date.now();
  socket.data.presenceActive = true;
  socket.data.lastHeartbeatAt = nowMs;

  const result = await presenceService.markSocketActive(userId, socket.id, { nowMs });

  if (result.transitioned) {
    await broadcastPresenceChange(io, userId, {
      isOnline: true,
      lastSeenAt: result.lastSeenAt,
    });
  }

  // Always synchronize reciprocal presence visibility with connected peers on connect/active
  // so peers reconnecting in any order after a backend restart immediately see each other's live state.
  await syncPresenceVisibilityForPeers(io, userId);

  return result;
}

/**
 * Mark a socket inactive in Redis (on tab hide, idle, logout, session revocation,
 * or socket disconnect). If no other active foreground sockets remain for the user,
 * persist durable `last_seen_at` and broadcast `user:offline`.
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export async function handleSocketInactive(io, socket) {
  const userId = socket?.data?.user?.id;
  if (!userId) return null;

  const nowMs = Date.now();
  socket.data.presenceActive = false;

  const result = await presenceService.markSocketInactive(userId, socket.id, { nowMs });

  if (result.transitioned) {
    if (result.lastSeenAt) {
      usersRepo.updateLastSeen(userId, new Date(result.lastSeenAt)).catch(() => {});
    }
    await broadcastPresenceChange(io, userId, {
      isOnline: false,
      lastSeenAt: result.lastSeenAt,
    });
  }

  return result;
}

/**
 * Disconnect sockets belonging to revoked or logged-out sessions and immediately
 * synchronize their presence state in Redis.
 *
 * @param {import('socket.io').Server | null | undefined} io
 * @param {string} userId
 * @param {{ sessionId?: string | null, exceptSessionId?: string | null }} [options]
 */
export async function disconnectUserSessionSockets(
  io,
  userId,
  { sessionId = null, exceptSessionId = null } = {}
) {
  if (!io || !userId) return 0;

  try {
    const sockets = await io.in(rooms.userRoom(userId)).fetchSockets();
    let disconnectedCount = 0;

    for (const sock of sockets) {
      const sockSid = sock.data?.sessionId || sock.request?.sessionID || null;
      const shouldDisconnect = sessionId
        ? sockSid === sessionId
        : exceptSessionId
          ? sockSid !== exceptSessionId
          : true;

      if (!shouldDisconnect) continue;

      disconnectedCount += 1;
      await handleSocketInactive(io, /** @type {any} */ (sock));
      sock.disconnect(true);
    }

    return disconnectedCount;
  } catch (err) {
    logger.warn('Failed to disconnect user session sockets', {
      userId,
      message: err?.message,
    });
    return 0;
  }
}

/**
 * Return privacy-filtered Redis presence for a bounded list of user IDs requested
 * by `viewerId` (used by `presence:sync`).
 *
 * @param {string} viewerId
 * @param {string[]} userIds
 * @returns {Promise<Record<string, { isOnline: boolean, lastSeenAt: string | null }>>}
 */
export async function getAuthorizedPresenceMap(viewerId, userIds) {
  if (!viewerId || !Array.isArray(userIds) || userIds.length === 0) {
    return {};
  }

  const boundedIds = Array.from(
    new Set(userIds.filter((id) => typeof id === 'string' && id.trim().length > 0))
  ).slice(0, MAX_SYNC_USER_IDS);

  if (boundedIds.length === 0) return {};

  const validUuidIds = boundedIds.filter((id) => UUID_REGEX.test(id));
  let fallbackLastSeenMap = new Map();
  if (validUuidIds.length > 0) {
    try {
      fallbackLastSeenMap = await usersRepo.findLastSeenByIds(validUuidIds);
    } catch {
      // Fallback optional when DB is unavailable
    }
  }

  const presenceMap = await presenceService.getPresenceBatch(boundedIds, {
    fallbackLastSeenMap,
  });

  /** @type {Record<string, { isOnline: boolean, lastSeenAt: string | null }>} */
  const response = {};

  await Promise.all(
    boundedIds.map(async (targetId) => {
      const entry = presenceMap.get(targetId) || {
        userId: targetId,
        isOnline: false,
        lastSeenAt: null,
      };
      try {
        const visibility = await usersService.getPresenceVisibility(viewerId, targetId);
        response[targetId] = {
          isOnline: visibility.canViewOnline ? entry.isOnline : false,
          lastSeenAt: visibility.canViewLastSeen ? entry.lastSeenAt : null,
        };
      } catch {
        response[targetId] = {
          isOnline: false,
          lastSeenAt: null,
        };
      }
    })
  );

  return response;
}

/**
 * Periodically sweep locally connected sockets to expire stale heartbeats
 * (e.g. frozen browser tab or silent network drop) and disconnect revoked sessions.
 *
 * @param {import('socket.io').Server} io
 * @param {{ intervalMs?: number, ttlMs?: number }} [options]
 * @returns {() => void} cleanup function
 */
export function createPresenceMonitor(
  io,
  { intervalMs = 15_000, ttlMs = presenceService.PRESENCE_TTL_MS } = {}
) {
  const timer = setInterval(async () => {
    const sockets = io?.sockets?.sockets;
    if (!sockets || sockets.size === 0) return;

    const nowMs = Date.now();
    for (const socket of sockets.values()) {
      const userId = socket?.data?.user?.id;
      if (!userId) continue;

      const sid = socket.data?.sessionId || socket.request?.sessionID || null;
      if (sid && sessionsRepo.isSessionRevoked(sid)) {
        await handleSocketInactive(io, socket).catch(() => {});
        socket.disconnect(true);
        continue;
      }

      if (
        socket.data.presenceActive === true &&
        typeof socket.data.lastHeartbeatAt === 'number' &&
        nowMs - socket.data.lastHeartbeatAt >= ttlMs
      ) {
        await handleSocketInactive(io, socket).catch(() => {});
      }
    }
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return () => clearInterval(timer);
}

/**
 * Mark all currently connected sockets inactive in Redis during graceful server shutdown
 * so no stale `s:<socketId>` fields remain in Redis across a backend restart.
 *
 * @param {import('socket.io').Server | null | undefined} io
 */
export async function deactivateAllConnectedSockets(io) {
  const sockets = io?.sockets?.sockets;
  if (!sockets || sockets.size === 0) return;

  const tasks = [];
  for (const socket of sockets.values()) {
    const userId = socket?.data?.user?.id;
    if (!userId) continue;
    tasks.push(handleSocketInactive(io, socket).catch(() => {}));
  }
  await Promise.allSettled(tasks);
}
