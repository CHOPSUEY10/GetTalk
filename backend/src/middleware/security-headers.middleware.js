import helmet from 'helmet';
import env from '../config/env.js';

/**
 * Mengonversi daftar HTTP/HTTPS origin menjadi daftar WebSocket (ws:/wss:) origin
 * agar koneksi Socket.IO dan REST API diizinkan oleh Content-Security-Policy `connect-src`.
 *
 * @param {string[]} origins
 * @returns {string[]}
 */
export function buildConnectSrcDirective(origins = []) {
  const sources = new Set(["'self'", 'ws:', 'wss:']);

  for (const origin of origins) {
    if (typeof origin !== 'string' || !origin.trim()) continue;
    const normalized = origin.trim();
    sources.add(normalized);

    if (normalized.startsWith('http://')) {
      sources.add(normalized.replace(/^http:\/\//i, 'ws://'));
    } else if (normalized.startsWith('https://')) {
      sources.add(normalized.replace(/^https:\/\//i, 'wss://'));
    }
  }

  return Array.from(sources);
}

/**
 * Membuat middleware HTTP Security Headers berbasis `helmet`.
 *
 * Mencakup:
 * - `X-Content-Type-Options: nosniff` (mencegah MIME-sniffing)
 * - `X-Frame-Options: DENY` (mencegah clickjacking via `<iframe>`)
 * - `Strict-Transport-Security` (aktif secara eksplisit pada mode `production`)
 * - `Content-Security-Policy` yang kompatibel dengan Svelte dan WebSocket/Socket.IO
 * - `Referrer-Policy: strict-origin-when-cross-origin`
 * - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
 *
 * @param {{ nodeEnv?: string, corsOrigins?: string[] }} [config]
 */
export function createSecurityHeadersMiddleware(config = env) {
  const nodeEnv = config?.nodeEnv ?? env.nodeEnv;
  const corsOrigins = config?.corsOrigins ?? env.corsOrigins ?? [];
  const isProduction = nodeEnv === 'production';

  const helmetMiddleware = helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: buildConnectSrcDirective(corsOrigins),
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'https:', 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    xContentTypeOptions: true,
    xFrameOptions: { action: 'deny' },
    strictTransportSecurity: isProduction
      ? {
          maxAge: 31_536_000, // 1 tahun
          includeSubDomains: true,
          preload: true,
        }
      : false,
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
  });

  return function securityHeaders(req, res, next) {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()'
    );
    return helmetMiddleware(req, res, next);
  };
}

export const securityHeaders = createSecurityHeadersMiddleware();

export default securityHeaders;
