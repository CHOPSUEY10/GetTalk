import * as usersRepo from '../repositories/users.repository.js';
import AppError from '../errors/AppError.js';
import { buildOffsetPage } from '../utils/pagination.js';
import {
  DEFAULT_USER_SEARCH_LIMIT,
  MAX_USER_SEARCH_LIMIT,
} from '../validators/users.validator.js';
import { USER_NOT_FOUND } from '../errors/error-codes.js';

export async function getMe(userId) {
  const user = await usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, USER_NOT_FOUND);
  return { id: user.id, username: user.username };
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
  const total = rows.total ?? rows.length;
  const page = buildOffsetPage(rows, {
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

export async function getById(userId) {
  const user = await usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, USER_NOT_FOUND);
  return { id: user.id, username: user.username };
}
