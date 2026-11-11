import * as convRepo from '../repositories/conversations.repository.js';
import * as usersRepo from '../repositories/users.repository.js';
import * as usersService from './users.service.js';
import AppError from '../errors/AppError.js';
import { buildPage } from '../utils/pagination.js';
import {
  DEFAULT_CONVERSATIONS_LIMIT,
  MAX_CONVERSATIONS_LIMIT,
} from '../validators/conversations.validator.js';
import {
  CONVERSATION_NOT_FOUND,
  FORBIDDEN,
  USER_NOT_FOUND,
} from '../errors/error-codes.js';

/**
 * @param {string} userId
 * @param {{ limit?: number, before?: string | null }} [options]
 */
export async function list(
  userId,
  { limit = DEFAULT_CONVERSATIONS_LIMIT, before = null } = {}
) {
  const safeLimit = Math.min(
    Math.max(1, Number(limit) || DEFAULT_CONVERSATIONS_LIMIT),
    MAX_CONVERSATIONS_LIMIT
  );

  // Fetch one extra row to know whether another page exists.
  const rows = await convRepo.findAllByUserId(userId, {
    limit: safeLimit + 1,
    before,
  });
  const { items, nextCursor, hasMore, pagination } = buildPage(rows, safeLimit);

  // Explicit DTO; the peer is resolved by the repository query (no N+1).
  const conversations = await Promise.all(
    items.map(async (conv) => {
      if (!conv.peerId) {
        return {
          id: conv.id,
          type: conv.type,
          peer: null,
          lastMessageAt: conv.lastMessageAt,
        };
      }
      const canSeeLastSeen = await usersService.canViewLastSeen(userId, conv.peerId);
      return {
        id: conv.id,
        type: conv.type,
        peer: {
          id: conv.peerId,
          username: conv.peerUsername,
          nickname: conv.peerNickname || null,
          bio: conv.peerBio || null,
          lastSeenAt: canSeeLastSeen ? conv.peerLastSeenAt || null : null,
        },
        lastMessageAt: conv.lastMessageAt,
      };
    })
  );

  return {
    data: conversations,
    conversations,
    nextCursor,
    hasMore,
    pagination,
  };
}

export async function getById(userId, conversationId) {
  const conv = await convRepo.findById(conversationId);
  if (!conv) {
    throw new AppError('Conversation not found', 404, CONVERSATION_NOT_FOUND);
  }

  const member = await convRepo.isMember(userId, conversationId);
  if (!member) {
    throw new AppError('Not a member of this conversation', 403, FORBIDDEN);
  }

  const members = await convRepo.getMembers(conversationId);
  const peer = members.find((m) => m.id !== userId);

  let peerDto = null;
  if (peer) {
    const [canSeeLastSeen, blockStatus] = await Promise.all([
      usersService.canViewLastSeen(userId, peer.id),
      usersRepo.getBlockStatus(userId, peer.id),
    ]);
    peerDto = {
      id: peer.id,
      username: peer.username,
      nickname: peer.nickname || null,
      bio: peer.bio || null,
      lastSeenAt: canSeeLastSeen ? peer.last_seen_at || null : null,
      blockedByMe: blockStatus.blockedByViewer,
      isBlocked: blockStatus.isBlocked,
    };
  }

  return {
    id: conv.id,
    type: conv.type,
    peer: peerDto,
  };
}

export async function create(userId, targetUserId) {
  // Verify target exists
  const target = await usersRepo.findById(targetUserId);
  if (!target) {
    throw new AppError('User not found', 404, USER_NOT_FOUND);
  }

  // Enforce block and privacy rules (whoCanMessage)
  await usersService.assertCanMessageUser(userId, targetUserId);

  // Reuse existing direct conversation
  const existing = await convRepo.findDirectBetween(userId, targetUserId);
  if (existing) {
    const members = await convRepo.getMembers(existing.id);
    const peer = members.find((m) => m.id !== userId);
    const canSeeLastSeen = peer ? await usersService.canViewLastSeen(userId, peer.id) : false;
    return {
      id: existing.id,
      type: existing.type || 'direct',
      peer: peer
        ? {
            id: peer.id,
            username: peer.username,
            nickname: peer.nickname || null,
            bio: peer.bio || null,
            lastSeenAt: canSeeLastSeen ? peer.last_seen_at || null : null,
          }
        : null,
    };
  }

  const conv = await convRepo.create('direct', [userId, targetUserId]);
  const canSeeLastSeen = await usersService.canViewLastSeen(userId, target.id);
  return {
    id: conv.id,
    type: conv.type,
    peer: {
      id: target.id,
      username: target.username,
      nickname: target.nickname || null,
      bio: target.bio || null,
      lastSeenAt: canSeeLastSeen ? target.last_seen_at || null : null,
    },
  };
}
