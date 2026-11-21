import * as conversationsService from '../services/conversations.service.js';
import * as events from '../socket/events.js';
import * as rooms from '../socket/rooms.js';
import { parsePaginationQuery } from '../utils/pagination.js';
import { DEFAULT_CONVERSATIONS_LIMIT } from '../validators/conversations.validator.js';

export async function list(req, res, next) {
  try {
    const { limit, cursor: before } = parsePaginationQuery(req.query, {
      defaultLimit: DEFAULT_CONVERSATIONS_LIMIT,
      cursorParam: 'before',
    });
    const result = await conversationsService.list(req.user.id, { limit, before });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function getById(req, res, next) {
  try {
    const conversation = await conversationsService.getById(req.user.id, req.params.conversationId);
    return res.json({ conversation });
  } catch (err) {
    return next(err);
  }
}

export async function create(req, res, next) {
  try {
    const conversation = await conversationsService.create(req.user.id, req.body.userId);
    return res.status(201).json({ conversation });
  } catch (err) {
    return next(err);
  }
}

export async function remove(req, res, next) {
  try {
    const { conversationId } = req.params;
    const rawScope =
      req.query?.scope !== undefined && req.query?.scope !== ''
        ? req.query.scope
        : req.body?.scope ?? 'me';

    const result = await conversationsService.clearMessages(req.user.id, conversationId, {
      scope: rawScope,
    });

    const io = req.app.get('io');
    if (io) {
      const payload = {
        conversationId: result.conversationId,
        scope: result.scope,
        clearedBy: req.user.id,
        clearedAt: result.clearedAt,
      };

      // Chain rooms so sockets present in both conversation room and user room
      // receive a single deduplicated event.
      let emitter = io;
      let hasTarget = false;
      if (result.scope === 'everyone') {
        emitter = emitter.to(rooms.conversationRoom(conversationId));
        hasTarget = true;
      }
      for (const targetUserId of result.affectedUserIds || []) {
        emitter = emitter.to(rooms.userRoom(targetUserId));
        hasTarget = true;
      }
      if (hasTarget) {
        emitter.emit(events.CONVERSATION_CLEARED, payload);
      }
    }

    return res.json({
      conversationId: result.conversationId,
      scope: result.scope,
      clearedAt: result.clearedAt,
      deletedMessageCount: result.deletedMessageCount,
    });
  } catch (err) {
    return next(err);
  }
}
