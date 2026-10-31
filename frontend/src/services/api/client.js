import env from '../../config/env.js';
import { ApiError, API_ERROR_CODES, handleApiError } from '../../errors/apierror.js';

export { ApiError };

/**
 * @typedef {RequestInit & { body?: any, suppressUnauthorizedEvent?: boolean }} CustomRequestInit
 */

/**
 * @param {string} endpoint
 * @param {CustomRequestInit} [options]
 * @returns {Promise<any>}
 */
async function fetchClient(endpoint, options = {}) {
  const url = `${env.apiUrl}${endpoint}`;
  const { suppressUnauthorizedEvent = false, ...requestOptions } = options;
  const method = String(requestOptions.method || 'GET').toUpperCase();

  const headers = {
    'Content-Type': 'application/json',
    ...(requestOptions.headers || {}),
  };

  /** @type {RequestInit & { body?: any }} */
  const fetchOptions = {
    ...requestOptions,
    method,
    headers,
    credentials: 'include',
  };

  if (fetchOptions.body && typeof fetchOptions.body !== 'string') {
    fetchOptions.body = JSON.stringify(fetchOptions.body);
  }

  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (error) {
    const anyErr = /** @type {any} */ (error);
    const isTimeout = anyErr?.name === 'AbortError' || anyErr?.name === 'TimeoutError';
    throw handleApiError(anyErr, {
      endpoint,
      method,
      status: isTimeout ? 408 : 0,
      code: isTimeout ? API_ERROR_CODES.REQUEST_TIMEOUT : API_ERROR_CODES.NETWORK_ERROR,
    });
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  let data = null;

  if (isJson) {
    try {
      data = await response.json();
    } catch (parseError) {
      if (response.ok && response.status !== 204) {
        throw handleApiError(parseError, {
          endpoint,
          method,
          status: response.status,
          code: API_ERROR_CODES.INVALID_RESPONSE,
        });
      }
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    if (response.status === 401 && !suppressUnauthorizedEvent && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('api:unauthorized'));
    }

    const isExpectedAnonymousSessionCheck =
      suppressUnauthorizedEvent && response.status === 401 && endpoint === '/api/auth/session';

    throw handleApiError(null, {
      endpoint,
      method,
      status: response.status,
      data,
      silent: isExpectedAnonymousSessionCheck,
    });
  }

  return data;
}

/**
 * Binary request helper (encrypted attachments). Returns an ArrayBuffer.
 *
 * @param {string} endpoint
 * @param {RequestInit} [options]
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchBinary(endpoint, options = {}) {
  const url = `${env.apiUrl}${endpoint}`;
  const method = String(options.method || 'GET').toUpperCase();

  let response;
  try {
    response = await fetch(url, { credentials: 'include', ...options });
  } catch (error) {
    const anyErr = /** @type {any} */ (error);
    const isTimeout = anyErr?.name === 'AbortError' || anyErr?.name === 'TimeoutError';
    throw handleApiError(anyErr, {
      endpoint,
      method,
      status: isTimeout ? 408 : 0,
      code: isTimeout ? API_ERROR_CODES.REQUEST_TIMEOUT : API_ERROR_CODES.NETWORK_ERROR,
    });
  }

  if (!response.ok) {
    let data = null;
    try {
      data = await response.json();
    } catch {
      // Binary/non-JSON error body.
    }
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('api:unauthorized'));
    }
    throw handleApiError(null, {
      endpoint,
      method,
      status: response.status,
      data,
    });
  }

  return response.arrayBuffer();
}

export const api = {
  /**
   * @param {string} path
   * @param {CustomRequestInit} [options]
   */
  get: (path, options = {}) => fetchClient(path, { ...options, method: 'GET' }),

  /**
   * @param {string} path
   * @param {any} [body]
   * @param {CustomRequestInit} [options]
   */
  post: (path, body, options = {}) => fetchClient(path, { ...options, method: 'POST', body }),

  /**
   * @param {string} path
   * @param {any} [body]
   * @param {CustomRequestInit} [options]
   */
  put: (path, body, options = {}) => fetchClient(path, { ...options, method: 'PUT', body }),

  /**
   * Send raw bytes (e.g. encrypted attachment).
   * @param {string} path
   * @param {Blob | ArrayBuffer | Uint8Array} body
   * @param {Record<string, string>} [headers]
   */
  postBinary: (path, body, headers = {}) => {
    const normalizedBody = ArrayBuffer.isView(body)
      ? /** @type {ArrayBuffer} */ (body.buffer)
      : body;
    return fetchBinary(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...headers },
      body: normalizedBody,
    });
  },

  /**
   * Fetch raw bytes.
   * @param {string} path
   */
  getBinary: (path) => fetchBinary(path, { method: 'GET' }),

  /**
   * @param {string} path
   * @param {any} [body]
   * @param {CustomRequestInit} [options]
   */
  patch: (path, body, options = {}) => fetchClient(path, { ...options, method: 'PATCH', body }),

  /**
   * @param {string} path
   * @param {CustomRequestInit} [options]
   */
  delete: (path, options = {}) => fetchClient(path, { ...options, method: 'DELETE' }),
};
