/**
 * Prisma CLI configuration (Prisma ORM v7).
 *
 * Loads the same environment file as src/config/env.js:
 *   .env.<NODE_ENV>  (fallback: .env)
 * so `prisma migrate` targets the same database as the running app.
 */
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

const backendRoot = dirname(fileURLToPath(import.meta.url));
const environmentName = process.env.NODE_ENV || 'development';
const modeEnvPath = resolve(backendRoot, `.env.${environmentName}`);
const localEnvPath = resolve(backendRoot, `.env.${environmentName}.local`);

// .local overrides (developer-specific, never committed) take precedence.
if (existsSync(localEnvPath)) dotenv.config({ path: localEnvPath, quiet: true });
dotenv.config({
  path: existsSync(modeEnvPath) ? modeEnvPath : resolve(backendRoot, '.env'),
  quiet: true,
});

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // Kept at backend/migrations to match the target structure (rule.md §3).
    path: 'migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
