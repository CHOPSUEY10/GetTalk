import * as friendsRepo from '../repositories/friends.repository.js';
import * as usersRepo from '../repositories/users.repository.js';
import AppError from '../errors/AppError.js';
import {
  RESOURCE_NOT_FOUND,
  FRIENDSHIP_ALREADY_EXISTS,
  FORBIDDEN,
  USER_NOT_FOUND,
  BAD_REQUEST,
} from '../errors/error-codes.js';

export async function list(userId) {
  return friendsRepo.findAllByUserId(userId);
}

export async function listRequests(userId) {
  return friendsRepo.findPendingRequests(userId);
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

  // Return the new friend info
  const friend = await usersRepo.findById(request.from_user_id);
  return { userId: friend.id, username: friend.username };
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
