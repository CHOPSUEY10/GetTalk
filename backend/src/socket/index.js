import { Server } from 'socket.io';
import { socketAuth } from './middleware.js';
import { registerHandlers } from './handlers.js';
import sessionMiddleware from '../config/session.js';
import logger from '../utils/logger.js';

export function createSocketServer(httpServer, env) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigin,
      credentials: true,
    },
  });

  // Share session middleware with Socket.IO
  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  // Authenticate every incoming socket connection (plan §16)
  io.use(socketAuth);

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} (user: ${socket.data.user?.id})`);

    // Register domain event handlers on authenticated socket
    registerHandlers(socket, io);

    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id}`, { reason });
    });
  });

  return io;
}