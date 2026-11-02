import { resolve, sep } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import env from '../config/env.js';
import * as attachmentsRepo from '../repositories/attachments.repository.js';
import * as messagesRepo from '../repositories/messages.repository.js';
import * as convRepo from '../repositories/conversations.repository.js';
import { getStorageDriver, presignedUrlExpiry } from './storage/index.js';
import { verifyToken } from './storage/signed-token.js';
import AppError from '../errors/AppError.js';
import {
  RESOURCE_NOT_FOUND,
  FORBIDDEN,
  MESSAGE_NOT_FOUND,
  NOT_CONVERSATION_MEMBER,
  VALIDATION_ERROR,
} from '../errors/error-codes.js';

/**
 * Tracks the target `messageId` for a pre-signed upload between `/presign` and
 * `/complete` while `attachments.message_id` remains NULL in PostgreSQL so
 * uncompleted uploads never appear in message history.
 *
 * @type {Map<string, { messageId: string, conversationId: string, expiresAtMs: number }>}
 */
const pendingUploads = new Map();

function prunePendingUploads(now = Date.now()) {
  for (const [id, entry] of pendingUploads.entries()) {
    if (entry.expiresAtMs <= now) {
      pendingUploads.delete(id);
    }
  }
}

function toDto(attachment) {
  return {
    id: attachment.id,
    messageId: attachment.message_id ?? attachment.messageId ?? null,
    sizeBytes:
      attachment.size_bytes !== undefined && attachment.size_bytes !== null
        ? Number(attachment.size_bytes)
        : attachment.sizeBytes !== undefined && attachment.sizeBytes !== null
          ? Number(attachment.sizeBytes)
          : null,
    metadataCiphertext: attachment.metadata_ciphertext ?? attachment.metadataCiphertext,
    metadataNonce: attachment.metadata_nonce ?? attachment.metadataNonce,
    createdAt: attachment.created_at ?? attachment.createdAt,
    // storageKey is NOT returned to client (internal path)
  };
}

/**
 * Verify that `userId` may attach a file to `messageId` (sender + member).
 */
async function verifyUploadTarget(userId, messageId) {
  const message = await messagesRepo.findById(messageId);
  if (!message || message.deleted_at) {
    throw new AppError('Message not found', 404, MESSAGE_NOT_FOUND);
  }

  const isMember = await convRepo.isMember(userId, message.conversation_id);
  if (!isMember) {
    throw new AppError('Not a member of this conversation', 403, NOT_CONVERSATION_MEMBER);
  }

  if (message.sender_id !== userId) {
    throw new AppError("Cannot attach files to another user's message", 403, FORBIDDEN);
  }

  return message;
}

/**
 * Authorization shared by metadata, direct content, and pre-signed download
 * URL reads (issue #14).
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

/**
 * Direct binary upload (`POST /api/attachments`) — kept for backward
 * compatibility and single-step uploads; uses the configured storage driver.
 */
export async function upload(userId, { messageId, metadataCiphertext, metadataNonce, ciphertext }) {
  const message = await verifyUploadTarget(userId, messageId);

  // Opaque, server-generated storage key (never derived from a filename).
  const storageKey = `attachments/${uuidv4()}`;
  const driver = await getStorageDriver();

  await driver.putObject(storageKey, ciphertext);

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
    await driver.deleteObject(storageKey);
    throw err;
  }
}

/**
 * Issue a short-lived pre-signed PUT URL for uploading encrypted bytes
 * (`POST /api/attachments/presign`).
 */
export async function presignUpload(
  userId,
  { messageId, metadataCiphertext, metadataNonce, sizeBytes }
) {
  const message = await verifyUploadTarget(userId, messageId);
  const declaredSize = Number(sizeBytes);

  const storageKey = `attachments/${uuidv4()}`;
  const expiresAt = presignedUrlExpiry();
  const driver = await getStorageDriver();

  // Created with messageId = null until `/complete` confirms the ciphertext
  // landed in object storage.
  const created = await attachmentsRepo.create({
    messageId: null,
    uploaderId: userId,
    storageKey,
    metadataCiphertext,
    metadataNonce,
    sizeBytes: declaredSize,
  });

  prunePendingUploads();
  pendingUploads.set(created.id, {
    messageId,
    conversationId: message.conversation_id,
    expiresAtMs: expiresAt.getTime() + 60_000,
  });

  const uploadTarget = await driver.createUploadUrl({
    attachmentId: created.id,
    storageKey,
    sizeBytes: declaredSize,
    expiresAt,
  });

  return {
    attachment: {
      ...toDto(created),
      messageId,
    },
    upload: {
      url: uploadTarget.url,
      method: uploadTarget.method,
      headers: uploadTarget.headers,
      expiresAt: expiresAt.toISOString(),
    },
    conversationId: message.conversation_id,
  };
}

/**
 * Finalize a pre-signed upload after the client has PUT the ciphertext
 * (`POST /api/attachments/:attachmentId/complete`).
 */
export async function completeUpload(userId, attachmentId, { messageId: bodyMessageId } = {}) {
  const attachment = await attachmentsRepo.findById(attachmentId);
  if (!attachment) {
    throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
  }

  if (attachment.uploader_id !== userId) {
    throw new AppError('Access denied', 403, FORBIDDEN);
  }

  const driver = await getStorageDriver();
  const objectStat = await driver.stat(attachment.storage_key);
  if (!objectStat) {
    throw new AppError(
      'Attachment content has not been uploaded yet',
      400,
      VALIDATION_ERROR
    );
  }

  const expectedSize = Number(attachment.size_bytes);
  if (Number.isFinite(expectedSize) && expectedSize > 0 && objectStat.sizeBytes !== expectedSize) {
    await driver.deleteObject(attachment.storage_key);
    throw new AppError(
      'Uploaded ciphertext size does not match declared sizeBytes',
      400,
      VALIDATION_ERROR
    );
  }

  // Idempotent if already linked to a message.
  if (attachment.message_id) {
    const existingMsg = await messagesRepo.findById(attachment.message_id);
    return {
      attachment: toDto(attachment),
      conversationId: existingMsg?.conversation_id || null,
    };
  }

  const pending = pendingUploads.get(attachmentId);
  const targetMessageId = pending?.messageId || bodyMessageId;
  if (!targetMessageId) {
    throw new AppError('messageId is required to complete upload', 400, VALIDATION_ERROR);
  }

  const message = await verifyUploadTarget(userId, targetMessageId);
  const updated = await attachmentsRepo.attachToMessage(attachmentId, targetMessageId);
  pendingUploads.delete(attachmentId);

  return {
    attachment: toDto(updated),
    conversationId: message.conversation_id,
  };
}

/**
 * Issue a short-lived pre-signed GET URL for downloading an encrypted
 * attachment (`GET /api/attachments/:attachmentId/url`).
 */
export async function getDownloadUrl(userId, attachmentId) {
  const attachment = await loadAuthorized(userId, attachmentId);
  const driver = await getStorageDriver();

  const objectStat = await driver.stat(attachment.storage_key);
  if (!objectStat) {
    throw new AppError('Attachment content not found', 404, RESOURCE_NOT_FOUND);
  }

  const expiresAt = presignedUrlExpiry();
  const { url } = await driver.createDownloadUrl({
    attachmentId: attachment.id,
    storageKey: attachment.storage_key,
    expiresAt,
  });

  return {
    url,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getById(userId, attachmentId) {
  const attachment = await loadAuthorized(userId, attachmentId);
  return toDto(attachment);
}

export async function getContent(userId, attachmentId) {
  const attachment = await loadAuthorized(userId, attachmentId);
  const driver = await getStorageDriver();

  if (driver.name === 'local') {
    const storageRoot = resolve(env.storageDir);
    const filePath = resolve(storageRoot, attachment.storage_key);
    if (!filePath.startsWith(storageRoot + sep)) {
      throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
    }

    const stat = await driver.stat(attachment.storage_key);
    if (!stat) {
      throw new AppError('Attachment content not found', 404, RESOURCE_NOT_FOUND);
    }

    return { filePath };
  }

  const opened = await driver.openRead(attachment.storage_key);
  if (!opened) {
    throw new AppError('Attachment content not found', 404, RESOURCE_NOT_FOUND);
  }

  return { stream: opened.stream, sizeBytes: opened.sizeBytes };
}

export async function remove(userId, attachmentId) {
  const attachment = await attachmentsRepo.findById(attachmentId);
  if (!attachment) {
    throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
  }
  if (attachment.uploader_id !== userId) {
    throw new AppError('Access denied', 403, FORBIDDEN);
  }

  pendingUploads.delete(attachmentId);
  await attachmentsRepo.softDelete(attachmentId);
  const driver = await getStorageDriver();
  await driver.deleteObject(attachment.storage_key);
}

/**
 * Local storage driver pre-signed PUT execution (`PUT /api/storage/:token`).
 */
export async function putWithSignedToken(token, ciphertext) {
  const attachmentId = verifyToken(env.storage.urlSigningSecret, token, 'put');
  if (!attachmentId) {
    throw new AppError('Invalid or expired pre-signed upload URL', 403, FORBIDDEN);
  }

  if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0) {
    throw new AppError(
      'Encrypted attachment body is required (Content-Type: application/octet-stream)',
      400,
      VALIDATION_ERROR
    );
  }

  const attachment = await attachmentsRepo.findById(attachmentId);
  if (!attachment) {
    throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
  }

  const expectedSize = Number(attachment.size_bytes);
  if (Number.isFinite(expectedSize) && expectedSize > 0 && ciphertext.length !== expectedSize) {
    throw new AppError(
      'Uploaded ciphertext size does not match declared sizeBytes',
      400,
      VALIDATION_ERROR
    );
  }

  const driver = await getStorageDriver();
  await driver.putObject(attachment.storage_key, ciphertext);
}

/**
 * Local storage driver pre-signed GET execution (`GET /api/storage/:token`).
 */
export async function getWithSignedToken(token) {
  const attachmentId = verifyToken(env.storage.urlSigningSecret, token, 'get');
  if (!attachmentId) {
    throw new AppError('Invalid or expired pre-signed download URL', 403, FORBIDDEN);
  }

  const attachment = await attachmentsRepo.findById(attachmentId);
  if (!attachment) {
    throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
  }

  const storageRoot = resolve(env.storageDir);
  const filePath = resolve(storageRoot, attachment.storage_key);
  if (!filePath.startsWith(storageRoot + sep)) {
    throw new AppError('Attachment not found', 404, RESOURCE_NOT_FOUND);
  }

  const driver = await getStorageDriver();
  const stat = await driver.stat(attachment.storage_key);
  if (!stat) {
    throw new AppError('Attachment content not found', 404, RESOURCE_NOT_FOUND);
  }

  return { filePath };
}
