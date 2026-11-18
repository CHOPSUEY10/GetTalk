export interface EnvConfig {
  appEnv: 'development' | 'staging' | 'production';
  apiUrl: string;
  apiTimeoutMs: number;
}

function getEnvValue(name: string): string | undefined {
  try {
    const meta = import.meta as any;
    if (meta && meta.env && meta.env[name] !== undefined) {
      return String(meta.env[name]);
    }
  } catch {
    // Fallback for Node.js test runner
  }
  if (typeof process !== 'undefined' && process.env && process.env[name] !== undefined) {
    return String(process.env[name]);
  }
  return undefined;
}

export function validateEnvironment(): EnvConfig {
  const rawEnv = (getEnvValue('VITE_APP_ENV') || 'development').trim() as EnvConfig['appEnv'];
  const allowed: EnvConfig['appEnv'][] = ['development', 'staging', 'production'];
  const appEnv = allowed.includes(rawEnv) ? rawEnv : 'development';

  const rawApiUrl = (getEnvValue('VITE_API_URL') || 'http://localhost:4100').trim().replace(/\/+$/, '');
  try {
    new URL(rawApiUrl);
  } catch {
    throw new Error(`VITE_API_URL is not a valid URL: ${rawApiUrl}`);
  }

  const rawTimeout = getEnvValue('VITE_API_TIMEOUT_MS');
  let apiTimeoutMs = 15000;
  if (rawTimeout) {
    const parsed = Number(rawTimeout);
    if (Number.isInteger(parsed) && parsed > 0) {
      apiTimeoutMs = parsed;
    }
  }

  return {
    appEnv,
    apiUrl: rawApiUrl,
    apiTimeoutMs,
  };
}

export const env: EnvConfig = validateEnvironment();
export default env;

