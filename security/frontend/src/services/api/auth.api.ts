import type { AdminUser } from '../../lib/types/telemetry.ts';
import api, { setCsrfToken } from './client.ts';

export interface LoginResponse {
  mfaRequired: boolean;
  challengeId?: string;
  user?: AdminUser;
  csrfToken?: string;
}

export async function loginAdmin(payload: {
  username: string;
  password: string;
}): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>('/api/v1/auth/login', payload, {
    suppressUnauthorizedEvent: true,
  });
  if (res?.csrfToken) {
    setCsrfToken(res.csrfToken);
  }
  return res;
}

export async function verifyAdminMfa(payload: {
  challengeId: string;
  code: string;
}): Promise<{ user: AdminUser; csrfToken: string }> {
  const res = await api.post<{ user: AdminUser; csrfToken: string }>(
    '/api/v1/auth/mfa/verify',
    payload,
    { suppressUnauthorizedEvent: true }
  );
  if (res?.csrfToken) {
    setCsrfToken(res.csrfToken);
  }
  return res;
}

export async function getAdminSession(): Promise<{ user: AdminUser; csrfToken: string }> {
  const res = await api.get<{ user: AdminUser; csrfToken: string }>('/api/v1/auth/session', {
    suppressUnauthorizedEvent: true,
  });
  if (res?.csrfToken) {
    setCsrfToken(res.csrfToken);
  }
  return res;
}

export async function logoutAdmin(): Promise<{ loggedOut: boolean }> {
  const res = await api.post<{ loggedOut: boolean }>('/api/v1/auth/logout');
  setCsrfToken('');
  return res;
}

export async function setupAdminMfa(): Promise<{ secret: string; otpauthUri: string }> {
  return api.post<{ secret: string; otpauthUri: string }>('/api/v1/auth/mfa/setup');
}

export async function enableAdminMfa(code: string): Promise<{ mfaEnabled: boolean }> {
  return api.post<{ mfaEnabled: boolean }>('/api/v1/auth/mfa/enable', { code });
}

