import http from 'node:http';

import app from './app.js';
import env from './src/config/env.js';
import { createSocketServer } from './src/socket/index.js';

const httpServer = http.createServer(app);

createSocketServer(httpServer, env);

httpServer.listen(env.port, env.host, () => {
  console.log(
    `GetTalk backend running on http://${env.host}:${env.port}`
  );

  console.log(
    `Environment: ${env.nodeEnv}`
  );
});