import { writable, get } from 'svelte/store';
import { listMessages, sendMessage as apiSendMessage, sendReceipt } from '../services/api/messages.api.js';
import { sendEncryptedMessage, markMessageDelivered, markMessageRead } from '../services/socket/client.js';
import { registerSocketListeners } from '../services/socket/handlers.js';
import { decryptMessage } from '../services/crypto/message-crypto.js';
import { conversationsStore } from './conversations.store.js';
import logger from '../lib/logger.js';

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
 * @property {'sending' | 'sent' | 'delivered' | 'read' | 'failed'} [status]
 * @property {string} [client_message_id]
 * @property {string} created_at
 * @property {string} [updated_at]
 * @property {string | null} [deleted_at]
 */

/**
 * Normalise server/socket messages (camelCase) to the shape the UI uses.
 * @param {any} message
 * @param {string} conversationId
 * @returns {any}
 */
function normalizeMessage(message, conversationId) {
  const normalized = {
    ...message,
    conversation_id: message.conversation_id || message.conversationId || conversationId,
    sender_id: message.sender_id || message.senderId,
    body_ciphertext: message.body_ciphertext || message.bodyCiphertext,
    client_message_id: message.client_message_id || message.clientMessageId,
    created_at: message.created_at || message.createdAt,
    updated_at: message.updated_at || message.updatedAt
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
 * @returns {Promise<{ plaintext: string | null, decryptError: boolean }>}
 */
async function decryptPayload(conversationId, ciphertext, nonce) {
  if (!ciphertext || !nonce) {
    return { plaintext: null, decryptError: true };
  }

  try {
    return {
      plaintext: await decryptMessage(conversationId, ciphertext, nonce),
      decryptError: false
    };
  } catch {
    return { plaintext: null, decryptError: true };
  }
}

/**
 * @typedef {Object} MessagesState
 * @property {Record<string, MessageItem[]>} messagesByConversation
 * @property {Record<string, boolean>} loadingByConversation
 * @property {Record<string, string | null>} errorByConversation
 */

/** @type {MessagesState} */
const initialState = {
  messagesByConversation: {},
  loadingByConversation: {},
  errorByConversation: {}
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
      const updated = payload?.message;
      if (updated) {
        messagesStore.handleMessageUpdated(updated);
      }
    },
    onMessageDeleted: (payload) => {
      const messageId = payload?.messageId;
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
        errorByConversation: { ...s.errorByConversation, [conversationId]: null }
      }));

      try {
        const res = await listMessages(conversationId, { limit: 50 });
        const list = Array.isArray(res) ? res : res?.messages || [];

        /** @type {MessageItem[]} */
        const formatted = await Promise.all(
          list.map(async (raw) => {
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
        const error = /** @type {any} */ (err);
        update((s) => ({
          ...s,
          loadingByConversation: { ...s.loadingByConversation, [conversationId]: false },
          errorByConversation: {
            ...s.errorByConversation,
            [conversationId]: error.message || 'Gagal memuat pesan'
          }
        }));
        return [];
      }
    },

    /**
     * Send an encrypted message to a conversation.
     * @param {string} conversationId
     * @param {{
     *   bodyCiphertext: string,
     *   nonce: string,
     *   senderId: string,
     *   senderUsername?: string,
     *   plaintextPreview?: string
     * }} params
     */
    sendMessage: async (conversationId, { bodyCiphertext, nonce, senderId, senderUsername, plaintextPreview }) => {
      if (!conversationId || !bodyCiphertext || !nonce) return null;

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
        plaintext: plaintextPreview || null,
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

        const serverMessage = socketRes?.message;

        if (serverMessage) {
          const confirmed = normalizeMessage(serverMessage, conversationId);
          update((s) => {
            const list = s.messagesByConversation[conversationId] || [];
            const replaced = list.map((m) =>
              m.client_message_id === clientMessageId || m.id === clientMessageId
                ? { ...confirmed, plaintext: plaintextPreview || null, decryptError: false, status: 'sent' }
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

        const confirmed = normalizeMessage(restRes?.message || restRes, conversationId);
        update((s) => {
          const list = s.messagesByConversation[conversationId] || [];
          const replaced = list.map((m) =>
            m.client_message_id === clientMessageId || m.id === clientMessageId
              ? { ...confirmed, plaintext: plaintextPreview || null, decryptError: false, status: 'sent' }
              : m
          );
          return {
            ...s,
            messagesByConversation: { ...s.messagesByConversation, [conversationId]: replaced }
          };
        });

        return confirmed;
      } catch (err) {
        logger.error('Send message failed', err);
        // Mark as failed
        update((s) => {
          const list = s.messagesByConversation[conversationId] || [];
          const failed = list.map((m) =>
            m.client_message_id === clientMessageId || m.id === clientMessageId
              ? { ...m, status: /** @type {MessageItem['status']} */ ('failed') }
              : m
          );
          return {
            ...s,
            messagesByConversation: { ...s.messagesByConversation, [conversationId]: failed }
          };
        });
        throw err;
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
                      ? { ...m, plaintext: null, decryptError: true }
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
      const convId = updatedMessage.conversation_id || updatedMessage.conversationId;
      if (!convId) return;

      const normalized = normalizeMessage(updatedMessage, convId);

      update((s) => {
        const list = s.messagesByConversation[convId] || [];
        const updated = list.map((m) =>
          m.id === normalized.id ? { ...m, ...normalized } : m
        );
        return {
          ...s,
          messagesByConversation: { ...s.messagesByConversation, [convId]: updated }
        };
      });

      if (normalized.id) {
        decryptPayload(convId, normalized.body_ciphertext, normalized.nonce)
          .then((decrypted) => {
            update((s) => {
              const list = s.messagesByConversation[convId] || [];
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
                      ? { ...m, plaintext: null, decryptError: true }
                      : m
                  )
                }
              };
            });
          });
      }
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
     * Handle deleted message.
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
