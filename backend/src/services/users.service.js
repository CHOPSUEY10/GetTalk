import * as usersRepo from '../repositories/users.repository.js';
import AppError from '../errors/AppError.js';
import { USER_NOT_FOUND } from '../errors/error-codes.js';

export async function getMe(userId) {
  const user = await usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, USER_NOT_FOUND);
  return { id: user.id, username: user.username };
}

export async function search(q) {
  if (!q || q.trim().length === 0) return [];
  const users = await usersRepo.search(q.trim());
  return users; // already returns { id, username } only
}

export async function getById(userId) {
  const user = await usersRepo.findById(userId);
  if (!user) throw new AppError('User not found', 404, USER_NOT_FOUND);
  return { id: user.id, username: user.username };
}
