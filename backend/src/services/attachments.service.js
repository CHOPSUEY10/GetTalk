import { v4 as uuidv4 } from 'uuid';
import * as attachmentsRepo from '../repositories/attachments.repository.js';
import * as messagesRepo from '../repositories/messages.repository.js';
import * as convRepo from '../repositories/conversations.repository.js';
import AppError from '../errors/AppError.js';
import {
  RESOURCE_NOT_FOUND,
  FORBIDDEN,
  MESSAGE_NOT_FOUND,
  NOT_CONVERSATION_MEMBER,
} from '../errors/error-codes.js';

export async function upload(userId, { messageId, sizeBytes, metadataCiphertext, metadataNonce }) {
  // Issue #14: an upload only exists inside a conversation the user can access.
  const message = await messagesRepo.findById(messageId);
  if (!message || message.deleted_at) {
    throw new AppError('Message not found', 404, MESSAGE_NOT_FOUND);
  }

  const isMember = await convRepo.isMember(userId, message.conversation_id);
  if (!isMember) {
    throw new AppError('Not a member of this conversation', 403, NOT_CONVERSATION_MEMBER);
  }

  if (message.sender_id !== userId) {
    throw new AppError('Cannot attach files to another user\'s message', 403, FORBIDDEN);
  }

  // Generate a safe storage key (never use original filename as path)
  const storageKey = `attachments/${uuidv4()}`;

  return attachmentsRepo.create({
    messageId,
    uploaderId: userId,
    storageKey,
    metadataCiphertext,
    metadataNonce,
    sizeBytes,
  });
}

export async function getById(userId, attachmentId) {
  const attachment = await attachmentsRepo.findById(attachmentId);
  if (!attachment) {
    throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
  }

  let allowed = attachment.uploader_id === userId;

  // Issue #14: members of the attachment's conversation may read it.
  // Legacy rows without a message remain uploader-only.
  if (!allowed && attachment.message_id) {
    const message = await messagesRepo.findById(attachment.message_id);
    if (message && !message.deleted_at) {
      allowed = await convRepo.isMember(userId, message.conversation_id);
    }
  }

  if (!allowed) {
    throw new AppError('Access denied', 403, FORBIDDEN);
  }

  return {
    id: attachment.id,
    messageId: attachment.message_id,
    sizeBytes: attachment.size_bytes,
    metadataCiphertext: attachment.metadata_ciphertext,
    metadataNonce: attachment.metadata_nonce,
    createdAt: attachment.created_at,
    // storageKey is NOT returned to client (internal path)
  };
}

export async function remove(userId, attachmentId) {
  const attachment = await attachmentsRepo.findById(attachmentId);
  if (!attachment) {
    throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
  }
  if (attachment.uploader_id !== userId) {
    throw new AppError('Access denied', 403, FORBIDDEN);
  }

  await attachmentsRepo.softDelete(attachmentId);
}
