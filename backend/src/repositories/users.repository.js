import { query } from '../config/database.js';

export async function findById(id) {
  const result = await query(
    'SELECT id, username, email, password_hash, mfa_secret, mfa_enabled, mfa_recovery_codes, mfa_last_totp_step, created_at, updated_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function findByEmail(email) {
  const result = await query(
    `SELECT id, username, email, password_hash, failed_login_attempts,
            mfa_secret, mfa_enabled, mfa_recovery_codes, mfa_last_totp_step,
            login_locked_until,
            CASE
              WHEN login_locked_until > NOW()
              THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM login_locked_until - NOW()))::integer)
              ELSE 0
            END AS login_lock_remaining_seconds,
            created_at, updated_at
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  return result.rows[0] || null;
}

export async function enableMfa(userId, encryptedSecret, recoveryCodeHashes, totpStep) {
  const result = await query(
    `UPDATE users
     SET mfa_secret = $2, mfa_enabled = TRUE, mfa_recovery_codes = $3,
         mfa_last_totp_step = $4, updated_at = NOW()
     WHERE id = $1 AND mfa_enabled = FALSE`,
    [userId, encryptedSecret, recoveryCodeHashes, totpStep]
  );
  return result.rowCount === 1;
}

export async function disableMfaWithRecoveryCode(userId, recoveryCodeHash) {
  const result = await query(
    `UPDATE users
     SET mfa_secret = NULL, mfa_enabled = FALSE, mfa_recovery_codes = '{}',
         mfa_last_totp_step = -1, updated_at = NOW()
     WHERE id = $1 AND mfa_enabled = TRUE AND $2 = ANY(mfa_recovery_codes)`,
    [userId, recoveryCodeHash]
  );
  return result.rowCount === 1;
}

export async function disableMfaWithTotpStep(userId, totpStep) {
  const result = await query(
    `UPDATE users
     SET mfa_secret = NULL, mfa_enabled = FALSE, mfa_recovery_codes = '{}',
         mfa_last_totp_step = -1, updated_at = NOW()
     WHERE id = $1 AND mfa_enabled = TRUE AND mfa_last_totp_step < $2`,
    [userId, totpStep]
  );
  return result.rowCount === 1;
}

export async function consumeMfaTotpStep(userId, totpStep) {
  const result = await query(
    `UPDATE users
     SET mfa_last_totp_step = $2, updated_at = NOW()
     WHERE id = $1 AND mfa_enabled = TRUE AND mfa_last_totp_step < $2`,
    [userId, totpStep]
  );
  return result.rowCount === 1;
}

export async function consumeMfaRecoveryCode(userId, recoveryCodeHash) {
  const result = await query(
    `UPDATE users
     SET mfa_recovery_codes = array_remove(mfa_recovery_codes, $2), updated_at = NOW()
     WHERE id = $1 AND $2 = ANY(mfa_recovery_codes)`,
    [userId, recoveryCodeHash]
  );
  return result.rowCount === 1;
}

export async function recordFailedLogin(id) {
  const result = await query(
    `UPDATE users
     SET failed_login_attempts = CASE
           WHEN login_locked_until IS NOT NULL AND login_locked_until <= NOW() THEN 1
           ELSE LEAST(failed_login_attempts + 1, 3)
         END,
         login_locked_until = CASE
           WHEN login_locked_until > NOW() THEN login_locked_until
           WHEN login_locked_until IS NOT NULL THEN NULL
           WHEN failed_login_attempts + 1 >= 3 THEN NOW() + INTERVAL '1 minute'
           ELSE NULL
         END
     WHERE id = $1
     RETURNING failed_login_attempts, login_locked_until,
       CASE
         WHEN login_locked_until > NOW()
         THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM login_locked_until - NOW()))::integer)
         ELSE 0
       END AS retry_after_seconds`,
    [id]
  );
  return result.rows[0];
}

export async function resetFailedLogins(id) {
  await query(
    `UPDATE users
     SET failed_login_attempts = 0, login_locked_until = NULL
     WHERE id = $1`,
    [id]
  );
}

export async function findByUsername(username) {
  const result = await query(
    'SELECT id, username, email, created_at FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
}

export async function create({ username, email, passwordHash }) {
  const result = await query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, mfa_enabled, created_at`,
    [username, email, passwordHash]
  );
  return result.rows[0];
}

export async function search(q, limit = 20) {
  const result = await query(
    `SELECT id, username FROM users
     WHERE username ILIKE $1
     ORDER BY username
     LIMIT $2`,
    [`%${q}%`, limit]
  );
  return result.rows;
}

/**
 * Update a user's password hash and clear any login lockout state
 * (used by the password-reset flow).
 *
 * @param {string} id — user id
 * @param {string} passwordHash — new bcrypt hash
 */
export async function updatePasswordHash(id, passwordHash) {
  const result = await query(
    `UPDATE users
     SET password_hash = $2,
         failed_login_attempts = 0,
         login_locked_until = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [id, passwordHash]
  );
  return result.rowCount === 1;
}
