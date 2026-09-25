import express from 'express';
import cors from 'cors';

import env from './src/config/env.js';
import healthRouter from './src/routes/health.route.js';

const app = express();

app.use(
  cors({
    origin: env.corsOrigin
  })
);

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    name: 'GetTalk Backend',
    environment: env.nodeEnv,
    status: 'running'
  });
});

app.use('/health', healthRouter);

export default app;