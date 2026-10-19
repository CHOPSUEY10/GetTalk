import { connectRedis } from '../config/redis.js';
import AppError from '../errors/AppError.js';
import { TOO_MANY_REQUESTS } from '../errors/error-codes.js';
import logger from '../utils/logger.js';

/**
 * Redis-backed fixed-window rate limiter (issue #13).
 *
 * Counter key: `ratelimit:<name>:<identity>:<window>`
 *   - Authenticated routes identify by user id (not IP alone), so one user
 *     cannot bypass the limit by rotating addresses.
 *   - Unauthenticated routes (login/register) fall back to the client IP.
 *
 * Fail-safe policy: FAIL-OPEN. If Redis is unavailable the request is
 * allowed and the failure is logged, so an outage does not take down auth,
 * messaging, or uploads. This is documented in docs/RATE_LIMITING.md.
 *
 * @param {{ name?: string, limit?: number, windowSeconds?: number }} [options]
 * @returns {import('express').RequestHandler}
 */
export function rateLimiter({ name = 'global', limit = 60, windowSeconds = 60 } = {}) {
  if (!Number.isInteger(limit) || limit <= 0 || !Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    throw new Error('rateLimiter requires a positive integer limit and windowSeconds');
  }

  const windowMs = windowSeconds * 1000;

  return async (req, res, next) => {
    const identity = req.user?.id
      ? `user:${req.user.id}`
      : `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const window = Math.floor(Date.now() / windowMs);
    const key = `ratelimit:${name}:${identity}:${window}`;

    try {
      const redis = await connectRedis();
      const [count, , ttl] = await redis
        .multi()
        .incr(key)
        .expire(key, windowSeconds, 'NX')
        .ttl(key)
        .exec();

      if (count > limit) {
        const retryAfter = Math.max(1, Number(ttl) || windowSeconds);
        res.set('Retry-After', String(retryAfter));
        return next(
          new AppError('Too many requests. Try again later.', 429, TOO_MANY_REQUESTS)
        );
      }

      return next();
    } catch (err) {
      logger.error('Rate limiter unavailable; allowing request (fail-open)', {
        name,
        message: err.message,
      });
      return next();
    }
  };
}
