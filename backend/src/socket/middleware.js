import * as usersRepo from '../repositories/users.repository.js';
import * as securityEventsRepo from '../repositories/security-events.repository.js';
import * as rooms from './rooms.js';
import {
  UNAUTHORIZED,
  MAX_CONCURRENT_SOCKETS_EXCEEDED,
  INTERNAL_ERROR,
} from '../errors/error-codes.js';
import logger from '../utils/logger.js';

export const MAX_CONCURRENT_SOCKETS = 3;

/**
 * Socket.IO authentication middleware (plan §16, rule §19).
 *
 * Obtains the authenticated identity from the session context —
 * NEVER trusts an unverified client identity.
 *
 * @param {import('socket.io').Socket} socket
 * @param {Function} next
 */
export async function socketAuth(socket, next) {
  try {
    const userId = socket.request.session?.userId;

    if (!userId) {
      const error = new Error('Authentication required');
      /** @type {any} */ (error).data = { code: UNAUTHORIZED };
      return next(error);
    }

    const user = await usersRepo.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      /** @type {any} */ (error).data = { code: UNAUTHORIZED };
      return next(error);
    }

    socket.data.user = {
      id: user.id,
      username: user.username,
    };

    return next();
  } catch (err) {
    logger.error('Socket authentication error', { message: err.message });
    const error = new Error('Authentication failed');
    /** @type {any} */ (error).data = { code: UNAUTHORIZED };
    return next(error);
  }
}

/**
 * Internal implementation for enforcing the per-account concurrent socket limit (Rule #18).
 *
 * @param {import('socket.io').Socket} socket
 * @param {Function} next
 * @param {import('socket.io').Server | null} [ioInstance]
 */
async function enforceSocketConnectionLimit(socket, next, ioInstance = null) {
  try {
    const userId = socket?.data?.user?.id || socket?.request?.session?.userId;
    if (!userId) {
      const error = new Error('Authentication required');
      /** @type {any} */ (error).data = { code: UNAUTHORIZED };
      return next(error);
    }

    const userRoomName = rooms.userRoom(userId);
    const nsp = ioInstance?.sockets || socket?.nsp || socket?.server?.sockets;
    const adapter = nsp?.adapter || socket?.adapter;
    const activeSockets = adapter?.rooms?.get(userRoomName);

    // Prune any stale socket IDs whose underlying transport is already closing/closed
    if (activeSockets && nsp?.sockets) {
      for (const sid of [...activeSockets]) {
        const existing = nsp.sockets.get(sid) || nsp._preConnectSockets?.get(sid);
        const readyState = existing?.client?.conn?.readyState || existing?.conn?.readyState;
        if (readyState && readyState !== 'open') {
          activeSockets.delete(sid);
        }
      }
    }

    const activeCount = activeSockets
      ? activeSockets.has(socket.id)
        ? activeSockets.size - 1
        : activeSockets.size
      : 0;

    if (activeCount >= MAX_CONCURRENT_SOCKETS) {
      const ipAddress =
        socket?.handshake?.address ||
        socket?.request?.ip ||
        socket?.request?.socket?.remoteAddress ||
        null;

      logger.warn('Socket connection rejected: maximum concurrent connections exceeded', {
        userId,
        socketId: socket?.id,
        activeConnections: activeCount,
        maxAllowed: MAX_CONCURRENT_SOCKETS,
        code: MAX_CONCURRENT_SOCKETS_EXCEEDED,
      });

      await securityEventsRepo.create({
        userId,
        eventType: MAX_CONCURRENT_SOCKETS_EXCEEDED,
        ipAddress,
        metadata: {
          activeConnections: activeCount,
          maxAllowed: MAX_CONCURRENT_SOCKETS,
        },
      });

      const message =
        'Batas maksimum 3 sesi obrolan aktif bersamaan telah tercapai untuk akun ini.';
      const err = new Error(message);
      /** @type {any} */ (err).code = MAX_CONCURRENT_SOCKETS_EXCEEDED;
      /** @type {any} */ (err).data = {
        code: MAX_CONCURRENT_SOCKETS_EXCEEDED,
        message,
      };
      return next(err);
    }

    // Reserve slot in user room immediately so concurrent handshakes are counted accurately
    if (typeof socket.join === 'function') {
      await socket.join(userRoomName);
    }

    return next();
  } catch (err) {
    logger.error('Socket connection limit check error', { message: err.message });
    const error = new Error('Connection check failed');
    /** @type {any} */ (error).data = { code: INTERNAL_ERROR };
    return next(error);
  }
}

/**
 * Socket.IO connection quota middleware (Rule #18).
 * Enforces a strict maximum of 3 concurrent WebSocket connections per user account.
 * Supports both `io.use(socketConnectionLimit)` and `io.use(socketConnectionLimit(io))`.
 *
 * @param {any} socketOrIo
 * @param {Function} [next]
 */
export function socketConnectionLimit(socketOrIo, next) {
  if (typeof next === 'function') {
    return enforceSocketConnectionLimit(socketOrIo, next);
  }
  const io = socketOrIo;
  return (socket, mwNext) => enforceSocketConnectionLimit(socket, mwNext, io);
}
