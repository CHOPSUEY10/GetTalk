import { Server } from 'socket.io';
import { socketAuth, socketConnectionLimit } from './middleware.js';
import { registerHandlers } from './handlers.js';
import * as rooms from './rooms.js';
import {
  handleSocketActive,
  handleSocketInactive,
  createPresenceMonitor,
} from './presence.js';
import { createCorsOptions } from '../config/cors.js';
import sessionMiddleware from '../config/session.js';
import logger from '../utils/logger.js';

export function createSocketServer(httpServer, env) {
  const io = new Server(httpServer, {
    cors: createCorsOptions(env.corsOrigins ?? env.corsOrigin),
    pingInterval: 15_000,
    pingTimeout: 10_000,
  });

  // Share session middleware with Socket.IO
  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  // Authenticate every incoming socket connection (plan §16)
  io.use(socketAuth);

  // Enforce maximum 3 concurrent WebSocket connections per user account (Rule #18)
  io.use(socketConnectionLimit);

  const stopPresenceMonitor = createPresenceMonitor(io);
  const originalClose = io.close.bind(io);
  io.close = (cb) => {
    stopPresenceMonitor();
    return originalClose(cb);
  };

  io.on('connection', (socket) => {
    const userId = socket.data.user?.id;
    socket.data.sessionId = socket.request?.sessionID || null;
    logger.info(`Socket connected: ${socket.id} (user: ${userId})`);

    // Register domain event handlers on authenticated socket
    registerHandlers(socket, io);

    const initiallyActive = socket.handshake?.auth?.active !== false;
    if (userId && initiallyActive) {
      handleSocketActive(io, socket).catch((err) => {
        logger.warn('Failed to mark socket active on connect', {
          userId,
          message: err?.message,
        });
      });
    } else {
      socket.data.presenceActive = false;
      socket.data.lastHeartbeatAt = Date.now();
    }

    socket.on('disconnect', (reason) => {
      if (userId) {
        socket.leave(rooms.userRoom(userId));
        handleSocketInactive(io, socket).catch((err) => {
          logger.warn('Failed to mark socket inactive on disconnect', {
            userId,
            message: err?.message,
          });
        });
      }
      logger.info(`Socket disconnected: ${socket.id}`, { reason, userId });
    });
  });

  return io;
}
