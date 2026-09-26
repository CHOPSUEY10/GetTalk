import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from this module so loading does not depend on the process cwd.
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultEnvPath = resolve(backendRoot, '.env');
const environmentName = process.env.NODE_ENV || 'development';
const modeEnvPath = resolve(backendRoot, `.env.${environmentName}`);
const envPath = existsSync(modeEnvPath) ? modeEnvPath : defaultEnvPath;

dotenv.config({ path: envPath });

const allowedEnvironments = [
  'development',
  'staging',
  'production'
];

function requiredEnv(name) {
  const value = process.env[name];

  if (!value || value.trim() === '') {
    throw new Error(
      `Environment variable ${name} belum dikonfigurasi`
    );
  }

  return value.trim();
}

function positiveIntegerEnv(name, defaultValue) {
  const value = process.env[name];

  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${name} harus berupa bilangan bulat positif`
    );
  }

  return parsed;
}

function validateEnvironment() {
  const nodeEnv = requiredEnv('NODE_ENV');

  if (!allowedEnvironments.includes(nodeEnv)) {
    throw new Error(
      `NODE_ENV tidak valid: ${nodeEnv}`
    );
  }

  const host = requiredEnv('HOST');
  const port = positiveIntegerEnv('PORT', 3000);
  const corsOrigin = requiredEnv('CORS_ORIGIN');
  const databaseUrl = requiredEnv('DATABASE_URL');
  const sessionSecret = requiredEnv('SESSION_SECRET');

  return {
    nodeEnv,
    host,
    port,
    corsOrigin,
    databaseUrl,
    sessionSecret
  };
}

const env = validateEnvironment();

export default env;
