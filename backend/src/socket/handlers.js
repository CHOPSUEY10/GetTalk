import * as events from './events.js';
import * as rooms from './rooms.js';
import {
  handleSocketActive,
  handleSocketInactive,
  getAuthorizedPresenceMap,
} from './presence.js';
import * as messagesService from '../services/messages.service.js';
import * as convRepo from '../repositories/conversations.repository.js';
import * as messagesRepo from '../repositories/messages.repository.js';
import * as usersRepo from '../repositories/users.repository.js';
import { isChatBackendEnabled } from '../services/kill-switch.service.js';
import { SERVICE_UNAVAILABLE } from '../errors/error-codes.js';
import logger from '../utils/logger.js';

/**
 * Socket.IO event handlers (plan §15, rule §20, API contract §11).
 *
 * Each handler verifies authorization through services or repositories
 * and uses the authenticated socket identity (socket.data.user).
 *
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 */
export function registerHandlers(socket, io) {
  const userId = socket.data?.user?.id;
  if (!userId) return;

  // Enforce Chat Server Kill Switch on active WebSocket events as well
  if (typeof socket.use === 'function') {
    socket.use(async (packet, next) => {
      const enabled = await isChatBackendEnabled();
      if (!enabled) {
        const ack = packet?.[packet.length - 1];
        const msg =
          'GetTalk chat server is temporarily unavailable due to emergency security maintenance.';
        if (typeof ack === 'function') {
          ack({ error: msg, code: SERVICE_UNAVAILABLE });
        }
        if (typeof socket.emit === 'function') {
          socket.emit('service:unavailable', { code: SERVICE_UNAVAILABLE, message: msg });
          socket.emit('error', { code: SERVICE_UNAVAILABLE, message: msg });
        }
        const disconnectTimer = setTimeout(() => {
          socket.disconnect(true);
        }, 50);
        if (typeof disconnectTimer?.unref === 'function') {
          disconnectTimer.unref();
        }
        return;
      }
      return next();
    });
  }

  // Automatically join personal user room for targeted notifications
  socket.join(rooms.userRoom(userId));

  // ── Conversation Join / Leave ─────────────────────────────
  socket.on(events.CONVERSATION_JOIN, async (data, callback) => {
    try {
      const conversationId = data?.conversationId;
      if (!conversationId) {
        if (callback) callback({ error: 'conversationId is required' });
        return;
      }

      // Authorize membership
      const isMember = await convRepo.isMember(userId, conversationId);
      if (!isMember) {
        if (callback) callback({ error: 'Forbidden: not a conversation member' });
        return;
      }

      const room = rooms.conversationRoom(conversationId);
      socket.join(room);

      let peerPresence = null;
      try {
        const members = await convRepo.getMembers(conversationId);
        const peer = members.find((m) => m.id !== userId);
        if (peer?.id) {
          const map = await getAuthorizedPresenceMap(userId, [peer.id]);
          const state = map[peer.id];
          if (state) {
            peerPresence = {
              userId: peer.id,
              isOnline: state.isOnline,
              lastSeenAt: state.lastSeenAt,
            };
          }
        }
      } catch {
        // Presence hydration on join is best-effort
      }

      if (callback) callback({ success: true, ...(peerPresence ? { peerPresence } : {}) });
    } catch (err) {
      logger.error('Error in conversation:join', { message: err.message });
      if (callback) callback({ error: 'Failed to join conversation' });
    }
  });

  socket.on(events.CONVERSATION_LEAVE, (data) => {
    const conversationId = data?.conversationId;
    if (conversationId) {
      socket.leave(rooms.conversationRoom(conversationId));
    }
  });

  // ── Messages ──────────────────────────────────────────────
  socket.on(events.MESSAGE_SEND, async (data, callback) => {
    try {
      const { conversationId, bodyCiphertext, nonce, clientMessageId } = data || {};
      if (!conversationId || !bodyCiphertext || !nonce) {
        if (callback) callback({ error: 'Missing required message parameters' });
        return;
      }

      const message = await messagesService.create(userId, conversationId, {
        bodyCiphertext,
        nonce,
        clientMessageId,
      });

      const payload = { message };
      io.to(rooms.conversationRoom(conversationId)).emit(events.MESSAGE_NEW, payload);

      // Notify every member's personal room so hidden conversations reappear in their sidebar.
      const members = await convRepo.getMembers(conversationId);
      if (members.length > 0) {
        let userEmitter = io;
        for (const member of members) {
          userEmitter = userEmitter.to(rooms.userRoom(member.id));
        }
        userEmitter.emit(events.CONVERSATION_UPDATED, {
          conversationId,
          lastMessageAt: message.createdAt || new Date().toISOString(),
        });
      }

      if (callback) callback({ success: true, message });
    } catch (err) {
      logger.error('Error in message:send', { message: err.message });
      if (callback) callback({ error: err.message, code: err.code });
    }
  });

  socket.on(events.MESSAGE_EDIT, async (data, callback) => {
    try {
      const messageId = data?.messageId || data?.message_id;
      const bodyCiphertext = data?.bodyCiphertext || data?.newCiphertext || data?.new_ciphertext;
      const nonce = data?.nonce;

      if (!messageId || !bodyCiphertext || !nonce) {
        if (callback) callback({ error: 'Missing required parameters' });
        return;
      }

      const existing = await messagesRepo.findById(messageId);
      if (!existing) {
        if (callback) callback({ error: 'Message not found' });
        return;
      }

      const message = await messagesService.update(userId, messageId, {
        bodyCiphertext,
        nonce,
      });

      const payload = {
        message,
        messageId: message.id,
        conversationId: existing.conversation_id,
        bodyCiphertext: message.bodyCiphertext,
        nonce: message.nonce,
        updatedAt: message.editedAt,
      };
      io.to(rooms.conversationRoom(existing.conversation_id)).emit(events.MESSAGE_UPDATED, payload);

      if (callback) callback({ success: true, message });
    } catch (err) {
      logger.error('Error in message:edit', { message: err.message });
      if (callback) callback({ error: err.message, code: err.code });
    }
  });

  socket.on(events.MESSAGE_DELETE, async (data, callback) => {
    try {
      const messageId = data?.messageId || data?.message_id;
      if (!messageId) {
        if (callback) callback({ error: 'messageId is required' });
        return;
      }

      const existing = await messagesRepo.findById(messageId);
      if (!existing) {
        if (callback) callback({ error: 'Message not found' });
        return;
      }

      const deleted = await messagesService.remove(userId, messageId);

      io.to(rooms.conversationRoom(existing.conversation_id)).emit(events.MESSAGE_DELETED, {
        messageId: deleted.messageId,
        conversationId: deleted.conversationId,
        deletedAt: deleted.deletedAt,
      });

      if (callback) callback({ success: true, deletedAt: deleted.deletedAt });
    } catch (err) {
      logger.error('Error in message:delete', { message: err.message });
      if (callback) callback({ error: err.message, code: err.code });
    }
  });

  // ── Receipts ──────────────────────────────────────────────
  socket.on(events.MESSAGE_DELIVERED, async (data) => {
    try {
      const messageId = data?.messageId;
      if (!messageId) return;

      const existing = await messagesRepo.findById(messageId);
      if (!existing) return;

      await messagesService.markReceipt(userId, messageId, 'delivered');

      io.to(rooms.conversationRoom(existing.conversation_id)).emit(events.MESSAGE_DELIVERED, {
        messageId,
      });
    } catch (err) {
      logger.error('Error in message:delivered', { message: err.message });
    }
  });

  socket.on(events.MESSAGE_READ, async (data) => {
    try {
      const messageId = data?.messageId;
      if (!messageId) return;

      const existing = await messagesRepo.findById(messageId);
      if (!existing) return;

      const result = await messagesService.markReceipt(userId, messageId, 'read');
      if (result?.suppressed) return;

      io.to(rooms.conversationRoom(existing.conversation_id)).emit(events.MESSAGE_READ, {
        messageId,
      });
    } catch (err) {
      logger.error('Error in message:read', { message: err.message });
    }
  });

  // ── Typing Indicators ─────────────────────────────────────
  socket.on(events.TYPING_START, async (data) => {
    try {
      const conversationId = data?.conversationId;
      if (!conversationId) return;

      const [isMember, privacy] = await Promise.all([
        convRepo.isMember(userId, conversationId),
        usersRepo.getPrivacySettings(userId),
      ]);
      if (!isMember || !privacy.typingIndicatorEnabled) return;

      socket.to(rooms.conversationRoom(conversationId)).emit(events.TYPING_START, {
        conversationId,
        userId,
      });
    } catch (err) {
      logger.error('Error in typing:start', { message: err.message });
    }
  });

  socket.on(events.TYPING_STOP, async (data) => {
    try {
      const conversationId = data?.conversationId;
      if (!conversationId) return;

      const isMember = await convRepo.isMember(userId, conversationId);
      if (!isMember) return;

      socket.to(rooms.conversationRoom(conversationId)).emit(events.TYPING_STOP, {
        conversationId,
        userId,
      });
    } catch (err) {
      logger.error('Error in typing:stop', { message: err.message });
    }
  });

  // ── Presence (Redis-backed active / inactive / heartbeat / sync) ──
  socket.on(events.PRESENCE_UPDATE, async (data, callback) => {
    try {
      if (typeof data?.active !== 'boolean') {
        if (callback) callback({ error: 'active boolean is required' });
        return;
      }

      const result = data.active
        ? await handleSocketActive(io, socket)
        : await handleSocketInactive(io, socket);

      if (callback) {
        callback({
          success: true,
          isOnline: Boolean(result?.isOnline),
          lastSeenAt: result?.lastSeenAt ?? null,
        });
      }
    } catch (err) {
      logger.error('Error in presence:update', { message: err.message });
      if (callback) callback({ error: 'Failed to update presence' });
    }
  });

  socket.on(events.PRESENCE_HEARTBEAT, async (data, callback) => {
    try {
      const result =
        data?.active === false
          ? await handleSocketInactive(io, socket)
          : await handleSocketActive(io, socket);

      if (callback) {
        callback({
          success: true,
          isOnline: Boolean(result?.isOnline),
          lastSeenAt: result?.lastSeenAt ?? null,
        });
      }
    } catch (err) {
      logger.error('Error in presence:heartbeat', { message: err.message });
      if (callback) callback({ error: 'Failed to refresh presence' });
    }
  });

  socket.on(events.PRESENCE_SYNC, async (data, callback) => {
    try {
      const userIds = Array.isArray(data?.userIds) ? data.userIds : [];
      const presence = await getAuthorizedPresenceMap(userId, userIds);
      if (callback) callback({ success: true, presence });
    } catch (err) {
      logger.error('Error in presence:sync', { message: err.message });
      if (callback) callback({ error: 'Failed to sync presence' });
    }
  });
}
