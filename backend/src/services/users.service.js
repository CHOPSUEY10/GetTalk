import * as usersRepo from '../repositories/users.repository.js';
import * as friendsRepo from '../repositories/friends.repository.js';
import * as securityEventsRepo from '../repositories/security-events.repository.js';
import AppError from '../errors/AppError.js';
import { buildOffsetPage } from '../utils/pagination.js';
import {
  DEFAULT_USER_SEARCH_LIMIT,
  MAX_USER_SEARCH_LIMIT,
} from '../validators/users.validator.js';
import {
  BAD_REQUEST,
  PRIVACY_RESTRICTED,
  USER_ALREADY_EXISTS,
  USER_BLOCKED,
  USER_NOT_FOUND,
} from '../errors/error-codes.js';

function formatSelfUser(user, privacySettings = null) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    nickname: user.nickname || null,
    bio: user.bio || null,
    lastSeenAt: user.last_seen_at || null,
    mfaEnabled: Boolean(user.mfa_enabled),
    remainingRecoveryCodesCount: Array.isArray(user.mfa_recovery_codes)
      ? user.mfa_recovery_codes.length
      : 0,
    pendingEmail: user.pending_email || null,
    createdAt: user.created_at || null,
    updatedAt: user.updated_at || null,
    ...(privacySettings ? { privacySettings } : {}),
  };
}

/**
 * Evaluate whether `viewerId` is allowed to see `targetId`'s Last Seen timestamp
 * (enforcing block rules and WhatsApp-style reciprocal visibility).
 */
export async function canViewLastSeen(viewerId, targetId) {
  if (!targetId) return false;
  if (!viewerId) return false;
  if (viewerId === targetId) return true;

  const blocked = await usersRepo.isBlockedBetween(viewerId, targetId);
  if (blocked) return false;

  const [viewerPrivacy, targetPrivacy] = await Promise.all([
    usersRepo.getPrivacySettings(viewerId),
    usersRepo.getPrivacySettings(targetId),
  ]);

  if (viewerPrivacy.lastSeenVisibility === 'nobody') return false;
  if (targetPrivacy.lastSeenVisibility === 'nobody') return false;

  if (
    targetPrivacy.lastSeenVisibility === 'friends' ||
    viewerPrivacy.lastSeenVisibility === 'friends'
  ) {
    const friends = await friendsRepo.areFriends(viewerId, targetId);
    if (targetPrivacy.lastSeenVisibility === 'friends' && !friends) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluate whether `viewerId` is allowed to see `targetId`'s Online presence.
 */
export async function canViewOnlineStatus(viewerId, targetId) {
  if (!targetId || !viewerId) return false;
  if (viewerId === targetId) return true;

  const blocked = await usersRepo.isBlockedBetween(viewerId, targetId);
  if (blocked) return false;

  const [viewerPrivacy, targetPrivacy] = await Promise.all([
    usersRepo.getPrivacySettings(viewerId),
    usersRepo.getPrivacySettings(targetId),
  ]);

  if (viewerPrivacy.onlineVisibility === 'nobody') return false;
  if (targetPrivacy.onlineVisibility === 'nobody') return false;

  if (targetPrivacy.onlineVisibility === 'friends') {
    const friends = await friendsRepo.areFriends(viewerId, targetId);
    if (!friends) return false;
  }

  return true;
}

/**
 * Assert that `senderId` is allowed to initiate/send a message to `recipientId`.
 */
export async function assertCanMessageUser(senderId, recipientId) {
  if (!senderId || !recipientId || senderId === recipientId) return;

  const blocked = await usersRepo.isBlockedBetween(senderId, recipientId);
  if (blocked) {
    throw new AppError(
      'Cannot message this user due to block settings',
      403,
      USER_BLOCKED
    );
  }

  const recipientPrivacy = await usersRepo.getPrivacySettings(recipientId);
  if (recipientPrivacy.whoCanMessage === 'friends' || recipientPrivacy.whoCanMessage === 'nobody') {
    const friends = await friendsRepo.areFriends(senderId, recipientId);
    if (!friends || recipientPrivacy.whoCanMessage === 'nobody') {
      throw new AppError(
        'This user only accepts messages from friends',
        403,
        PRIVACY_RESTRICTED
      );
    }
  }
}

/**
 * Evaluate whether read receipts should be recorded/forwarded between `readerId` and `senderId`.
 */
export async function shouldSendReadReceipt(readerId, senderId) {
  if (!readerId || !senderId) return false;
  const blocked = await usersRepo.isBlockedBetween(readerId, senderId);
  if (blocked) return false;

  const [readerPrivacy, senderPrivacy] = await Promise.all([
    usersRepo.getPrivacySettings(readerId),
    usersRepo.getPrivacySettings(senderId),
  ]);

  return Boolean(readerPrivacy.readReceiptsEnabled && senderPrivacy.readReceiptsEnabled);
}

export async function getMe(userId) {
  const user = await usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, USER_NOT_FOUND);
  const privacySettings = await usersRepo.getPrivacySettings(userId);
  return formatSelfUser(user, privacySettings);
}

/**
 * Update the current user's profile (`username`, `nickname`, `bio`).
 */
export async function updateProfile(userId, { username, nickname, bio }, { ipAddress = null } = {}) {
  const user = await usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, USER_NOT_FOUND);

  const patch = {};
  if (username !== undefined) {
    const trimmedUsername = username.trim();
    if (trimmedUsername !== user.username) {
      const existing = await usersRepo.findByUsername(trimmedUsername);
      if (existing && existing.id !== userId) {
        throw new AppError('Username is already taken', 409, USER_ALREADY_EXISTS);
      }
    }
    patch.username = trimmedUsername;
  }

  if (nickname !== undefined) {
    patch.nickname = nickname === null ? null : nickname.trim();
  }

  if (bio !== undefined) {
    patch.bio = bio === null ? null : bio.trim();
  }

  const updated = await usersRepo.updateProfile(userId, patch);
  const privacySettings = await usersRepo.getPrivacySettings(userId);

  await securityEventsRepo.create({
    userId,
    eventType: 'PROFILE_UPDATED',
    ipAddress,
    metadata: { fields: Object.keys(patch) },
  });

  return formatSelfUser(updated, privacySettings);
}

export async function getPrivacySettings(userId) {
  const user = await usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, USER_NOT_FOUND);
  return usersRepo.getPrivacySettings(userId);
}

export async function updatePrivacySettings(userId, patch, { ipAddress = null } = {}) {
  const user = await usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, USER_NOT_FOUND);

  const normalizedPatch = { ...patch };
  if (normalizedPatch.defaultDisappearingTimer !== undefined) {
    normalizedPatch.defaultDisappearingTimer = Number(normalizedPatch.defaultDisappearingTimer);
  }

  const settings = await usersRepo.upsertPrivacySettings(userId, normalizedPatch);

  await securityEventsRepo.create({
    userId,
    eventType: 'PRIVACY_SETTINGS_UPDATED',
    ipAddress,
    metadata: { fields: Object.keys(normalizedPatch) },
  });

  return settings;
}

export async function listBlockedUsers(userId, { limit = 20, offset = 0, after = null } = {}) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const rows = await usersRepo.listBlockedUsers(userId, {
    limit: safeLimit,
    offset: safeOffset,
    after,
  });
  const total = rows.total ?? rows.length;
  const nextCursor =
    safeOffset + rows.length < total && rows.length > 0 ? rows[rows.length - 1].userId : null;
  const page = buildOffsetPage(rows, {
    limit: safeLimit,
    offset: safeOffset,
    total,
    nextCursor,
  });

  return {
    ...page,
    blockedUsers: rows,
  };
}

export async function blockUser(blockerId, targetUserId, { ipAddress = null } = {}) {
  if (!targetUserId || blockerId === targetUserId) {
    throw new AppError('Cannot block yourself', 400, BAD_REQUEST);
  }

  const target = await usersRepo.findById(targetUserId);
  if (!target) {
    throw new AppError('User not found', 404, USER_NOT_FOUND);
  }

  const blockRecord = await usersRepo.blockUser(blockerId, targetUserId);

  await securityEventsRepo.create({
    userId: blockerId,
    eventType: 'USER_BLOCKED',
    ipAddress,
    metadata: { blockedUserId: targetUserId },
  });

  return {
    blocked: true,
    user: {
      id: target.id,
      userId: target.id,
      username: target.username,
      nickname: target.nickname || null,
      bio: target.bio || null,
      blockedAt: blockRecord?.created_at || new Date().toISOString(),
    },
  };
}

export async function unblockUser(blockerId, targetUserId, { ipAddress = null } = {}) {
  if (!targetUserId || blockerId === targetUserId) {
    throw new AppError('Invalid target user', 400, BAD_REQUEST);
  }

  const unblocked = await usersRepo.unblockUser(blockerId, targetUserId);

  if (unblocked) {
    await securityEventsRepo.create({
      userId: blockerId,
      eventType: 'USER_UNBLOCKED',
      ipAddress,
      metadata: { unblockedUserId: targetUserId },
    });
  }

  return {
    blocked: false,
    unblocked,
    userId: targetUserId,
  };
}

/**
 * Search users by username with offset pagination.
 *
 * @param {string} q
 * @param {{ limit?: number, offset?: number }} [options]
 */
export async function search(
  q,
  { limit = DEFAULT_USER_SEARCH_LIMIT, offset = 0 } = {}
) {
  const safeLimit = Math.min(
    Math.max(1, Number(limit) || DEFAULT_USER_SEARCH_LIMIT),
    MAX_USER_SEARCH_LIMIT
  );
  const safeOffset = Math.max(0, Number(offset) || 0);

  if (!q || q.trim().length === 0) {
    const emptyPage = buildOffsetPage([], {
      limit: safeLimit,
      offset: safeOffset,
      total: 0,
    });
    return {
      data: [],
      users: [],
      hasMore: false,
      pagination: emptyPage.pagination,
    };
  }

  const rows = await usersRepo.search(q.trim(), {
    limit: safeLimit,
    offset: safeOffset,
  });
  const formattedRows = rows.map((r) => ({
    id: r.id,
    username: r.username,
    nickname: r.nickname || null,
    bio: r.bio || null,
  }));
  const total = rows.total ?? formattedRows.length;
  const page = buildOffsetPage(formattedRows, {
    limit: safeLimit,
    offset: safeOffset,
    total,
  });

  return {
    data: page.items,
    users: page.items,
    hasMore: page.hasMore,
    pagination: page.pagination,
  };
}

export async function getById(userId, viewerId = null) {
  const user = await usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, USER_NOT_FOUND);

  let lastSeenAt = user.last_seen_at || null;
  let blockStatus = { blockedByViewer: false, blockedByTarget: false, isBlocked: false };

  if (viewerId) {
    const [allowedLastSeen, status] = await Promise.all([
      canViewLastSeen(viewerId, userId),
      usersRepo.getBlockStatus(viewerId, userId),
    ]);
    if (!allowedLastSeen) {
      lastSeenAt = null;
    }
    blockStatus = status;
  }

  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname || null,
    bio: user.bio || null,
    lastSeenAt,
    blockedByMe: blockStatus.blockedByViewer,
    isBlocked: blockStatus.isBlocked,
  };
}
