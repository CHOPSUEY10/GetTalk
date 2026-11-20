/**
 * Prisma CLI configuration (Prisma ORM v7).
 *
 * Loads the same environment file as src/config/env.js:
 *   .env.<NODE_ENV>  (fallback: .env)
 * so `prisma migrate` targets the same database as the running app.
 */
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

const backendRoot = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  try {
    const parsed = dotenv.parse(readFileSync(filePath, 'utf8'));
    for (const [key, rawValue] of Object.entries(parsed)) {
      const value = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (!value) continue;
      const existing = process.env[key];
      if (existing === undefined || existing.trim() === '') {
        process.env[key] = value;
      }
    }
  } catch {
    dotenv.config({ path: filePath, quiet: true });
  }
}

const explicitNodeEnv = process.env.NODE_ENV?.trim();
const defaultEnvPath = resolve(backendRoot, '.env');
const defaultLocalEnvPath = resolve(backendRoot, '.env.local');

if (!explicitNodeEnv) {
  loadEnvFile(defaultLocalEnvPath);
  loadEnvFile(defaultEnvPath);
}

const environmentName =
  process.env.NODE_ENV?.trim() ||
  (!existsSync(resolve(backendRoot, '.env.development')) &&
  existsSync(resolve(backendRoot, '.env.production'))
    ? 'production'
    : 'development');

const modeEnvPath = resolve(backendRoot, `.env.${environmentName}`);
const localEnvPath = resolve(backendRoot, `.env.${environmentName}.local`);

// .local overrides (developer-specific, never committed) take precedence.
loadEnvFile(localEnvPath);
loadEnvFile(modeEnvPath);
loadEnvFile(defaultLocalEnvPath);
loadEnvFile(defaultEnvPath);

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
