import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from this module so loading does not depend on the process cwd.
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultEnvPath = resolve(backendRoot, '.env');
const environmentName = process.env.NODE_ENV || 'development';
const modeEnvPath = resolve(backendRoot, `.env.${environmentName}`);
const localEnvPath = resolve(backendRoot, `.env.${environmentName}.local`);
const envPath = existsSync(modeEnvPath) ? modeEnvPath : defaultEnvPath;

// .local overrides (developer-specific, never committed) take precedence,
// same order as prisma.config.js. dotenv never overwrites an existing key.
if (existsSync(localEnvPath)) dotenv.config({ path: localEnvPath });
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
  const mfaEncryptionKey = process.env.MFA_ENCRYPTION_KEY?.trim() || sessionSecret;
  // Optional so the app still boots when Redis is down; the key registry
  // then fails safely with 503 (issue #11).
  const redisUrl = process.env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379';
  // Local encrypted-attachment storage. Replace with object storage in
  // production if needed; the key is opaque and server-generated.
  const storageDir = resolve(backendRoot, process.env.STORAGE_DIR?.trim() || 'storage');

  // SMTP configuration for transactional emails (OTP / Password Reset)
  const smtpHost = process.env.SMTP_HOST?.trim() || '';
  const smtpPort = positiveIntegerEnv('SMTP_PORT', 587);
  const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;
  const smtpUser = process.env.SMTP_USER?.trim() || '';
  // Strip spaces in case a 16-char Google App Password is pasted with spaces
  const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, '') : '';
  const smtpFrom =
    process.env.SMTP_FROM?.trim() ||
    smtpUser ||
    'GetTalk Security <no-reply@gettalk.local>';

  return {
    nodeEnv,
    host,
    port,
    corsOrigin,
    databaseUrl,
    sessionSecret,
    mfaEncryptionKey,
    redisUrl,
    storageDir,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPass,
    smtpFrom,
  };
}

const env = validateEnvironment();

export default env;
