import nodemailer from 'nodemailer';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import AppError from '../errors/AppError.js';
import { INTERNAL_ERROR, VALIDATION_ERROR } from '../errors/error-codes.js';

/**
 * Mailer Service for password reset OTP and notifications.
 *
 * Supports:
 *  1. Real SMTP delivery (with IPv4 preference, explicit timeouts, and
 *     automatic port 587 <-> 465 TLS fallback) when SMTP_HOST, SMTP_USER,
 *     and SMTP_PASS are configured.
 *  2. In-memory capture (`getLastSentEmail`) during automated `node --test` runs.
 */

/** @type {{ to: string, verifyUrl: string, resetUrl: string, token: string, sentAt: Date, previewUrl?: string | false, purpose?: string } | null} */
let lastSentEmail = null;

/** @type {import('nodemailer').Transporter | null} */
let cachedTransporter = null;

function isTestRunner() {
  return (
    process.execArgv.includes('--test') ||
    process.argv.includes('--test') ||
    process.env.NODE_TEST_CONTEXT !== undefined
  );
}

/**
 * Mask an email address for safe logging.
 * e.g. user@example.com -> u***r@example.com
 * @param {string} email
 */
export function maskEmail(email) {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * Build a Nodemailer SMTP transporter configured for reliable delivery
 * across Linux VPS environments (forcing IPv4 to avoid unrouted IPv6 blackholes).
 *
 * @param {{ host?: string, port?: number, secure?: boolean }} [overrides]
 */
function createSmtpTransporter({
  host = env.smtpHost,
  port = env.smtpPort,
  secure = env.smtpSecure,
} = {}) {
  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    family: 4,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    dnsTimeout: 5_000,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
    tls: {
      servername: host,
      minVersion: 'TLSv1.2',
    },
  });
}

/**
 * Resolve or initialize the Nodemailer transporter.
 * @returns {Promise<{ transporter: import('nodemailer').Transporter, isEthereal: boolean } | null>}
 */
async function getTransporter() {
  // In automated test runner, always use the in-memory sink instead of external SMTP calls
  if (isTestRunner()) {
    return null;
  }

  if (env.smtpHost && env.smtpUser && env.smtpPass) {
    if (!cachedTransporter) {
      cachedTransporter = createSmtpTransporter();
    }
    return { transporter: cachedTransporter, isEthereal: false };
  }

  logger.error(
    'SMTP_HOST, SMTP_USER, atau SMTP_PASS belum dikonfigurasi di environment',
    {
      nodeEnv: env.nodeEnv,
      hasSmtpHost: Boolean(env.smtpHost),
      hasSmtpUser: Boolean(env.smtpUser),
      hasSmtpPass: Boolean(env.smtpPass),
    }
  );
  throw new AppError(
    'Layanan pengiriman email belum dikonfigurasi',
    500,
    INTERNAL_ERROR
  );
}

/**
 * Send mail through the active SMTP transporter with automatic fallback
 * between STARTTLS (587) and implicit TLS (465) on connection/network errors.
 *
 * @param {import('nodemailer').SendMailOptions} mailOptions
 */
async function sendMailWithFallback(mailOptions) {
  const transportInfo = await getTransporter();
  if (!transportInfo) {
    return null;
  }

  const { transporter } = transportInfo;

  try {
    return await transporter.sendMail(mailOptions);
  } catch (primaryErr) {
    // Invalidate cached transporter so stale/dead sockets are never reused
    cachedTransporter = null;

    const isAuthError =
      primaryErr?.code === 'EAUTH' ||
      primaryErr?.responseCode === 535 ||
      primaryErr?.responseCode === 534;

    if (isAuthError) {
      throw primaryErr;
    }

    const fallbackPort = env.smtpPort === 465 ? 587 : 465;
    const fallbackSecure = fallbackPort === 465;

    logger.warn('Primary SMTP send failed; retrying with alternate TLS port', {
      host: env.smtpHost,
      primaryPort: env.smtpPort,
      fallbackPort,
      error: primaryErr.message,
      code: primaryErr.code,
    });

    const fallbackTransporter = createSmtpTransporter({
      host: env.smtpHost,
      port: fallbackPort,
      secure: fallbackSecure,
    });

    const info = await fallbackTransporter.sendMail(mailOptions);
    cachedTransporter = fallbackTransporter;
    return info;
  }
}

/**
 * Send password reset email with 6-digit OTP.
 * @param {{ email: string, token: string }} param0
 */
export async function sendPasswordResetEmail({ email, token } = {}) {
  const recipient = typeof email === 'string' ? email.trim() : '';
  const otpToken = typeof token === 'string' ? token.trim() : '';

  if (!recipient) {
    throw new AppError('Email penerima wajib diisi', 400, VALIDATION_ERROR);
  }

  if (!otpToken) {
    throw new AppError('Kode OTP wajib diisi', 400, VALIDATION_ERROR);
  }

  const primaryOrigin =
    Array.isArray(env.corsOrigins) && env.corsOrigins.length > 0
      ? env.corsOrigins[0]
      : env.corsOrigin;
  const verifyUrl = `${primaryOrigin}/#/forgot-password/verify?email=${encodeURIComponent(recipient)}`;
  const resetUrl = `${primaryOrigin}/#/reset-password?token=${encodeURIComponent(otpToken)}&email=${encodeURIComponent(recipient)}`;

  // Store in memory for non-production test assertions
  if (env.nodeEnv !== 'production' || isTestRunner()) {
    lastSentEmail = {
      to: recipient,
      verifyUrl,
      resetUrl,
      token: otpToken,
      sentAt: new Date(),
    };
  }

  const isLocalhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(primaryOrigin);
  const hasSmtpUserEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.smtpUser || '');

  try {
    const info = await sendMailWithFallback({
      from: env.smtpFrom,
      to: recipient,
      ...(hasSmtpUserEmail
        ? {
            replyTo: env.smtpUser,
            envelope: {
              from: env.smtpUser,
              to: recipient,
            },
          }
        : {}),
      subject: `${otpToken} adalah kode OTP pemulihan kata sandi GetTalk Anda`,
      text: [
        'Halo,',
        '',
        'Kami menerima permintaan untuk mengatur ulang kata sandi akun GetTalk Anda.',
        `Kode Verifikasi OTP 6-Digit Anda adalah: ${otpToken}`,
        '',
        'Kode ini berlaku selama 15 menit dan hanya dapat digunakan satu kali.',
        'Masukkan 6 digit angka di atas pada halaman Verifikasi Kode OTP di aplikasi GetTalk.',
        '',
        'Jika Anda tidak meminta pengaturan ulang kata sandi, abaikan email ini.',
      ].join('\n'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">Pemulihan Kata Sandi GetTalk</h2>
          <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            Kami menerima permintaan untuk mengatur ulang kata sandi akun GetTalk Anda. Masukkan kode OTP 6-digit berikut pada halaman verifikasi aplikasi:
          </p>
          <div style="margin: 24px 0; padding: 18px; background: #f8fafc; border: 2px dashed #6366f1; border-radius: 10px; text-align: center;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 10px; color: #4f46e5; font-family: monospace;">${otpToken}</span>
          </div>
          <p style="color: #475569; font-size: 13px; line-height: 1.5;">
            Kode ini berlaku selama <strong>15 menit</strong> dan hanya dapat digunakan <strong>1 kali</strong>.
          </p>
          ${
            !isLocalhostOrigin
              ? `<p style="margin-top: 20px;">
                  <a href="${verifyUrl}" style="display: inline-block; padding: 10px 20px; background: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
                    Buka Halaman Verifikasi OTP
                  </a>
                </p>`
              : ''
          }
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
            Jika Anda tidak meminta pengaturan ulang kata sandi, abaikan email ini.
          </p>
        </div>
      `,
    });

    if (info) {
      const acceptedCount = Array.isArray(info.accepted) ? info.accepted.length : 0;
      const rejectedCount = Array.isArray(info.rejected) ? info.rejected.length : 0;

      if (acceptedCount === 0 || rejectedCount > 0) {
        logger.error('SMTP server rejected password reset OTP recipient', {
          recipient: maskEmail(recipient),
          messageId: info.messageId,
          accepted: acceptedCount,
          rejected: rejectedCount,
          response: info.response,
        });
        throw new AppError(
          'Gagal mengirim email kode OTP pemulihan kata sandi',
          500,
          INTERNAL_ERROR
        );
      }

      logger.info('Password reset OTP email dispatched', {
        recipient: maskEmail(recipient),
        transport: 'smtp',
        messageId: info.messageId,
        accepted: acceptedCount,
        rejected: rejectedCount,
      });
    } else {
      logger.info('Password reset OTP email dispatched (in-memory test sink)', {
        recipient: maskEmail(recipient),
      });
    }
  } catch (err) {
    logger.error('Failed to send password reset OTP email via SMTP', {
      recipient: maskEmail(recipient),
      error: err.message,
      code: err.code,
    });

    if (err instanceof AppError) {
      throw err;
    }

    throw new AppError(
      'Gagal mengirim email kode OTP pemulihan kata sandi',
      500,
      INTERNAL_ERROR
    );
  }

  return { success: true };
}

/**
 * Send email change verification OTP to the new email address.
 * @param {{ email: string, token: string }} param0
 */
export async function sendEmailChangeOtp({ email, token } = {}) {
  const recipient = typeof email === 'string' ? email.trim() : '';
  const otpToken = typeof token === 'string' ? token.trim() : '';

  if (!recipient) {
    throw new AppError('Email penerima wajib diisi', 400, VALIDATION_ERROR);
  }

  if (!otpToken) {
    throw new AppError('Kode OTP wajib diisi', 400, VALIDATION_ERROR);
  }

  const primaryOrigin =
    Array.isArray(env.corsOrigins) && env.corsOrigins.length > 0
      ? env.corsOrigins[0]
      : env.corsOrigin;
  const verifyUrl = `${primaryOrigin}/#/settings/profile?email=${encodeURIComponent(recipient)}`;

  if (env.nodeEnv !== 'production' || isTestRunner()) {
    lastSentEmail = {
      to: recipient,
      verifyUrl,
      resetUrl: verifyUrl,
      token: otpToken,
      purpose: 'email_change',
      sentAt: new Date(),
    };
  }

  const hasSmtpUserEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.smtpUser || '');

  try {
    const info = await sendMailWithFallback({
      from: env.smtpFrom,
      to: recipient,
      ...(hasSmtpUserEmail
        ? {
            replyTo: env.smtpUser,
            envelope: {
              from: env.smtpUser,
              to: recipient,
            },
          }
        : {}),
      subject: `${otpToken} adalah kode verifikasi perubahan email GetTalk Anda`,
      text: [
        'Halo,',
        '',
        'Kami menerima permintaan untuk mengubah alamat email akun GetTalk Anda ke alamat ini.',
        `Kode Verifikasi OTP 6-Digit Anda adalah: ${otpToken}`,
        '',
        'Kode ini berlaku selama 15 menit dan hanya dapat digunakan satu kali.',
        '',
        'Jika Anda tidak meminta perubahan alamat email, abaikan email ini.',
      ].join('\n'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">Verifikasi Email Baru GetTalk</h2>
          <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            Masukkan kode OTP 6-digit berikut di halaman Pengaturan Profil GetTalk untuk mengonfirmasi perubahan alamat email Anda:
          </p>
          <div style="margin: 24px 0; padding: 18px; background: #f8fafc; border: 2px dashed #6366f1; border-radius: 10px; text-align: center;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 10px; color: #4f46e5; font-family: monospace;">${otpToken}</span>
          </div>
          <p style="color: #475569; font-size: 13px; line-height: 1.5;">
            Kode ini berlaku selama <strong>15 menit</strong> dan hanya dapat digunakan <strong>1 kali</strong>.
          </p>
        </div>
      `,
    });

    if (info) {
      const acceptedCount = Array.isArray(info.accepted) ? info.accepted.length : 0;
      const rejectedCount = Array.isArray(info.rejected) ? info.rejected.length : 0;

      if (acceptedCount === 0 || rejectedCount > 0) {
        logger.error('SMTP server rejected email change OTP recipient', {
          recipient: maskEmail(recipient),
          messageId: info.messageId,
          accepted: acceptedCount,
          rejected: rejectedCount,
          response: info.response,
        });
        throw new AppError(
          'Gagal mengirim email kode verifikasi perubahan email',
          500,
          INTERNAL_ERROR
        );
      }

      logger.info('Email change OTP dispatched', {
        recipient: maskEmail(recipient),
        transport: 'smtp',
        messageId: info.messageId,
        accepted: acceptedCount,
        rejected: rejectedCount,
      });
    } else {
      logger.info('Email change OTP dispatched (in-memory test sink)', {
        recipient: maskEmail(recipient),
      });
    }
  } catch (err) {
    logger.error('Failed to send email change OTP via SMTP', {
      recipient: maskEmail(recipient),
      error: err.message,
      code: err.code,
    });

    if (err instanceof AppError) {
      throw err;
    }

    throw new AppError(
      'Gagal mengirim email kode verifikasi perubahan email',
      500,
      INTERNAL_ERROR
    );
  }

  return { success: true };
}

/**
 * Send registration email verification OTP (6 digits) to activate a newly registered account.
 * @param {{ email: string, username?: string, token: string }} param0
 */
export async function sendRegistrationVerificationOtp({ email, username = '', token } = {}) {
  const recipient = typeof email === 'string' ? email.trim() : '';
  const otpToken = typeof token === 'string' ? token.trim() : '';
  const safeUsername = typeof username === 'string'
    ? username.trim().replace(/[<>&"']/g, '')
    : '';

  if (!recipient) {
    throw new AppError('Email penerima wajib diisi', 400, VALIDATION_ERROR);
  }

  if (!otpToken) {
    throw new AppError('Kode OTP wajib diisi', 400, VALIDATION_ERROR);
  }

  const primaryOrigin =
    Array.isArray(env.corsOrigins) && env.corsOrigins.length > 0
      ? env.corsOrigins[0]
      : env.corsOrigin;
  const verifyUrl = `${primaryOrigin}/#/register/verify?email=${encodeURIComponent(recipient)}`;

  if (env.nodeEnv !== 'production' || isTestRunner()) {
    lastSentEmail = {
      to: recipient,
      verifyUrl,
      resetUrl: verifyUrl,
      token: otpToken,
      purpose: 'registration_verification',
      sentAt: new Date(),
    };
  }

  const isLocalhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(primaryOrigin);
  const hasSmtpUserEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.smtpUser || '');
  const greeting = safeUsername ? `Halo ${safeUsername},` : 'Halo,';

  try {
    const info = await sendMailWithFallback({
      from: env.smtpFrom,
      to: recipient,
      ...(hasSmtpUserEmail
        ? {
            replyTo: env.smtpUser,
            envelope: {
              from: env.smtpUser,
              to: recipient,
            },
          }
        : {}),
      subject: `${otpToken} adalah kode verifikasi akun GetTalk Anda`,
      text: [
        greeting,
        '',
        'Terima kasih telah mendaftar di GetTalk.',
        `Kode Verifikasi OTP 6-Digit Anda adalah: ${otpToken}`,
        '',
        'Masukkan 6 digit angka di atas pada halaman Verifikasi Email untuk mengaktifkan akun Anda sebelum masuk (login).',
        'Kode ini berlaku selama 15 menit dan hanya dapat digunakan satu kali.',
        '',
        'Jika Anda tidak merasa mendaftar akun GetTalk, abaikan email ini.',
      ].join('\n'),
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">Verifikasi Akun GetTalk</h2>
          <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            ${greeting} Terima kasih telah mendaftar di GetTalk. Masukkan kode OTP 6-digit berikut pada halaman verifikasi untuk mengaktifkan akun Anda sebelum masuk:
          </p>
          <div style="margin: 24px 0; padding: 18px; background: #f8fafc; border: 2px dashed #6366f1; border-radius: 10px; text-align: center;">
            <span style="font-size: 32px; font-weight: 800; letter-spacing: 10px; color: #4f46e5; font-family: monospace;">${otpToken}</span>
          </div>
          <p style="color: #475569; font-size: 13px; line-height: 1.5;">
            Kode ini berlaku selama <strong>15 menit</strong> dan hanya dapat digunakan <strong>1 kali</strong>.
          </p>
          ${
            !isLocalhostOrigin
              ? `<p style="margin-top: 20px;">
                  <a href="${verifyUrl}" style="display: inline-block; padding: 10px 20px; background: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
                    Buka Halaman Verifikasi Email
                  </a>
                </p>`
              : ''
          }
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
            Jika Anda tidak mendaftar akun GetTalk, abaikan email ini.
          </p>
        </div>
      `,
    });

    if (info) {
      const acceptedCount = Array.isArray(info.accepted) ? info.accepted.length : 0;
      const rejectedCount = Array.isArray(info.rejected) ? info.rejected.length : 0;

      if (acceptedCount === 0 || rejectedCount > 0) {
        logger.error('SMTP server rejected registration verification OTP recipient', {
          recipient: maskEmail(recipient),
          messageId: info.messageId,
          accepted: acceptedCount,
          rejected: rejectedCount,
          response: info.response,
        });
        throw new AppError(
          'Gagal mengirim email kode verifikasi akun',
          500,
          INTERNAL_ERROR
        );
      }

      logger.info('Registration verification OTP email dispatched', {
        recipient: maskEmail(recipient),
        transport: 'smtp',
        messageId: info.messageId,
        accepted: acceptedCount,
        rejected: rejectedCount,
      });
    } else {
      logger.info('Registration verification OTP email dispatched (in-memory test sink)', {
        recipient: maskEmail(recipient),
      });
    }
  } catch (err) {
    logger.error('Failed to send registration verification OTP via SMTP', {
      recipient: maskEmail(recipient),
      error: err.message,
      code: err.code,
    });

    if (err instanceof AppError) {
      throw err;
    }

    throw new AppError(
      'Gagal mengirim email kode verifikasi akun',
      500,
      INTERNAL_ERROR
    );
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
