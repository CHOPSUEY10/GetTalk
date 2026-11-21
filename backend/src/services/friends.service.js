import * as friendsRepo from '../repositories/friends.repository.js';
import * as usersRepo from '../repositories/users.repository.js';
import * as usersService from './users.service.js';
import * as presenceService from './presence.service.js';
import AppError from '../errors/AppError.js';
import { buildPage, buildOffsetPage } from '../utils/pagination.js';
import {
  DEFAULT_FRIENDS_LIMIT,
  MAX_FRIENDS_LIMIT,
  DEFAULT_FRIEND_REQUESTS_LIMIT,
  MAX_FRIEND_REQUESTS_LIMIT,
} from '../validators/friends.validator.js';
import {
  RESOURCE_NOT_FOUND,
  FRIENDSHIP_ALREADY_EXISTS,
  FORBIDDEN,
  USER_NOT_FOUND,
  USER_BLOCKED,
  BAD_REQUEST,
} from '../errors/error-codes.js';

/**
 * Hydrate friend DTOs with Redis-backed presence (`isOnline`, `lastSeenAt`)
 * while enforcing reciprocal privacy & block settings.
 *
 * @param {string} viewerId
 * @param {any[]} rows
 */
async function attachFriendsPresence(viewerId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const friendIds = rows.map((r) => r.userId).filter(Boolean);
  const fallbackLastSeenMap = new Map();
  for (const row of rows) {
    if (row.userId) {
      fallbackLastSeenMap.set(row.userId, row.lastSeenAt || null);
    }
  }
  const presenceMap = await presenceService.getPresenceBatch(friendIds, { fallbackLastSeenMap });

  return Promise.all(
    rows.map(async (row) => {
      const visibility = await usersService.getPresenceVisibility(viewerId, row.userId);
      const presence = presenceMap.get(row.userId);
      return {
        userId: row.userId,
        username: row.username,
        nickname: row.nickname || null,
        bio: row.bio || null,
        isOnline: visibility.canViewOnline ? Boolean(presence?.isOnline) : false,
        lastSeenAt: visibility.canViewLastSeen
          ? (presence?.lastSeenAt ?? row.lastSeenAt ?? null)
          : null,
      };
    })
  );
}

/**
 * List accepted friends for a user with offset-based pagination (and optional `after` cursor).
 *
 * @param {string} userId
 * @param {{ limit?: number, offset?: number, after?: string | null }} [options]
 */
export async function list(
  userId,
  { limit = DEFAULT_FRIENDS_LIMIT, offset = 0, after = null } = {}
) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_FRIENDS_LIMIT), MAX_FRIENDS_LIMIT);
  const safeOffset = Math.max(0, Number(offset) || 0);

  if (after) {
    const rows = await friendsRepo.findAllByUserId(userId, {
      limit: safeLimit + 1,
      after,
    });
    const total = rows.total ?? rows.length;
    const { items, nextCursor, hasMore } = buildPage(rows, safeLimit, (row) => row.userId);
    const hydrated = await attachFriendsPresence(userId, items);
    return {
      data: hydrated,
      friends: hydrated,
      nextCursor,
      hasMore,
      pagination: {
        limit: safeLimit,
        offset: safeOffset,
        total,
        hasMore,
        nextCursor,
      },
    };
  }

  const rows = await friendsRepo.findAllByUserId(userId, {
    limit: safeLimit,
    offset: safeOffset,
  });
  const total = rows.total ?? rows.length;
  const hasMore = safeOffset + rows.length < total;
  const nextCursor = hasMore && rows.length > 0 ? rows[rows.length - 1].userId : null;
  const hydrated = await attachFriendsPresence(userId, rows);
  const page = buildOffsetPage(hydrated, {
    limit: safeLimit,
    offset: safeOffset,
    total,
    nextCursor,
  });

  return {
    data: page.items,
    friends: page.items,
    nextCursor,
    hasMore: page.hasMore,
    pagination: page.pagination,
  };
}

/**
 * List pending incoming friend requests for a user (cursor-paginated).
 *
 * @param {string} userId
 * @param {{ limit?: number, before?: string | null }} [options]
 */
export async function listRequests(
  userId,
  { limit = DEFAULT_FRIEND_REQUESTS_LIMIT, before = null } = {}
) {
  const safeLimit = Math.min(
    Math.max(1, Number(limit) || DEFAULT_FRIEND_REQUESTS_LIMIT),
    MAX_FRIEND_REQUESTS_LIMIT
  );
  const rows = await friendsRepo.findPendingRequests(userId, {
    limit: safeLimit + 1,
    before,
  });
  const { items: requests, nextCursor, hasMore, pagination } = buildPage(rows, safeLimit);

  return {
    data: requests,
    requests,
    nextCursor,
    hasMore,
    pagination,
  };
}

export async function sendRequest(fromUserId, toUserId) {
  if (fromUserId === toUserId) {
    throw new AppError('Cannot send friend request to yourself', 400, BAD_REQUEST);
  }

  // Verify target user exists
  const targetUser = await usersRepo.findById(toUserId);
  if (!targetUser) {
    throw new AppError('User not found', 404, USER_NOT_FOUND);
  }

  // Blocked users cannot send or receive friend requests
  const blocked = await usersRepo.isBlockedBetween(fromUserId, toUserId);
  if (blocked) {
    throw new AppError('Cannot send friend request due to block settings', 403, USER_BLOCKED);
  }

  // Check if friendship already exists
  const existing = await friendsRepo.findExisting(fromUserId, toUserId);
  if (existing) {
    throw new AppError('Friendship or request already exists', 409, FRIENDSHIP_ALREADY_EXISTS);
  }

  return friendsRepo.createRequest(fromUserId, toUserId);
}

export async function acceptRequest(userId, requestId) {
  const request = await friendsRepo.findRequestById(requestId);
  if (!request) {
    throw new AppError('Friend request not found', 404, RESOURCE_NOT_FOUND);
  }
  if (request.to_user_id !== userId) {
    throw new AppError('Cannot accept this request', 403, FORBIDDEN);
  }
  if (request.status !== 'pending') {
    throw new AppError('Request is no longer pending', 400, BAD_REQUEST);
  }

  await friendsRepo.updateStatus(requestId, 'accepted');

  // Return the new friend info hydrated with Redis presence
  const friend = await usersRepo.findById(request.from_user_id);
  const [visibility, presence] = await Promise.all([
    usersService.getPresenceVisibility(userId, friend.id),
    presenceService.getPresence(friend.id, { fallbackLastSeenAt: friend.last_seen_at || null }),
  ]);
  return {
    userId: friend.id,
    username: friend.username,
    nickname: friend.nickname || null,
    bio: friend.bio || null,
    isOnline: visibility.canViewOnline ? presence.isOnline : false,
    lastSeenAt: visibility.canViewLastSeen ? presence.lastSeenAt : null,
  };
}

export async function rejectRequest(userId, requestId) {
  const request = await friendsRepo.findRequestById(requestId);
  if (!request) {
    throw new AppError('Friend request not found', 404, RESOURCE_NOT_FOUND);
  }
  if (request.to_user_id !== userId) {
    throw new AppError('Cannot reject this request', 403, FORBIDDEN);
  }
  if (request.status !== 'pending') {
    throw new AppError('Request is no longer pending', 400, BAD_REQUEST);
  }

  await friendsRepo.updateStatus(requestId, 'rejected');
}

export async function remove(userId, friendUserId) {
  const existing = await friendsRepo.findExisting(userId, friendUserId);
  if (!existing || existing.status !== 'accepted') {
    throw new AppError('Friendship not found', 404, RESOURCE_NOT_FOUND);
  }
  await friendsRepo.remove(userId, friendUserId);
}
