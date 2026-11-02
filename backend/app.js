import express from 'express';

import env from './src/config/env.js';
import corsMiddleware from './src/config/cors.js';
import sessionMiddleware from './src/config/session.js';
import healthRouter from './src/routes/health.route.js';
import apiRoutes from './src/routes/index.js';
import { notFoundHandler } from './src/middleware/not-found.middleware.js';
import { errorHandler } from './src/middleware/error.middleware.js';
import { securityHeaders } from './src/middleware/security-headers.middleware.js';

const app = express();

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(corsMiddleware);

app.use(express.json({ limit: '500kb' }));
app.use(sessionMiddleware);

app.get('/', (req, res) => {
  res.json({
    name: 'GetTalk Backend',
    environment: env.nodeEnv,
    status: 'running',
  });
});

app.use('/health', healthRouter);
app.use('/api', apiRoutes);

// ── Catch-all & error handling (must be last) ──────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
