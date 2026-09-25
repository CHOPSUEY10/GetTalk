/**
 * @param {string} name
 */
const requiredEnv = (name) => {
  const value = import.meta.env[name];
  if (!value || value.trim() === '') {
      throw new Error(
        `Environment variable ${name} belum dikonfigurasi`
      );
    }

    return value.trim();

}

/**
 * @param {string} name
 * @param {number} defaultValue
*/
function positiveIntegerEnv(name, defaultValue) {
  const value = import.meta.env[name];

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

const validateEnvironment = () =>  {
  const appEnv = requiredEnv('VITE_APP_ENV');

  const allowedEnvironments = [
    'development',
    'staging',
    'production'
  ];

  if (!allowedEnvironments.includes(appEnv)) {
    throw new Error(
      `VITE_APP_ENV tidak valid: ${appEnv}. ` +
      `Gunakan development, staging, atau production.`
    );
  }

  const apiUrl = requiredEnv('VITE_API_URL');
  const socketUrl = requiredEnv('VITE_SOCKET_URL');

  try {
    new URL(apiUrl);
  } catch {
    throw new Error(
      `VITE_API_URL bukan URL yang valid: ${apiUrl}`
    );
  }

  try {
    new URL(socketUrl);
  } catch {
    throw new Error(
      `VITE_SOCKET_URL bukan URL yang valid: ${socketUrl}`
    );
  }

  const apiTimeoutMs = positiveIntegerEnv(
    'VITE_API_TIMEOUT_MS',
    10000
  );

  return {
    appEnv,
    apiUrl,
    socketUrl,
    apiTimeoutMs
  };
}


const env = validateEnvironment()



export default env;