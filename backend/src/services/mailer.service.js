import nodemailer from 'nodemailer';
import env from '../config/env.js';
import logger from '../utils/logger.js';

/**
 * Mailer Service for password reset OTP and notifications.
 *
 * Supports:
 *  1. Real SMTP delivery when SMTP_HOST, SMTP_USER, and SMTP_PASS are configured.
 *  2. Ethereal test inbox preview in development when SMTP is not configured
 *     (outside of automated `node --test` runs).
 *  3. In-memory capture (`getLastSentEmail`) for automated tests.
 */

/** @type {{ to: string, verifyUrl: string, resetUrl: string, token: string, sentAt: Date, previewUrl?: string | false } | null} */
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
function maskEmail(email) {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * Resolve or initialize the Nodemailer transporter.
 * @returns {Promise<{ transporter: import('nodemailer').Transporter, isEthereal: boolean } | null>}
 */
async function getTransporter() {
  if (env.smtpHost && env.smtpUser && env.smtpPass) {
    if (!cachedTransporter) {
      cachedTransporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        auth: {
          user: env.smtpUser,
          pass: env.smtpPass,
        },
      });
    }
    return { transporter: cachedTransporter, isEthereal: false };
  }

  // In automated test runner, skip external SMTP/Ethereal network calls
  if (isTestRunner()) {
    return null;
  }

  // Fallback to Ethereal test account in development when SMTP is not configured
  if (env.nodeEnv !== 'production') {
    try {
      const testAccount = await nodemailer.createTestAccount();
      const etherealTransporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      return { transporter: etherealTransporter, isEthereal: true };
    } catch (err) {
      logger.warn('SMTP belum dikonfigurasi dan gagal membuat akun uji Ethereal', {
        error: err.message,
      });
      return null;
    }
  }

  logger.error('SMTP_HOST, SMTP_USER, atau SMTP_PASS belum dikonfigurasi di environment');
  return null;
}

/**
 * Send password reset email with 6-digit OTP.
 * @param {{ email: string, token: string }} param0
 */
export async function sendPasswordResetEmail({ email, token }) {
  const verifyUrl = `${env.corsOrigin}/#/forgot-password/verify?email=${encodeURIComponent(email)}`;
  const resetUrl = `${env.corsOrigin}/#/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  // Store in memory for non-production test assertions
  if (env.nodeEnv !== 'production') {
    lastSentEmail = {
      to: email,
      verifyUrl,
      resetUrl,
      token,
      sentAt: new Date(),
    };
  }

  const transportInfo = await getTransporter();
  if (transportInfo) {
    const { transporter, isEthereal } = transportInfo;
    const isLocalhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(env.corsOrigin);
    try {
      const info = await transporter.sendMail({
        from: env.smtpFrom,
        to: email,
        subject: `${token} adalah kode OTP pemulihan kata sandi GetTalk Anda`,
        text: [
          'Halo,',
          '',
          'Kami menerima permintaan untuk mengatur ulang kata sandi akun GetTalk Anda.',
          `Kode Verifikasi OTP 6-Digit Anda adalah: ${token}`,
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
              <span style="font-size: 32px; font-weight: 800; letter-spacing: 10px; color: #4f46e5; font-family: monospace;">${token}</span>
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

      const previewUrl = isEthereal ? nodemailer.getTestMessageUrl(info) : false;
      if (lastSentEmail && previewUrl) {
        lastSentEmail.previewUrl = previewUrl;
      }

      logger.info('Password reset OTP email dispatched', {
        recipient: maskEmail(email),
        transport: isEthereal ? 'ethereal-dev-inbox' : 'smtp',
        messageId: info.messageId,
        ...(previewUrl ? { previewUrl } : {}),
      });
    } catch (err) {
      logger.error('Failed to send password reset OTP email via SMTP', {
        recipient: maskEmail(email),
        error: err.message,
      });
    }
  } else {
    logger.info('Password reset OTP email dispatched (in-memory test sink)', {
      recipient: maskEmail(email),
    });
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
