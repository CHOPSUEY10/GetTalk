/**
 * Security headers for API responses. The backend does not serve the frontend,
 * so browser-executable content policies remain the frontend's responsibility.
 */
export function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });

  next();
}
