import { writable } from 'svelte/store';
import {
  listMessages,
  sendMessage as apiSendMessage,
  updateMessage as apiUpdateMessage,
  deleteMessage as apiDeleteMessage
} from '../services/api/messages.api.js';
import {
  uploadAttachment,
  downloadAttachmentContent
} from '../services/api/attachments.api.js';
import {
  sendEncryptedMessage,
  editEncryptedMessage,
  deleteEncryptedMessage,
  markMessageDelivered
} from '../services/socket/client.js';
import { registerSocketListeners } from '../services/socket/handlers.js';
import { encryptMessage, decryptMessage } from '../services/crypto/message-crypto.js';
import { encryptFile, decryptFile, createDownloadUrl } from '../services/crypto/file-crypto.js';
import { conversationsStore } from './conversations.store.js';
import { validateMessageText, validateAttachmentFile } from '../lib/validators.js';
import { ApiError, API_ERROR_CODES, handleApiError } from '../lib/errors/apierror.js';
import { ENCRYPTION_ERROR_CODES, EncryptionError } from '../lib/errors/encryptionerror.js';
import { PAGE_ERROR_CODES, resolvePageError } from '../lib/errors/pageerror.js';

/**
 * @typedef {Object} MessageItem
 * @property {string} id
 * @property {string} conversation_id
 * @property {string} sender_id
 * @property {string} [sender_username]
 * @property {string} body_ciphertext
 * @property {string} nonce
 * @property {string | null} [plaintext] Decrypted locally; never plaintext from the server
 * @property {boolean} [decryptError]
 * @property {string | null} [errorCode]
 * @property {'sending' | 'sent' | 'delivered' | 'read' | 'failed'} [status]
 * @property {string} [client_message_id]
 * @property {string} created_at
 * @property {string | null} [updated_at]
 * @property {string | null} [edited_at]
 * @property {string | null} [deleted_at]
 * @property {any[]} [attachments]
 */

/**
 * Normalise server/socket messages (camelCase) to the shape the UI uses.
 * @param {any} message
 * @param {string} [conversationId]
 * @returns {any}
 */
function normalizeMessage(message, conversationId) {
  const editedAt =
    message.edited_at ||
    message.editedAt ||
    message.updated_at ||
    message.updatedAt ||
    null;

  const normalized = {
    ...message,
    id: message.id || message.messageId || message.message_id,
    conversation_id: message.conversation_id || message.conversationId || conversationId,
    sender_id: message.sender_id || message.senderId,
    body_ciphertext: message.body_ciphertext || message.bodyCiphertext,
    client_message_id: message.client_message_id || message.clientMessageId,
    created_at: message.created_at || message.createdAt,
    updated_at: editedAt,
    edited_at: editedAt,
    deleted_at: message.deleted_at || message.deletedAt || null
  };

  // Only set when present so an update response does not wipe known attachments.
  if (Array.isArray(message.attachments)) {
    normalized.attachments = message.attachments;
  }

  return normalized;
}

/**
 * Decrypt one payload. Failures never fall back to showing ciphertext as
 * message content.
 * @param {string} conversationId
 * @param {string | undefined} ciphertext
 * @param {string | undefined} nonce
 * @returns {Promise<{ plaintext: string | null, decryptError: boolean, errorCode: string | null }>}
 */
async function decryptPayload(conversationId, ciphertext, nonce) {
  if (!ciphertext || !nonce) {
    return {
      plaintext: null,
      decryptError: true,
      errorCode: ENCRYPTION_ERROR_CODES.INVALID_CIPHERTEXT
    };
  }

  try {
    return {
      plaintext: await decryptMessage(conversationId, ciphertext, nonce),
      decryptError: false,
      errorCode: null
    };
  } catch (err) {
    const anyErr = /** @type {any} */ (err);
    return {
      plaintext: null,
      decryptError: true,
      errorCode: anyErr?.code || ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED
    };
  }
}

/**
 * Helper to create a normalized client-side validation error with a specific page error code.
 * @param {string} pageErrorCode
 * @param {string} technicalMessage
 * @returns {ApiError}
 */
function buildValidationError(pageErrorCode, technicalMessage) {
  const err = new ApiError({
    code: API_ERROR_CODES.VALIDATION_ERROR,
    status: 400,
    message: technicalMessage,
    logged: true
  });
  err.code = pageErrorCode;
  return err;
}

/**
 * @typedef {Object} MessagesState
 * @property {Record<string, MessageItem[]>} messagesByConversation
 * @property {Record<string, boolean>} loadingByConversation
 * @property {Record<string, string | null>} errorByConversation
 * @property {Record<string, string | null>} [errorCodeByConversation]
 */

/** @type {MessagesState} */
const initialState = {
  messagesByConversation: {},
  loadingByConversation: {},
  errorByConversation: {},
  errorCodeByConversation: {}
};

function createMessagesStore() {
  const { subscribe, set, update } = writable(initialState);

  // Bind real-time socket events directly to store mutations
  registerSocketListeners({
    onNewMessage: (payload) => {
      const incoming = payload?.message;
      if (incoming) {
        messagesStore.handleIncomingMessage(incoming);
      }
    },
    onMessageUpdated: (payload) => {
      const updated = payload?.message || payload;
      if (updated && (updated.id || updated.messageId || updated.message_id)) {
        messagesStore.handleMessageUpdated(updated);
      }
    },
    onMessageDeleted: (payload) => {
      const messageId = payload?.messageId || payload?.message_id;
      if (messageId) {
        messagesStore.handleMessageDeleted(messageId);
      }
    },
    onMessageDelivered: (payload) => {
      const messageId = payload?.messageId;
      if (messageId) {
        messagesStore.handleStatusUpdate(messageId, 'delivered');
      }
    },
    onMessageRead: (payload) => {
      const messageId = payload?.messageId;
      if (messageId) {
        messagesStore.handleStatusUpdate(messageId, 'read');
      }
    },
    onAttachmentNew: (payload) => {
      if (payload?.attachment) {
        messagesStore.handleAttachmentNew(payload.attachment);
      }
    }
  });

  const messagesStore = {
    subscribe,

    /**
     * Load messages history for a conversation from REST API and decrypt it.
     * @param {string} conversationId
     */
    loadMessages: async (conversationId) => {
      if (!conversationId) return [];

      update((s) => ({
        ...s,
        loadingByConversation: { ...s.loadingByConversation, [conversationId]: true },
        errorByConversation: { ...s.errorByConversation, [conversationId]: null },
        errorCodeByConversation: { ...(s.errorCodeByConversation || {}), [conversationId]: null }
      }));

      try {
        const res = await listMessages(conversationId, { limit: 50 });
        const list = Array.isArray(res) ? res : res?.messages || [];

        // Backend returns DESC by created_at; display chronologically (oldest -> newest)
        const ordered = [...list].sort(
          (a, b) =>
            new Date(a.created_at || a.createdAt || 0).getTime() -
            new Date(b.created_at || b.createdAt || 0).getTime()
        );

        /** @type {MessageItem[]} */
        const formatted = await Promise.all(
          ordered.map(async (raw) => {
            const message = normalizeMessage(raw, conversationId);
            const decrypted = await decryptPayload(
              conversationId,
              message.body_ciphertext,
              message.nonce
            );
            return {
              ...message,
              ...decrypted,
              status: /** @type {MessageItem['status']} */ (message.status || 'delivered')
            };
          })
        );

        update((s) => ({
          ...s,
          messagesByConversation: {
            ...s.messagesByConversation,
            [conversationId]: formatted
          },
          loadingByConversation: { ...s.loadingByConversation, [conversationId]: false }
        }));

        return formatted;
      } catch (err) {
        const normalized = handleApiError(err, {
          endpoint: '/api/conversations/messages',
          method: 'GET'
        });
        const pageErr = resolvePageError(normalized, {
          context: 'chat',
          fallbackCode: PAGE_ERROR_CODES.MESSAGE_LOAD_FAILED
        });
        update((s) => ({
          ...s,
          loadingByConversation: { ...s.loadingByConversation, [conversationId]: false },
          errorByConversation: {
            ...s.errorByConversation,
            [conversationId]: pageErr.userMessage
          },
          errorCodeByConversation: {
            ...(s.errorCodeByConversation || {}),
            [conversationId]: pageErr.code
          }
        }));
        return [];
      }
    },

    /**
     * Validate (<= 10 KB UTF-8), encrypt locally, and send a message to a conversation
     * (Rule #3, #14, #20, #25, #26).
     *
     * @param {string} conversationId
     * @param {{
     *   plaintext?: string,
     *   bodyCiphertext?: string,
     *   nonce?: string,
     *   senderId?: string,
     *   senderUsername?: string,
     *   plaintextPreview?: string
     * }} params
     */
    sendMessage: async (
      conversationId,
      {
        plaintext,
        bodyCiphertext: preEncryptedCiphertext,
        nonce: preEncryptedNonce,
        senderId = 'me',
        senderUsername = 'Me',
        plaintextPreview
      } = {}
    ) => {
      if (!conversationId) return null;

      let bodyCiphertext = preEncryptedCiphertext;
      let nonce = preEncryptedNonce;
      let resolvedPlaintext = plaintext !== undefined ? plaintext : plaintextPreview;

      if (!bodyCiphertext || !nonce) {
        const validation = validateMessageText(resolvedPlaintext);
        if (!validation.valid) {
          throw buildValidationError(
            validation.code || PAGE_ERROR_CODES.VALIDATION_ERROR,
            validation.code === PAGE_ERROR_CODES.MESSAGE_TOO_LONG
              ? 'Message content exceeds maximum size of 10 KB.'
              : 'Message content cannot be empty.'
          );
        }
        resolvedPlaintext = validation.trimmed;
        const encrypted = await encryptMessage(conversationId, resolvedPlaintext);
        bodyCiphertext = encrypted.bodyCiphertext;
        nonce = encrypted.nonce;
      } else if (resolvedPlaintext !== undefined && resolvedPlaintext !== null) {
        const validation = validateMessageText(resolvedPlaintext);
        if (!validation.valid) {
          throw buildValidationError(
            validation.code || PAGE_ERROR_CODES.VALIDATION_ERROR,
            validation.code === PAGE_ERROR_CODES.MESSAGE_TOO_LONG
              ? 'Message content exceeds maximum size of 10 KB.'
              : 'Message content cannot be empty.'
          );
        }
        resolvedPlaintext = validation.trimmed;
      }

      const clientMessageId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nowIso = new Date().toISOString();

      /** @type {MessageItem} */
      const optimisticMessage = {
        id: clientMessageId,
        conversation_id: conversationId,
        sender_id: senderId,
        sender_username: senderUsername || 'Me',
        body_ciphertext: bodyCiphertext,
        nonce,
        plaintext: resolvedPlaintext || null,
        decryptError: false,
        status: 'sending',
        client_message_id: clientMessageId,
        created_at: nowIso
      };

      // 1. Optimistic update to UI
      update((s) => {
        const currentList = s.messagesByConversation[conversationId] || [];
        return {
          ...s,
          messagesByConversation: {
            ...s.messagesByConversation,
            [conversationId]: [...currentList, optimisticMessage]
          }
        };
      });

      conversationsStore.updateLastMessage(conversationId, optimisticMessage);

      // 2. Transmit via Socket.IO first, fallback to REST API if socket fails
      try {
        const socketRes = await sendEncryptedMessage({
          conversationId,
          bodyCiphertext,
          nonce,
          clientMessageId
        });

        if (socketRes?.error && !socketRes?.disconnected) {
          throw handleApiError(new Error(socketRes.error), {
            code: socketRes.code || API_ERROR_CODES.BAD_REQUEST,
            endpoint: 'socket:message:send',
            method: 'SOCKET'
          });
        }

        const serverMessage = socketRes?.message;

        if (serverMessage) {
          const confirmed = {
            ...normalizeMessage(serverMessage, conversationId),
            plaintext: resolvedPlaintext || null,
            decryptError: false,
            status: /** @type {MessageItem['status']} */ ('sent')
          };
          update((s) => {
            const list = s.messagesByConversation[conversationId] || [];
            const replaced = list.map((m) =>
              m.client_message_id === clientMessageId || m.id === clientMessageId
                ? confirmed
                : m
            );
            return {
              ...s,
              messagesByConversation: { ...s.messagesByConversation, [conversationId]: replaced }
            };
          });
          return confirmed;
        }

        // Fallback to REST API if socket response did not return message
        const restRes = await apiSendMessage(conversationId, {
          bodyCiphertext,
          nonce,
          clientMessageId
        });

        const confirmed = {
          ...normalizeMessage(restRes?.message || restRes, conversationId),
          plaintext: resolvedPlaintext || null,
          decryptError: false,
          status: /** @type {MessageItem['status']} */ ('sent')
        };
        update((s) => {
          const list = s.messagesByConversation[conversationId] || [];
          const replaced = list.map((m) =>
            m.client_message_id === clientMessageId || m.id === clientMessageId
              ? confirmed
              : m
          );
          return {
            ...s,
            messagesByConversation: { ...s.messagesByConversation, [conversationId]: replaced }
          };
        });

        return confirmed;
      } catch (err) {
        const normalized =
          err instanceof EncryptionError
            ? err
            : handleApiError(err, {
              endpoint: '/api/conversations/messages',
              method: 'POST'
            });

        // Mark as failed
        update((s) => {
          const list = s.messagesByConversation[conversationId] || [];
          const failed = list.map((m) =>
            m.client_message_id === clientMessageId || m.id === clientMessageId
              ? {
                ...m,
                status: /** @type {MessageItem['status']} */ ('failed'),
                errorCode: normalized.code
              }
              : m
          );
          return {
            ...s,
            messagesByConversation: { ...s.messagesByConversation, [conversationId]: failed }
          };
        });
        throw normalized;
      }
    },

    /**
     * Validate (< 25 MB, MIME type), encrypt file locally, send owning message,
     * and upload encrypted attachment bytes + metadata (Rule #3, #21, #25, #26).
     *
     * @param {string} conversationId
     * @param {{
     *   file: File,
     *   senderId?: string,
     *   senderUsername?: string
     * }} params
     */
    sendAttachmentMessage: async (
      conversationId,
      { file, senderId = 'me', senderUsername = 'Me' } = /** @type {any} */ ({})
    ) => {
      if (!conversationId) {
        throw buildValidationError(
          PAGE_ERROR_CODES.VALIDATION_ERROR,
          'conversationId is required to send an attachment.'
        );
      }

      const fileValidation = validateAttachmentFile(file);
      if (!fileValidation.valid) {
        throw buildValidationError(
          fileValidation.code || PAGE_ERROR_CODES.FILE_TOO_LARGE,
          fileValidation.code === PAGE_ERROR_CODES.FILE_TOO_LARGE
            ? 'Attachment file exceeds maximum size of 25 MB.'
            : 'Invalid attachment file.'
        );
      }

      // 1. Encrypt file content + metadata client-side
      const encryptedFile = await encryptFile(file, conversationId);

      // 2. Send the owning E2EE message first so the upload is authorized against its messageId
      const sizeStr = (file.size / 1024).toFixed(1);
      const caption = `📎 [Berkas Terenkripsi] ${file.name} (${sizeStr} KB)`;

      const confirmed = await messagesStore.sendMessage(conversationId, {
        plaintext: caption,
        senderId,
        senderUsername
      });

      // 3. Upload encrypted attachment payload
      let uploadedAttachment = null;
      if (confirmed?.id) {
        const uploadRes = await uploadAttachment({
          messageId: confirmed.id,
          metadataCiphertext: encryptedFile.metadataCiphertext,
          metadataNonce: encryptedFile.metadataNonce,
          encryptedBlob: encryptedFile.encryptedBlob
        });
        uploadedAttachment = uploadRes?.attachment || uploadRes || null;
        if (uploadedAttachment?.id) {
          messagesStore.handleAttachmentNew({
            ...uploadedAttachment,
            messageId: uploadedAttachment.messageId || confirmed.id
          });
        }
      }

      return {
        message: confirmed,
        attachment: uploadedAttachment
      };
    },

    /**
     * Download encrypted attachment content, decrypt locally, and trigger browser download
     * (Rule #3, #21, #25).
     *
     * @param {string} conversationId
     * @param {any} attachment
     */
    downloadAttachment: async (conversationId, attachment) => {
      if (!conversationId || !attachment?.id) {
        throw buildValidationError(
          PAGE_ERROR_CODES.VALIDATION_ERROR,
          'conversationId and attachment.id are required to download an attachment.'
        );
      }

      const content = await downloadAttachmentContent(attachment.id);
      const decryptedFile = await decryptFile(
        content,
        conversationId,
        attachment.metadataCiphertext,
        attachment.metadataNonce
      );

      const url = createDownloadUrl(decryptedFile.blob);

      if (typeof document !== 'undefined') {
        const link = document.createElement('a');
        link.href = url;
        link.download = decryptedFile.name || 'attachment';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }

      return {
        ...decryptedFile,
        url
      };
    },

    /**
     * Edit an existing message owned by the current user (FR-11, AC-07, AC-09, Rule #26).
     * Validates plaintext size <= 10 KB and re-encrypts with a fresh AES-GCM nonce.
     *
     * @param {string} conversationId
     * @param {string} messageId
     * @param {{
     *   plaintext?: string,
     *   bodyCiphertext?: string,
     *   nonce?: string,
     *   plaintextPreview?: string
     * }} params
     */
    editMessage: async (conversationId, messageId, params) => {
      if (!conversationId || !messageId) {
        throw new ApiError({
          code: API_ERROR_CODES.VALIDATION_ERROR,
          status: 400,
          message: 'conversationId and messageId are required to edit a message.',
          logged: true
        });
      }

      const normalizedParams =
        typeof params === 'string' ? { plaintext: params } : (params || {});
      let bodyCiphertext = normalizedParams?.bodyCiphertext;
      let nonce = normalizedParams?.nonce;
      const preview = normalizedParams?.plaintextPreview ?? normalizedParams?.plaintext ?? null;

      if (!bodyCiphertext || !nonce) {
        const validation = validateMessageText(normalizedParams?.plaintext);
        if (!validation.valid) {
          throw buildValidationError(
            validation.code || PAGE_ERROR_CODES.EMPTY_MESSAGE,
            validation.code === PAGE_ERROR_CODES.MESSAGE_TOO_LONG
              ? 'Message content exceeds maximum size of 10 KB.'
              : 'Message content cannot be empty.'
          );
        }
        const encrypted = await encryptMessage(conversationId, validation.trimmed);
        bodyCiphertext = encrypted.bodyCiphertext;
        nonce = encrypted.nonce;
      } else if (preview !== null) {
        const validation = validateMessageText(preview);
        if (!validation.valid) {
          throw buildValidationError(
            validation.code || PAGE_ERROR_CODES.EMPTY_MESSAGE,
            validation.code === PAGE_ERROR_CODES.MESSAGE_TOO_LONG
              ? 'Message content exceeds maximum size of 10 KB.'
              : 'Message content cannot be empty.'
          );
        }
      }

      try {
        const socketRes = await editEncryptedMessage({
          messageId,
          bodyCiphertext,
          nonce
        });

        if (socketRes?.error && !socketRes?.disconnected) {
          throw handleApiError(new Error(socketRes.error), {
            code: socketRes.code || API_ERROR_CODES.BAD_REQUEST,
            endpoint: 'socket:message:edit',
            method: 'SOCKET'
          });
        }

        let serverMessage = socketRes?.message;

        if (!serverMessage) {
          const restRes = await apiUpdateMessage(messageId, {
            bodyCiphertext,
            nonce
          });
          serverMessage = restRes?.message || restRes;
        }

        const confirmed = normalizeMessage(
          serverMessage || {
            id: messageId,
            conversationId,
            bodyCiphertext,
            nonce,
            editedAt: new Date().toISOString()
          },
          conversationId
        );

        const editedIso = confirmed.edited_at || new Date().toISOString();

        update((s) => {
          const list = s.messagesByConversation[conversationId] || [];
          const updatedList = list.map((m) =>
            m.id === messageId
              ? {
                ...m,
                ...confirmed,
                plaintext: preview !== null ? preview.trim() : m.plaintext,
                decryptError: false,
                edited_at: editedIso,
                updated_at: editedIso
              }
              : m
          );
          return {
            ...s,
            messagesByConversation: {
              ...s.messagesByConversation,
              [conversationId]: updatedList
            }
          };
        });

        return confirmed;
      } catch (err) {
        if (err instanceof EncryptionError) {
          throw err;
        }
        throw handleApiError(err, {
          endpoint: '/api/messages',
          method: 'PATCH'
        });
      }
    },

    /**
     * Soft-delete an existing message owned by the current user (FR-12, RB-05, AC-08, AC-09).
     *
     * @param {string} conversationId
     * @param {string} messageId
     */
    deleteMessage: async (conversationId, messageId) => {
      if (!conversationId || !messageId) {
        throw new ApiError({
          code: API_ERROR_CODES.VALIDATION_ERROR,
          status: 400,
          message: 'conversationId and messageId are required to delete a message.',
          logged: true
        });
      }

      try {
        const socketRes = await deleteEncryptedMessage({ messageId });

        if (socketRes?.error && !socketRes?.disconnected) {
          throw handleApiError(new Error(socketRes.error), {
            code: socketRes.code || API_ERROR_CODES.BAD_REQUEST,
            endpoint: 'socket:message:delete',
            method: 'SOCKET'
          });
        }

        if (socketRes?.disconnected || !socketRes?.success) {
          await apiDeleteMessage(messageId);
        }

        // Remove from local state so original body is never shown after deletion (RB-05, AC-08)
        messagesStore.handleMessageDeleted(messageId);
      } catch (err) {
        throw handleApiError(err, {
          endpoint: '/api/messages',
          method: 'DELETE'
        });
      }
    },

    /**
     * Handle incoming real-time message from Socket.IO room broadcast.
     * @param {any} incoming
     */
    handleIncomingMessage: (incoming) => {
      const convId = incoming.conversation_id || incoming.conversationId;
      if (!convId) return;

      const normalized = normalizeMessage(incoming, convId);

      update((s) => {
        const list = s.messagesByConversation[convId] || [];

        // Avoid duplicates (by id or client_message_id)
        const alreadyExists = list.some(
          (m) =>
            m.id === normalized.id ||
            (normalized.client_message_id && m.client_message_id === normalized.client_message_id)
        );

        if (alreadyExists) {
          const updated = list.map((m) =>
            m.id === normalized.id ||
              (normalized.client_message_id && m.client_message_id === normalized.client_message_id)
              ? { ...normalized, plaintext: m.plaintext ?? null, decryptError: false }
              : m
          );
          return {
            ...s,
            messagesByConversation: { ...s.messagesByConversation, [convId]: updated }
          };
        }

        const newMsg = {
          ...normalized,
          plaintext: null,
          decryptError: false,
          status: 'delivered'
        };

        return {
          ...s,
          messagesByConversation: {
            ...s.messagesByConversation,
            [convId]: [...list, newMsg]
          }
        };
      });

      conversationsStore.updateLastMessage(convId, normalized);

      // Decrypt asynchronously; the UI shows a placeholder until it resolves.
      if (normalized.id) {
        decryptPayload(convId, normalized.body_ciphertext, normalized.nonce)
          .then((decrypted) => {
            update((s) => {
              const list = s.messagesByConversation[convId] || [];
              if (!list.some((m) => m.id === normalized.id)) return s;
              return {
                ...s,
                messagesByConversation: {
                  ...s.messagesByConversation,
                  [convId]: list.map((m) => (m.id === normalized.id ? { ...m, ...decrypted } : m))
                }
              };
            });
          })
          .catch(() => {
            update((s) => {
              const list = s.messagesByConversation[convId] || [];
              return {
                ...s,
                messagesByConversation: {
                  ...s.messagesByConversation,
                  [convId]: list.map((m) =>
                    m.id === normalized.id
                      ? {
                        ...m,
                        plaintext: null,
                        decryptError: true,
                        errorCode: ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED
                      }
                      : m
                  )
                }
              };
            });
          });

        // Send delivery receipt back to sender
        markMessageDelivered(normalized.id);
      }
    },

    /**
     * Handle updated message (edited).
     * @param {any} updatedMessage
     */
    handleMessageUpdated: (updatedMessage) => {
      const targetId = updatedMessage.id || updatedMessage.messageId || updatedMessage.message_id;
      if (!targetId) return;

      let resolvedConvId = updatedMessage.conversation_id || updatedMessage.conversationId;

      update((s) => {
        if (!resolvedConvId) {
          for (const [cId, list] of Object.entries(s.messagesByConversation)) {
            if (list.some((m) => m.id === targetId)) {
              resolvedConvId = cId;
              break;
            }
          }
        }
        if (!resolvedConvId) return s;

        const normalized = normalizeMessage(updatedMessage, resolvedConvId);
        const editedIso = normalized.edited_at || new Date().toISOString();
        const list = s.messagesByConversation[resolvedConvId] || [];
        const updated = list.map((m) =>
          m.id === targetId
            ? {
              ...m,
              ...normalized,
              edited_at: editedIso,
              updated_at: editedIso
            }
            : m
        );
        return {
          ...s,
          messagesByConversation: { ...s.messagesByConversation, [resolvedConvId]: updated }
        };
      });

      if (!resolvedConvId) return;
      const convId = resolvedConvId;
      const normalized = normalizeMessage(updatedMessage, convId);

      decryptPayload(convId, normalized.body_ciphertext, normalized.nonce)
        .then((decrypted) => {
          update((s) => {
            const list = s.messagesByConversation[convId] || [];
            return {
              ...s,
              messagesByConversation: {
                ...s.messagesByConversation,
                [convId]: list.map((m) => (m.id === targetId ? { ...m, ...decrypted } : m))
              }
            };
          });
        })
        .catch(() => {
          update((s) => {
            const list = s.messagesByConversation[convId] || [];
            return {
              ...s,
              messagesByConversation: {
                ...s.messagesByConversation,
                [convId]: list.map((m) =>
                  m.id === targetId
                    ? {
                      ...m,
                      plaintext: null,
                      decryptError: true,
                      errorCode: ENCRYPTION_ERROR_CODES.DECRYPTION_FAILED
                    }
                    : m
                )
              }
            };
          });
        });
    },

    /**
     * Attach a newly uploaded encrypted file to its message.
     * @param {any} attachment
     */
    handleAttachmentNew: (attachment) => {
      const messageId = attachment?.messageId;
      if (!messageId) return;

      update((s) => {
        /** @type {Record<string, MessageItem[]>} */
        const next = {};
        for (const [convId, list] of Object.entries(s.messagesByConversation)) {
          next[convId] = list.map((m) => {
            if (m.id !== messageId) return m;
            const existing = m.attachments || [];
            return {
              ...m,
              attachments: [
                ...existing.filter((a) => a.id !== attachment.id),
                attachment
              ]
            };
          });
        }
        return { ...s, messagesByConversation: next };
      });
    },

    /**
     * Handle deleted message (RB-05, AC-08).
     * Removes the soft-deleted message so its original body is never displayed.
     * @param {string} messageId
     */
    handleMessageDeleted: (messageId) => {
      update((s) => {
        /** @type {Record<string, MessageItem[]>} */
        const next = {};
        for (const [convId, list] of Object.entries(s.messagesByConversation)) {
          next[convId] = list.filter((m) => m.id !== messageId);
        }
        return { ...s, messagesByConversation: next };
      });
    },

    /**
     * Handle message receipt updates ('delivered' | 'read').
     * @param {string} messageId
     * @param {'delivered' | 'read'} newStatus
     */
    handleStatusUpdate: (messageId, newStatus) => {
      update((s) => {
        /** @type {Record<string, MessageItem[]>} */
        const next = {};
        for (const [convId, list] of Object.entries(s.messagesByConversation)) {
          next[convId] = list.map((m) =>
            m.id === messageId ? { ...m, status: newStatus } : m
          );
        }
        return { ...s, messagesByConversation: next };
      });
    },

    reset: () => {
      set(initialState);
    }
  };

  return messagesStore;
}

export const messagesStore = createMessagesStore();
