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
      const error = new Error('Authentication required');
      error.data = { code: 'UNAUTHORIZED' };
      return next(error);
    }

    const user = await usersRepo.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.data = { code: 'UNAUTHORIZED' };
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
    error.data = { code: 'UNAUTHORIZED' };
    return next(error);
  }
}
