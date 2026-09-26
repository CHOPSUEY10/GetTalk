import * as messagesRepo from '../repositories/messages.repository.js';
import * as convRepo from '../repositories/conversations.repository.js';
import * as receiptsRepo from '../repositories/receipts.repository.js';
import AppError from '../errors/AppError.js';
import {
  FORBIDDEN,
  CONVERSATION_NOT_FOUND,
  MESSAGE_NOT_FOUND,
  NOT_CONVERSATION_MEMBER,
  NOT_MESSAGE_OWNER,
  VALIDATION_ERROR,
} from '../errors/error-codes.js';

export async function list(userId, conversationId, { limit = 50, before } = {}) {
  // Verify membership
  const isMember = await convRepo.isMember(userId, conversationId);
  if (!isMember) {
    throw new AppError('Not a member of this conversation', 403, NOT_CONVERSATION_MEMBER);
  }

  const messages = await messagesRepo.findByConversation(conversationId, { limit, before });

  // Build nextCursor
  const nextCursor = messages.length === limit
    ? messages[messages.length - 1].id
    : null;

  return { messages, nextCursor };
}

export async function create(userId, conversationId, { bodyCiphertext, nonce, clientMessageId }) {
  // Verify membership
  const isMember = await convRepo.isMember(userId, conversationId);
  if (!isMember) {
    throw new AppError('Not a member of this conversation', 403, NOT_CONVERSATION_MEMBER);
  }

  if (!bodyCiphertext || !nonce) {
    throw new AppError('bodyCiphertext and nonce are required', 400, VALIDATION_ERROR);
  }

  const message = await messagesRepo.create({
    conversationId,
    senderId: userId,
    bodyCiphertext,
    nonce,
    clientMessageId,
  });

  // Update conversation timestamp
  await convRepo.updateTimestamp(conversationId);

  return message;
}

export async function update(userId, messageId, { bodyCiphertext, nonce }) {
  const msg = await messagesRepo.findById(messageId);
  if (!msg || msg.deleted_at) {
    throw new AppError('Message not found', 404, MESSAGE_NOT_FOUND);
  }
  if (msg.sender_id !== userId) {
    throw new AppError('Cannot edit another user\'s message', 403, NOT_MESSAGE_OWNER);
  }
  if (!bodyCiphertext || !nonce) {
    throw new AppError('bodyCiphertext and nonce are required', 400, VALIDATION_ERROR);
  }

  return messagesRepo.update(messageId, { bodyCiphertext, nonce });
}

export async function remove(userId, messageId) {
  const msg = await messagesRepo.findById(messageId);
  if (!msg || msg.deleted_at) {
    throw new AppError('Message not found', 404, MESSAGE_NOT_FOUND);
  }
  if (msg.sender_id !== userId) {
    throw new AppError('Cannot delete another user\'s message', 403, NOT_MESSAGE_OWNER);
  }

  await messagesRepo.softDelete(messageId);
}

export async function markReceipt(userId, messageId, status) {
  if (!['delivered', 'read'].includes(status)) {
    throw new AppError('Status must be delivered or read', 400, VALIDATION_ERROR);
  }

  const msg = await messagesRepo.findById(messageId);
  if (!msg) {
    throw new AppError('Message not found', 404, MESSAGE_NOT_FOUND);
  }

  // Verify user is a member of the conversation
  const isMember = await convRepo.isMember(userId, msg.conversation_id);
  if (!isMember) {
    throw new AppError('Not a member of this conversation', 403, NOT_CONVERSATION_MEMBER);
  }

  await receiptsRepo.create({ messageId, userId, status });
}
