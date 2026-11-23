import { isChatBackendEnabled } from '../services/kill-switch.service.js';
import { SERVICE_UNAVAILABLE } from '../errors/error-codes.js';

const KILL_SWITCH_MESSAGE =
  'GetTalk chat server is temporarily unavailable due to emergency security maintenance.';

/**
 * Express middleware that enforces the Chat Server Kill Switch stored in Upstash Redis.
 * When disabled (`false`), rejects incoming chat API requests with 503 Service Unavailable.
 *
 * @param {{ isEnabled?: () => Promise<boolean> }} [options]
 */
export function createKillSwitchMiddleware(options = {}) {
  const checkEnabled =
    typeof options.isEnabled === 'function' ? options.isEnabled : () => isChatBackendEnabled();

  return async function killSwitchMiddleware(_req, res, next) {
    try {
      const enabled = await checkEnabled();
      if (!enabled) {
        return res.status(503).json({
          error: {
            code: SERVICE_UNAVAILABLE,
            message: KILL_SWITCH_MESSAGE,
          },
        });
      }
      return next();
    } catch {
      return next();
    }
  };
}

export const killSwitchMiddleware = createKillSwitchMiddleware();
export default killSwitchMiddleware;
