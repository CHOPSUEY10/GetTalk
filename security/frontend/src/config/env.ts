export interface EnvConfig {
  appEnv: 'development' | 'staging' | 'production';
  apiUrl: string;
  apiTimeoutMs: number;
}

function getEnvValue(name: string): string | undefined {
  if (
    typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    (import.meta as any).env[name] !== undefined
  ) {
    return String((import.meta as any).env[name]);
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

  const isBrowserRemoteHost =
    typeof window !== 'undefined' &&
    Boolean(window.location?.origin) &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';

  const defaultOrigin = isBrowserRemoteHost
    ? window.location.origin
    : 'http://localhost:4100';

  const configuredApiUrl = (getEnvValue('VITE_API_URL') || '').trim().replace(/\/+$/, '');
  const rawApiUrl =
    !configuredApiUrl ||
    (isBrowserRemoteHost &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredApiUrl))
      ? defaultOrigin
      : configuredApiUrl;

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
