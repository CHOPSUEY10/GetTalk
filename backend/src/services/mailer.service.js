import env from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Mailer Service for password reset and notifications.
 */

/** @type {{ to: string, resetUrl: string, token: string, sentAt: Date } | null} */
let lastSentEmail = null;

/**
 * Mask an email address for safe logging.
 * e.g. user@example.com -> u***r@example.com
 * @param {string} email
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * Send password reset email with secure token link.
 * @param {{ email: string, token: string }} param0
 */
export async function sendPasswordResetEmail({ email, token }) {
  const resetUrl = `${env.corsOrigin}/#/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  logger.info('Password reset email dispatched', {
    recipient: maskEmail(email),
  });

  // Store for tests / development inspection
  if (env.nodeEnv !== 'production') {
    lastSentEmail = {
      to: email,
      resetUrl,
      token,
      sentAt: new Date(),
    };
  }

  return { success: true };
}

/**
 * Test helper to retrieve the last sent email.
 */
export function getLastSentEmail() {
  return lastSentEmail;
}

/**
 * Test helper to reset the mailer state.
 */
export function clearLastSentEmail() {
  lastSentEmail = null;
}
