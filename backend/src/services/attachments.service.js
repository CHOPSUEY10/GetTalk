import { mkdir, writeFile, access, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import env from '../config/env.js';
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

function toDto(attachment) {
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

/**
 * Authorization shared by metadata and content reads (issue #14).
 */
async function loadAuthorized(userId, attachmentId) {
  const attachment = await attachmentsRepo.findById(attachmentId);
  if (!attachment) {
    throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
  }

  let allowed = attachment.uploader_id === userId;

  if (!allowed && attachment.message_id) {
    const message = await messagesRepo.findById(attachment.message_id);
    if (message && !message.deleted_at) {
      allowed = await convRepo.isMember(userId, message.conversation_id);
    }
  }

  if (!allowed) {
    throw new AppError('Access denied', 403, FORBIDDEN);
  }

  return attachment;
}

export async function upload(userId, { messageId, metadataCiphertext, metadataNonce, ciphertext }) {
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

  // Opaque, server-generated storage key (never derived from a filename).
  const storageKey = `attachments/${uuidv4()}`;
  const filePath = resolve(env.storageDir, storageKey);
  const storageRoot = resolve(env.storageDir);

  if (!filePath.startsWith(storageRoot + sep)) {
    throw new AppError('Invalid storage path', 500, 'INTERNAL_ERROR');
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, ciphertext);

  try {
    const attachment = await attachmentsRepo.create({
      messageId,
      uploaderId: userId,
      storageKey,
      metadataCiphertext,
      metadataNonce,
      sizeBytes: ciphertext.length,
    });

    return { attachment, conversationId: message.conversation_id };
  } catch (err) {
    await unlink(filePath).catch(() => {});
    throw err;
  }
}

export async function getById(userId, attachmentId) {
  const attachment = await loadAuthorized(userId, attachmentId);
  return toDto(attachment);
}

export async function getContent(userId, attachmentId) {
  const attachment = await loadAuthorized(userId, attachmentId);

  const storageRoot = resolve(env.storageDir);
  const filePath = resolve(storageRoot, attachment.storage_key);
  if (!filePath.startsWith(storageRoot + sep)) {
    throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
  }

  try {
    await access(filePath);
  } catch {
    // Metadata-only legacy row.
    throw new AppError('Attachment content not found', 404, RESOURCE_NOT_FOUND);
  }

  return { filePath };
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
  await unlink(resolve(env.storageDir, attachment.storage_key)).catch(() => {});
}
