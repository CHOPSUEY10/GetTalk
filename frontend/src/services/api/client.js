import env from '../../config/env.js';

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {any} [data]
   */
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

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

  const headers = {
    'Content-Type': 'application/json',
    ...(requestOptions.headers || {}),
  };

  /** @type {RequestInit & { body?: any }} */
  const fetchOptions = {
    ...requestOptions,
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
    // Network error or fetch failure
    throw new Error('Network error or unable to reach the server.');
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  let data = null;
  
  if (isJson) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMessage =
      data?.error?.message ||
      (typeof data?.error === 'string' ? data.error : null) ||
      data?.message ||
      response.statusText ||
      'Unknown API Error';
    if (response.status === 401 && !suppressUnauthorizedEvent) {
      window.dispatchEvent(new CustomEvent('api:unauthorized'));
    }
    throw new ApiError(response.status, errorMessage, data);
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

  let response;
  try {
    response = await fetch(url, { credentials: 'include', ...options });
  } catch {
    throw new Error('Network error or unable to reach the server.');
  }

  if (!response.ok) {
    let message = response.statusText || 'Unknown API Error';
    try {
      const data = await response.json();
      message = data?.error?.message || message;
    } catch {
      // Binary/non-JSON error body.
    }
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('api:unauthorized'));
    }
    throw new ApiError(response.status, message);
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
