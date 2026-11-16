import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import app from './app.js';
import env from './src/config/env.js';
import pool from './src/config/database.js';
import { closeRedis } from './src/config/redis.js';
import { createSocketServer } from './src/socket/index.js';
import logger from './src/utils/logger.js';

function createServerInstance() {
  if (env.ssl?.enabled) {
    const tlsOptions = {
      key: fs.readFileSync(env.ssl.keyPath),
      cert: fs.readFileSync(env.ssl.certPath),
    };
    if (env.ssl.caPath) {
      tlsOptions.ca = fs.readFileSync(env.ssl.caPath);
    }
    return { server: https.createServer(tlsOptions, app), protocol: 'https' };
  }

  return { server: http.createServer(app), protocol: 'http' };
}

const { server: httpServer, protocol } = createServerInstance();

const io = createSocketServer(httpServer, env);

// Expose io instance on app so controllers can emit socket events
app.set('io', io);

httpServer.listen(env.port, env.host, () => {
  console.log(
    `GetTalk backend running on ${protocol}://${env.host}:${env.port}`
  );

  console.log(
    `Environment: ${env.nodeEnv}`
  );
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}; shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  try {
    await new Promise((resolve) => io.close(() => resolve()));
    await new Promise((resolve) => {
      if (!httpServer.listening) return resolve();
      httpServer.close(() => resolve());
    });
    await closeRedis().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  } catch (err) {
    logger.error('Error during graceful shutdown', { message: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));