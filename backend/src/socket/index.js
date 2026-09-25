import { Server } from 'socket.io';

export function createSocketServer(httpServer, env) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigin
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('disconnect', (reason) => {
      console.log(
        `Socket disconnected: ${socket.id}`,
        reason
      );
    });
  });

  return io;
}