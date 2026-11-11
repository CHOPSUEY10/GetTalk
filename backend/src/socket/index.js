import { Server } from 'socket.io';
import { socketAuth, socketConnectionLimit } from './middleware.js';
import { registerHandlers } from './handlers.js';
import * as rooms from './rooms.js';
import * as usersRepo from '../repositories/users.repository.js';
import { createCorsOptions } from '../config/cors.js';
import sessionMiddleware from '../config/session.js';
import logger from '../utils/logger.js';

export function createSocketServer(httpServer, env) {
  const io = new Server(httpServer, {
    cors: createCorsOptions(env.corsOrigins ?? env.corsOrigin),
  });

  // Share session middleware with Socket.IO
  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  // Authenticate every incoming socket connection (plan §16)
  io.use(socketAuth);

  // Enforce maximum 3 concurrent WebSocket connections per user account (Rule #18)
  io.use(socketConnectionLimit);

  io.on('connection', (socket) => {
    const userId = socket.data.user?.id;
    logger.info(`Socket connected: ${socket.id} (user: ${userId})`);

    if (userId) {
      usersRepo.updateLastSeen(userId, new Date()).catch(() => {});
    }

    // Register domain event handlers on authenticated socket
    registerHandlers(socket, io);

    socket.on('disconnect', (reason) => {
      if (userId) {
        socket.leave(rooms.userRoom(userId));
        usersRepo.updateLastSeen(userId, new Date()).catch(() => {});
      }
      logger.info(`Socket disconnected: ${socket.id}`, { reason, userId });
    });
  });

  return io;
}
