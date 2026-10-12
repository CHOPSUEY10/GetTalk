import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pool from './database.js';

/**
 * Shared Prisma Client.
 *
 * Uses the pg driver adapter on top of the existing pg Pool, so Prisma and
 * the legacy `query()` helper share one connection pool.
 *
 * Only repositories may import this module (rule.md §8) — never controllers,
 * services or socket handlers.
 */
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  // Never log queries: parameters may contain password hashes or ciphertext.
  log: ['warn', 'error'],
});

export default prisma;
