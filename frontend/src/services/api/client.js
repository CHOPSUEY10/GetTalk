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
 * @typedef {RequestInit & { body?: any }} CustomRequestInit
 */

/**
 * @param {string} endpoint
 * @param {CustomRequestInit} [options]
 * @returns {Promise<any>}
 */
async function fetchClient(endpoint, options = {}) {
  const url = `${env.apiUrl}${endpoint}`;
  
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  /** @type {RequestInit & { body?: any }} */
  const fetchOptions = {
    ...options,
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
    const errorMessage = data?.message || data?.error || response.statusText || 'Unknown API Error';
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('api:unauthorized'));
    }
    throw new ApiError(response.status, errorMessage, data);
  }

  return data;
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
  patch: (path, body, options = {}) => fetchClient(path, { ...options, method: 'PATCH', body }),

  /**
   * @param {string} path
   * @param {CustomRequestInit} [options]
   */
  delete: (path, options = {}) => fetchClient(path, { ...options, method: 'DELETE' }),
};

