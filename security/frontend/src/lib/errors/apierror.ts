import logger, { sanitizeString, sanitizeUrl } from '../logger.ts';

export const API_ERROR_CODES = Object.freeze({
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_MFA_CODE: 'INVALID_MFA_CODE',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  SERVER_ERROR: 'SERVER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

const INTERNAL_LEAK_PATTERNS = [
  /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b[\s\S]*?\b(FROM|INTO|TABLE|SET|WHERE)\b/i,
  /\b(postgres|postgresql|pg_hba|pgx|syntax error at or near)\b/i,
  /(\r?\n\s*at\s+[^\r\n]+)/,
  /(?:[a-zA-Z]:\\(?:[^\\\s'"]+\\)+[^\\\s'"]+|\/(?:var|usr|etc|home|opt|srv|tmp|root|proc)\/[^\s'"]+)/,
];

function hasInternalDetails(msg: string): boolean {
  return INTERNAL_LEAK_PATTERNS.some((p) => p.test(msg));
}

export function mapStatusToCode(status: number | null | undefined): string {
  if (!status || status <= 0) return API_ERROR_CODES.NETWORK_ERROR;
  if (status === 400 || status === 422) return API_ERROR_CODES.VALIDATION_ERROR;
  if (status === 401) return API_ERROR_CODES.UNAUTHORIZED;
  if (status === 403) return API_ERROR_CODES.FORBIDDEN;
  if (status === 404) return API_ERROR_CODES.NOT_FOUND;
  if (status === 408) return API_ERROR_CODES.REQUEST_TIMEOUT;
  if (status === 409) return API_ERROR_CODES.CONFLICT;
  if (status === 423) return API_ERROR_CODES.LOGIN_LOCKED;
  if (status === 429) return API_ERROR_CODES.TOO_MANY_REQUESTS;
  if (status === 503) return API_ERROR_CODES.SERVICE_UNAVAILABLE;
  if (status >= 500) return API_ERROR_CODES.SERVER_ERROR;
  return API_ERROR_CODES.UNKNOWN_ERROR;
}

export function defaultUserSafeMessage(code: string, status?: number | null): string {
  switch (code) {
    case API_ERROR_CODES.NETWORK_ERROR:
      return 'Unable to reach the security telemetry backend. Verify network connectivity.';
    case API_ERROR_CODES.REQUEST_TIMEOUT:
      return 'The request timed out. Please try again.';
    case API_ERROR_CODES.INVALID_CREDENTIALS:
      return 'Invalid administrator username or password.';
    case API_ERROR_CODES.INVALID_MFA_CODE:
      return 'Invalid or expired 6-digit MFA verification code.';
    case API_ERROR_CODES.LOGIN_LOCKED:
      return 'Account is temporarily locked due to repeated failed login attempts.';
    case API_ERROR_CODES.UNAUTHORIZED:
      return 'Session expired or authentication required.';
    case API_ERROR_CODES.FORBIDDEN:
      return 'You do not have permission to perform this action.';
    case API_ERROR_CODES.NOT_FOUND:
    case API_ERROR_CODES.RESOURCE_NOT_FOUND:
      return 'Requested resource was not found.';
    case API_ERROR_CODES.CONFLICT:
      return 'Resource conflict: an item with that identifier already exists.';
    case API_ERROR_CODES.TOO_MANY_REQUESTS:
      return 'Rate limit exceeded (429 Too Many Requests). Please wait before retrying.';
    case API_ERROR_CODES.SERVICE_UNAVAILABLE:
      return 'SIEM backend is temporarily disabled by administrator kill switch (503 Service Unavailable).';
    case API_ERROR_CODES.VALIDATION_ERROR:
    case API_ERROR_CODES.BAD_REQUEST:
      return 'Request validation failed. Check your input parameters.';
    default:
      return status && status >= 500
        ? 'An internal server error occurred. Details have been logged securely.'
        : 'Request could not be completed.';
  }
}

export class ApiError extends Error {
  code: string;
  status: number | null;
  endpoint?: string;
  method?: string;

  constructor(opts: {
    code: string;
    status: number | null;
    message: string;
    endpoint?: string;
    method?: string;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.status = opts.status;
    this.endpoint = opts.endpoint ? sanitizeUrl(opts.endpoint) : undefined;
    this.method = opts.method;
  }
}

export function handleApiError(
  error: any,
  context: {
    endpoint?: string;
    method?: string;
    status?: number | null;
    code?: string;
    data?: any;
    silent?: boolean;
  } = {}
): ApiError {
  if (error instanceof ApiError) return error;

  const status = context.status ?? error?.status ?? null;
  const backendCode = context.code || context.data?.error?.code || error?.code;
  const resolvedCode =
    status === 503
      ? API_ERROR_CODES.SERVICE_UNAVAILABLE
      : status && status >= 500
        ? API_ERROR_CODES.SERVER_ERROR
        : backendCode || mapStatusToCode(status);

  const rawMsg =
    context.data?.error?.message ||
    context.data?.message ||
    error?.message ||
    '';

  let safeMessage = defaultUserSafeMessage(resolvedCode, status);
  if (
    rawMsg &&
    typeof rawMsg === 'string' &&
    (!status || status < 500 || status === 503) &&
    !hasInternalDetails(rawMsg)
  ) {
    safeMessage = sanitizeString(rawMsg.trim());
  }

  const normalized = new ApiError({
    code: resolvedCode,
    status,
    message: safeMessage,
    endpoint: context.endpoint,
    method: context.method,
  });

  if (!context.silent) {
    logger.error(`API Error [${normalized.code}]`, {
      status: normalized.status,
      endpoint: normalized.endpoint,
      method: normalized.method,
    });
  }

  return normalized;
}

