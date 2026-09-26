import { v4 as uuidv4 } from 'uuid';
import * as attachmentsRepo from '../repositories/attachments.repository.js';
import AppError from '../errors/AppError.js';
import { RESOURCE_NOT_FOUND, FORBIDDEN } from '../errors/error-codes.js';

export async function upload(userId, { originalName, mimeType, sizeBytes, checksum, messageId }) {
  // Generate a safe storage key (never use original filename as path)
  const storageKey = `attachments/${uuidv4()}`;

  const attachment = await attachmentsRepo.create({
    messageId: messageId || null,
    uploaderId: userId,
    storageKey,
    originalName,
    mimeType,
    sizeBytes,
    checksum,
  });

  return attachment;
}

export async function getById(userId, attachmentId) {
  const attachment = await attachmentsRepo.findById(attachmentId);
  if (!attachment) {
    throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
  }

  // TODO: verify access — check conversation membership via message_id
  // For now, only uploader can access
  if (attachment.uploader_id !== userId) {
    throw new AppError('Access denied', 403, FORBIDDEN);
  }

  return {
    id: attachment.id,
    originalName: attachment.original_name,
    mimeType: attachment.mime_type,
    sizeBytes: attachment.size_bytes,
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
