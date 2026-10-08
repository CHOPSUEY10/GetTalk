import { writable, get } from 'svelte/store';
import { listMessages, sendMessage as apiSendMessage, sendReceipt } from '../services/api/messages.api.js';
import { sendEncryptedMessage, markMessageDelivered, markMessageRead } from '../services/socket/client.js';
import { registerSocketListeners } from '../services/socket/handlers.js';
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
 * @property {string} [plaintext]
 * @property {'sending' | 'sent' | 'delivered' | 'read' | 'failed'} [status]
 * @property {string} [client_message_id]
 * @property {string} created_at
 * @property {string} [updated_at]
 * @property {string | null} [deleted_at]
 */

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
    }
  });

  const messagesStore = {
    subscribe,

    /**
     * Load messages history for a conversation from REST API.
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

        // Format and sort messages chronologically
        /** @type {MessageItem[]} */
        const formatted = list.map((m) => ({
          ...m,
          status: /** @type {MessageItem['status']} */ (m.status || 'delivered')
        }));

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
        plaintext: plaintextPreview || bodyCiphertext,
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
          update((s) => {
            const list = s.messagesByConversation[conversationId] || [];
            const replaced = list.map((m) =>
              m.client_message_id === clientMessageId || m.id === clientMessageId
                ? { ...serverMessage, plaintext: plaintextPreview || serverMessage.body_ciphertext, status: 'sent' }
                : m
            );
            return {
              ...s,
              messagesByConversation: { ...s.messagesByConversation, [conversationId]: replaced }
            };
          });
          return serverMessage;
        }

        // Fallback to REST API if socket response did not return message
        const restRes = await apiSendMessage(conversationId, {
          bodyCiphertext,
          nonce,
          clientMessageId
        });

        const confirmed = restRes?.message || restRes;
        update((s) => {
          const list = s.messagesByConversation[conversationId] || [];
          const replaced = list.map((m) =>
            m.client_message_id === clientMessageId || m.id === clientMessageId
              ? { ...confirmed, plaintext: plaintextPreview || confirmed.body_ciphertext, status: 'sent' }
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

      update((s) => {
        const list = s.messagesByConversation[convId] || [];

        // Avoid duplicates (by id or client_message_id)
        const alreadyExists = list.some(
          (m) =>
            m.id === incoming.id ||
            (incoming.client_message_id && m.client_message_id === incoming.client_message_id)
        );

        if (alreadyExists) {
          const updated = list.map((m) =>
            m.id === incoming.id || (incoming.client_message_id && m.client_message_id === incoming.client_message_id)
              ? { ...incoming, plaintext: m.plaintext || incoming.body_ciphertext }
              : m
          );
          return {
            ...s,
            messagesByConversation: { ...s.messagesByConversation, [convId]: updated }
          };
        }

        const newMsg = {
          ...incoming,
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

      conversationsStore.updateLastMessage(convId, incoming);

      // Send delivery receipt back to sender
      if (incoming.id) {
        markMessageDelivered(incoming.id);
      }
    },

    /**
     * Handle updated message (edited).
     * @param {any} updatedMessage
     */
    handleMessageUpdated: (updatedMessage) => {
      const convId = updatedMessage.conversation_id || updatedMessage.conversationId;
      if (!convId) return;

      update((s) => {
        const list = s.messagesByConversation[convId] || [];
        const updated = list.map((m) =>
          m.id === updatedMessage.id ? { ...m, ...updatedMessage } : m
        );
        return {
          ...s,
          messagesByConversation: { ...s.messagesByConversation, [convId]: updated }
        };
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
