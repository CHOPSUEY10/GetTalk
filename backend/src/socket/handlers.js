import * as events from './events.js';
import * as rooms from './rooms.js';
import * as messagesService from '../services/messages.service.js';
import * as convRepo from '../repositories/conversations.repository.js';
import * as messagesRepo from '../repositories/messages.repository.js';
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
      if (callback) callback({ success: true });
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

      if (callback) callback({ success: true, message });
    } catch (err) {
      logger.error('Error in message:send', { message: err.message });
      if (callback) callback({ error: err.message, code: err.code });
    }
  });

  socket.on(events.MESSAGE_EDIT, async (data, callback) => {
    try {
      const { messageId, bodyCiphertext, nonce } = data || {};
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

      const payload = { message };
      io.to(rooms.conversationRoom(existing.conversation_id)).emit(events.MESSAGE_UPDATED, payload);

      if (callback) callback({ success: true, message });
    } catch (err) {
      logger.error('Error in message:edit', { message: err.message });
      if (callback) callback({ error: err.message, code: err.code });
    }
  });

  socket.on(events.MESSAGE_DELETE, async (data, callback) => {
    try {
      const { messageId } = data || {};
      if (!messageId) {
        if (callback) callback({ error: 'messageId is required' });
        return;
      }

      const existing = await messagesRepo.findById(messageId);
      if (!existing) {
        if (callback) callback({ error: 'Message not found' });
        return;
      }

      await messagesService.remove(userId, messageId);

      io.to(rooms.conversationRoom(existing.conversation_id)).emit(events.MESSAGE_DELETED, {
        messageId,
      });

      if (callback) callback({ success: true });
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

      await messagesService.markReceipt(userId, messageId, 'read');

      io.to(rooms.conversationRoom(existing.conversation_id)).emit(events.MESSAGE_READ, {
        messageId,
      });
    } catch (err) {
      logger.error('Error in message:read', { message: err.message });
    }
  });
}
