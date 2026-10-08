import * as usersRepo from '../repositories/users.repository.js';
import logger from '../utils/logger.js';

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
    const userId = socket.request.session?.userId || socket.handshake.auth?.userId;

    if (!userId) {
      // In development environment, allow handshake query fallback if session cookie isn't available
      if (process.env.NODE_ENV === 'development' && socket.handshake.query?.userId) {
        const queryUserId = String(socket.handshake.query.userId);
        socket.data.user = {
          id: queryUserId,
          username: socket.handshake.query.username || 'dev-user',
        };
        return next();
      }

      const error = new Error('Authentication required');
      /** @type {any} */ (error).data = { code: 'UNAUTHORIZED' };
      return next(error);
    }

    const user = await usersRepo.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      /** @type {any} */ (error).data = { code: 'UNAUTHORIZED' };
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
    /** @type {any} */ (error).data = { code: 'UNAUTHORIZED' };
    return next(error);
  }
}
