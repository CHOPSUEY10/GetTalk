export type RoutePath =
  | '/'
  | '/network'
  | '/web'
  | '/application'
  | '/events'
  | '/alerts'
  | '/rules'
  | '/audit-logs'
  | '/settings';

export const VALID_ROUTES: Set<string> = new Set([
  '/',
  '/network',
  '/web',
  '/application',
  '/events',
  '/alerts',
  '/rules',
  '/audit-logs',
  '/settings',
]);

export function resolveHashRoute(): RoutePath {
  if (typeof window === 'undefined') return '/';
  const raw = window.location.hash.replace(/^#/, '').split('?')[0] || '/';
  return VALID_ROUTES.has(raw) ? (raw as RoutePath) : '/';
}

