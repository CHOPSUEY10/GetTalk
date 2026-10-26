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
    'SELECT id, username, email, password_hash, mfa_secret, mfa_enabled, mfa_recovery_codes, mfa_last_totp_step, created_at, updated_at FROM users WHERE email = $1',
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
