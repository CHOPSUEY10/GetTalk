import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pool from './database.js';
import env from './env.js';
import logger from '../utils/logger.js';

const PgSession = connectPgSimple(session);

let store;
if (env.nodeEnv !== 'test' && process.env.USE_MEMORY_SESSION !== 'true') {
  try {
    store = new PgSession({
      pool,
      tableName: 'sessions',
      // Table is created by Prisma Migrate (migrations/*_init). Do not let the
      // app alter schema at startup (rule.md §9, §10).
      createTableIfMissing: false,
    });
    store.pruneTimer?.unref?.();
    store.on('error', (err) => {
      logger.error('Session store error', { message: err.message });
    });
  } catch (err) {
    logger.warn('Failed to initialize PgSession store', { message: err.message });
  }
}

/**
 * Express session middleware configured with PostgreSQL session store.
 * HttpOnly + Secure + SameSite per rule.md §12.
 * Supports two-subdomain deployment via configurable SameSite/Secure/Domain.
 */
const cookieOptions = {
  httpOnly: true,
  secure: env.cookie?.secure ?? env.nodeEnv === 'production',
  sameSite: env.cookie?.sameSite ?? 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

if (env.cookie?.domain) {
  cookieOptions.domain = env.cookie.domain;
}

const sessionMiddleware = session({
  store,
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: Boolean(env.trustProxy),
  name: 'gettalk.sid',
  cookie: cookieOptions,
});

export default sessionMiddleware;
