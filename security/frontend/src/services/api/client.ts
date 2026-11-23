import env from '../../config/env.ts';
import { API_ERROR_CODES, ApiError, handleApiError } from '../../lib/errors/apierror.ts';

export { ApiError };

let activeCsrfToken = '';

export function setCsrfToken(token: string | null | undefined): void {
  activeCsrfToken = token ? String(token).trim() : '';
}

export function getCsrfToken(): string {
  return activeCsrfToken;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: any;
  suppressUnauthorizedEvent?: boolean;
}

export function buildQueryString(params: Record<string, any> = {}): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      search.set(k, String(v).trim());
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function fetchClient<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const url = `${env.apiUrl}${endpoint}`;
  const { suppressUnauthorizedEvent = false, ...reqOpts } = options;
  const method = String(reqOpts.method || 'GET').toUpperCase();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((reqOpts.headers as Record<string, string>) || {}),
  };

  if (activeCsrfToken && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    headers['X-CSRF-Token'] = activeCsrfToken;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.apiTimeoutMs);

  const fetchOptions: RequestInit = {
    ...reqOpts,
    method,
    headers,
    credentials: 'include',
    signal: reqOpts.signal || controller.signal,
    body:
      reqOpts.body && typeof reqOpts.body !== 'string'
        ? JSON.stringify(reqOpts.body)
        : reqOpts.body,
  };

  let response: Response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    throw handleApiError(err, {
      endpoint,
      method,
      status: isTimeout ? 408 : 0,
      code: isTimeout ? API_ERROR_CODES.REQUEST_TIMEOUT : API_ERROR_CODES.NETWORK_ERROR,
      silent: suppressUnauthorizedEvent,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  let parsed: any = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      !suppressUnauthorizedEvent &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent('sec:unauthorized'));
    }
    if (response.status === 503 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sec:kill-switch-active'));
    }

    throw handleApiError(null, {
      endpoint,
      method,
      status: response.status,
      data: parsed,
      silent: suppressUnauthorizedEvent && response.status === 401,
    });
  }

  if (parsed && typeof parsed === 'object' && 'data' in parsed && parsed.status === 'success') {
    return parsed.data as T;
  }
  return parsed as T;
}

export const api = {
  get: <T = any>(path: string, options: RequestOptions = {}) =>
    fetchClient<T>(path, { ...options, method: 'GET' }),
  post: <T = any>(path: string, body?: any, options: RequestOptions = {}) =>
    fetchClient<T>(path, { ...options, method: 'POST', body }),
  patch: <T = any>(path: string, body?: any, options: RequestOptions = {}) =>
    fetchClient<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T = any>(path: string, options: RequestOptions = {}) =>
    fetchClient<T>(path, { ...options, method: 'DELETE' }),
};

export default api;

