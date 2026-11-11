import { query } from '../config/database.js';
import {
  DEFAULT_USER_SEARCH_LIMIT,
  MAX_USER_SEARCH_LIMIT,
} from '../validators/users.validator.js';

export const DEFAULT_PRIVACY_SETTINGS = Object.freeze({
  lastSeenVisibility: 'everyone',
  onlineVisibility: 'everyone',
  readReceiptsEnabled: true,
  typingIndicatorEnabled: true,
  whoCanMessage: 'everyone',
  whoCanAddToGroups: 'everyone',
  defaultDisappearingTimer: 0,
  securityChangeNotifications: true,
});

function mapPrivacyRow(row) {
  if (!row) {
    return { ...DEFAULT_PRIVACY_SETTINGS };
  }
  return {
    lastSeenVisibility: row.last_seen_visibility ?? DEFAULT_PRIVACY_SETTINGS.lastSeenVisibility,
    onlineVisibility: row.online_visibility ?? DEFAULT_PRIVACY_SETTINGS.onlineVisibility,
    readReceiptsEnabled:
      typeof row.read_receipts_enabled === 'boolean'
        ? row.read_receipts_enabled
        : DEFAULT_PRIVACY_SETTINGS.readReceiptsEnabled,
    typingIndicatorEnabled:
      typeof row.typing_indicator_enabled === 'boolean'
        ? row.typing_indicator_enabled
        : DEFAULT_PRIVACY_SETTINGS.typingIndicatorEnabled,
    whoCanMessage: row.who_can_message ?? DEFAULT_PRIVACY_SETTINGS.whoCanMessage,
    whoCanAddToGroups: row.who_can_add_to_groups ?? DEFAULT_PRIVACY_SETTINGS.whoCanAddToGroups,
    defaultDisappearingTimer:
      typeof row.default_disappearing_timer === 'number'
        ? row.default_disappearing_timer
        : DEFAULT_PRIVACY_SETTINGS.defaultDisappearingTimer,
    securityChangeNotifications:
      typeof row.security_change_notifications === 'boolean'
        ? row.security_change_notifications
        : DEFAULT_PRIVACY_SETTINGS.securityChangeNotifications,
    updatedAt: row.updated_at || null,
  };
}

export async function findById(id) {
  const result = await query(
    `SELECT id, username, email, nickname, bio, last_seen_at,
            password_hash, mfa_secret, mfa_enabled, mfa_recovery_codes, mfa_last_totp_step,
            pending_email, email_change_token_hash, email_change_expires_at,
            created_at, updated_at
     FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function findByEmail(email) {
  const result = await query(
    `SELECT id, username, email, nickname, bio, last_seen_at,
            password_hash, failed_login_attempts,
            mfa_secret, mfa_enabled, mfa_recovery_codes, mfa_last_totp_step,
            pending_email, email_change_token_hash, email_change_expires_at,
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
    'SELECT id, username, email, nickname, bio, last_seen_at, created_at FROM users WHERE username = $1',
    [username]
  );
  return result.rows[0] || null;
}

export async function create({ username, email, passwordHash, nickname = null, bio = null }) {
  const result = await query(
    `INSERT INTO users (username, email, password_hash, nickname, bio)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, email, nickname, bio, last_seen_at, mfa_enabled, created_at`,
    [username, email, passwordHash, nickname, bio]
  );
  return result.rows[0];
}

/**
 * Search users by username or nickname prefix/substring with standardized LIMIT / OFFSET pagination.
 *
 * @param {string} q
 * @param {number | { limit?: number, offset?: number }} [optionsOrLimit]
 */
export async function search(q, optionsOrLimit = {}) {
  const rawLimit =
    typeof optionsOrLimit === 'number'
      ? optionsOrLimit
      : (optionsOrLimit?.limit ?? DEFAULT_USER_SEARCH_LIMIT);
  const rawOffset =
    typeof optionsOrLimit === 'object' && optionsOrLimit !== null
      ? (optionsOrLimit.offset ?? 0)
      : 0;

  const limit = Math.min(Math.max(1, Number(rawLimit) || DEFAULT_USER_SEARCH_LIMIT), MAX_USER_SEARCH_LIMIT);
  const offset = Math.max(0, Number(rawOffset) || 0);
  const pattern = `%${q}%`;

  const countRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM users
     WHERE username ILIKE $1 OR COALESCE(nickname, '') ILIKE $1`,
    [pattern]
  );
  const total = countRes.rows[0]?.total ?? 0;

  const result = await query(
    `SELECT id, username, nickname, bio, last_seen_at
     FROM users
     WHERE username ILIKE $1 OR COALESCE(nickname, '') ILIKE $1
     ORDER BY username ASC, id ASC
     LIMIT $2 OFFSET $3`,
    [pattern, limit, offset]
  );

  const rows = result.rows;
  Object.defineProperty(rows, 'total', {
    value: total,
    enumerable: false,
    writable: true,
  });
  return rows;
}

/**
 * Update a user's password hash and clear any login lockout state
 * (used by the password-reset and change-password flows).
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

export async function regenerateMfaRecoveryCodes(userId, recoveryCodeHashes, totpStep) {
  const result = await query(
    `UPDATE users
     SET mfa_recovery_codes = $2,
         mfa_last_totp_step = $3,
         updated_at = NOW()
     WHERE id = $1 AND mfa_enabled = TRUE AND mfa_last_totp_step < $3`,
    [userId, recoveryCodeHashes, totpStep]
  );
  return result.rowCount === 1;
}

export async function updateProfile(userId, { username, nickname, bio }) {
  const sets = [];
  const params = [userId];
  let idx = 2;

  if (username !== undefined) {
    sets.push(`username = $${idx++}`);
    params.push(username);
  }
  if (nickname !== undefined) {
    sets.push(`nickname = $${idx++}`);
    params.push(nickname === '' ? null : nickname);
  }
  if (bio !== undefined) {
    sets.push(`bio = $${idx++}`);
    params.push(bio === '' ? null : bio);
  }

  sets.push('updated_at = NOW()');

  const result = await query(
    `UPDATE users
     SET ${sets.join(', ')}
     WHERE id = $1
     RETURNING id, username, email, nickname, bio, last_seen_at, mfa_enabled, mfa_recovery_codes, created_at, updated_at`,
    params
  );
  return result.rows[0] || null;
}

export async function setPendingEmailChange(userId, { pendingEmail, tokenHash, expiresAt }) {
  const result = await query(
    `UPDATE users
     SET pending_email = $2,
         email_change_token_hash = $3,
         email_change_expires_at = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, pendingEmail, tokenHash, expiresAt]
  );
  return result.rowCount === 1;
}

export async function confirmEmailChange(userId, newEmail) {
  const result = await query(
    `UPDATE users
     SET email = $2,
         pending_email = NULL,
         email_change_token_hash = NULL,
         email_change_expires_at = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, username, email, nickname, bio, last_seen_at, mfa_enabled, mfa_recovery_codes, created_at, updated_at`,
    [userId, newEmail]
  );
  return result.rows[0] || null;
}

export async function updateLastSeen(userId, timestamp = new Date()) {
  await query(
    `UPDATE users
     SET last_seen_at = $2
     WHERE id = $1`,
    [userId, timestamp]
  );
}

export async function getPrivacySettings(userId) {
  const result = await query(
    `SELECT user_id, last_seen_visibility, online_visibility, read_receipts_enabled,
            typing_indicator_enabled, who_can_message, who_can_add_to_groups,
            default_disappearing_timer, security_change_notifications, updated_at
     FROM user_privacy_settings
     WHERE user_id = $1`,
    [userId]
  );
  return mapPrivacyRow(result.rows[0]);
}

export async function upsertPrivacySettings(userId, patch = {}) {
  const current = await getPrivacySettings(userId);
  const next = {
    lastSeenVisibility: patch.lastSeenVisibility ?? current.lastSeenVisibility,
    onlineVisibility: patch.onlineVisibility ?? current.onlineVisibility,
    readReceiptsEnabled:
      typeof patch.readReceiptsEnabled === 'boolean'
        ? patch.readReceiptsEnabled
        : current.readReceiptsEnabled,
    typingIndicatorEnabled:
      typeof patch.typingIndicatorEnabled === 'boolean'
        ? patch.typingIndicatorEnabled
        : current.typingIndicatorEnabled,
    whoCanMessage: patch.whoCanMessage ?? current.whoCanMessage,
    whoCanAddToGroups: patch.whoCanAddToGroups ?? current.whoCanAddToGroups,
    defaultDisappearingTimer:
      typeof patch.defaultDisappearingTimer === 'number'
        ? patch.defaultDisappearingTimer
        : current.defaultDisappearingTimer,
    securityChangeNotifications:
      typeof patch.securityChangeNotifications === 'boolean'
        ? patch.securityChangeNotifications
        : current.securityChangeNotifications,
  };

  const result = await query(
    `INSERT INTO user_privacy_settings (
       user_id, last_seen_visibility, online_visibility, read_receipts_enabled,
       typing_indicator_enabled, who_can_message, who_can_add_to_groups,
       default_disappearing_timer, security_change_notifications, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       last_seen_visibility = EXCLUDED.last_seen_visibility,
       online_visibility = EXCLUDED.online_visibility,
       read_receipts_enabled = EXCLUDED.read_receipts_enabled,
       typing_indicator_enabled = EXCLUDED.typing_indicator_enabled,
       who_can_message = EXCLUDED.who_can_message,
       who_can_add_to_groups = EXCLUDED.who_can_add_to_groups,
       default_disappearing_timer = EXCLUDED.default_disappearing_timer,
       security_change_notifications = EXCLUDED.security_change_notifications,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      next.lastSeenVisibility,
      next.onlineVisibility,
      next.readReceiptsEnabled,
      next.typingIndicatorEnabled,
      next.whoCanMessage,
      next.whoCanAddToGroups,
      next.defaultDisappearingTimer,
      next.securityChangeNotifications,
    ]
  );

  return mapPrivacyRow(result.rows[0]);
}

export async function blockUser(blockerId, blockedId) {
  await query(
    `DELETE FROM friendships
     WHERE (from_user_id = $1 AND to_user_id = $2)
        OR (from_user_id = $2 AND to_user_id = $1)`,
    [blockerId, blockedId]
  );

  const result = await query(
    `INSERT INTO blocked_users (blocker_id, blocked_id)
     VALUES ($1, $2)
     ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET created_at = blocked_users.created_at
     RETURNING blocker_id, blocked_id, created_at`,
    [blockerId, blockedId]
  );
  return result.rows[0];
}

export async function unblockUser(blockerId, blockedId) {
  const result = await query(
    `DELETE FROM blocked_users
     WHERE blocker_id = $1 AND blocked_id = $2`,
    [blockerId, blockedId]
  );
  return result.rowCount > 0;
}

export async function listBlockedUsers(blockerId, { limit = 20, offset = 0, after = null } = {}) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const countRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM blocked_users
     WHERE blocker_id = $1`,
    [blockerId]
  );
  const total = countRes.rows[0]?.total ?? 0;

  let result;
  if (after) {
    result = await query(
      `SELECT b.blocked_id AS id,
              b.blocked_id AS "userId",
              u.username,
              u.nickname,
              u.bio,
              b.created_at AS "blockedAt"
       FROM blocked_users b
       JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = $1
         AND (
           b.created_at < COALESCE((SELECT created_at FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2), NOW())
           OR (
             b.created_at = (SELECT created_at FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2)
             AND b.blocked_id > $2
           )
         )
       ORDER BY b.created_at DESC, b.blocked_id ASC
       LIMIT $3`,
      [blockerId, after, safeLimit]
    );
  } else {
    result = await query(
      `SELECT b.blocked_id AS id,
              b.blocked_id AS "userId",
              u.username,
              u.nickname,
              u.bio,
              b.created_at AS "blockedAt"
       FROM blocked_users b
       JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = $1
       ORDER BY b.created_at DESC, b.blocked_id ASC
       LIMIT $2 OFFSET $3`,
      [blockerId, safeLimit, safeOffset]
    );
  }

  const rows = result.rows.map((r) => ({
    ...r,
    user: {
      id: r.id,
      username: r.username,
      nickname: r.nickname,
      bio: r.bio,
    },
  }));
  Object.defineProperty(rows, 'total', {
    value: total,
    enumerable: false,
    writable: true,
  });
  return rows;
}

export async function getBlockStatus(viewerId, targetId) {
  if (!viewerId || !targetId || viewerId === targetId) {
    return { blockedByViewer: false, blockedByTarget: false, isBlocked: false };
  }
  const result = await query(
    `SELECT blocker_id, blocked_id
     FROM blocked_users
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)`,
    [viewerId, targetId]
  );
  let blockedByViewer = false;
  let blockedByTarget = false;
  for (const row of result.rows) {
    if (row.blocker_id === viewerId && row.blocked_id === targetId) {
      blockedByViewer = true;
    }
    if (row.blocker_id === targetId && row.blocked_id === viewerId) {
      blockedByTarget = true;
    }
  }
  return {
    blockedByViewer,
    blockedByTarget,
    isBlocked: blockedByViewer || blockedByTarget,
  };
}

export async function isBlockedBetween(userA, userB) {
  const status = await getBlockStatus(userA, userB);
  return status.isBlocked;
}
