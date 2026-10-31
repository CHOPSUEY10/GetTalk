import env from '../config/env.js';
import { API_ERROR_CODES, handleApiError } from '../errors/apierror.js';

/** @type {Record<string, string>} */
const headers = {};

/**
 * @param {string} path
 * @param {RequestInit} [options]
 */
export async function apiFetch(path, options = { headers }) {
  const controller = new AbortController();
  const method = String(options.method || 'GET').toUpperCase();

  const timeout = setTimeout(() => {
    controller.abort();
  }, env.apiTimeoutMs);

  try {
    const response = await fetch(`${env.apiUrl}${path}`, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    return response;
  } catch (error) {
    const anyErr = /** @type {any} */ (error);
    const isTimeout = anyErr?.name === 'AbortError' || anyErr?.name === 'TimeoutError';
    throw handleApiError(anyErr, {
      endpoint: path,
      method,
      status: isTimeout ? 408 : 0,
      code: isTimeout ? API_ERROR_CODES.REQUEST_TIMEOUT : API_ERROR_CODES.NETWORK_ERROR
    });
  } finally {
    clearTimeout(timeout);
  }
}
