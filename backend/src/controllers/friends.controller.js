import * as friendsService from '../services/friends.service.js';
import {
  parsePaginationQuery,
  parseOffsetPaginationQuery,
} from '../utils/pagination.js';
import {
  DEFAULT_FRIENDS_LIMIT,
  DEFAULT_FRIEND_REQUESTS_LIMIT,
} from '../validators/friends.validator.js';
import * as events from '../socket/events.js';
import * as rooms from '../socket/rooms.js';

export async function list(req, res, next) {
  try {
    const { limit, offset, cursor: after } = parseOffsetPaginationQuery(req.query, {
      defaultLimit: DEFAULT_FRIENDS_LIMIT,
      cursorParam: 'after',
    });
    const result = await friendsService.list(req.user.id, { limit, offset, after });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function listRequests(req, res, next) {
  try {
    const { limit, cursor: before } = parsePaginationQuery(req.query, {
      defaultLimit: DEFAULT_FRIEND_REQUESTS_LIMIT,
      cursorParam: 'before',
    });
    const result = await friendsService.listRequests(req.user.id, { limit, before });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function sendRequest(req, res, next) {
  try {
    const request = await friendsService.sendRequest(req.user.id, req.body.userId);

    // Emit real-time friend:request to the target user's personal room
    const io = req.app.get('io');
    if (io) {
      io.to(rooms.userRoom(request.userId)).emit(events.FRIEND_REQUEST, {
        request: {
          id: request.id,
          fromUser: {
            id: req.user.id,
            username: req.user.username,
          },
          status: request.status,
        },
      });
    }

    return res.status(201).json({ request });
  } catch (err) {
    return next(err);
  }
}

export async function acceptRequest(req, res, next) {
  try {
    const friend = await friendsService.acceptRequest(req.user.id, req.params.requestId);

    // Emit real-time friend:accepted to the requester's personal room
    const io = req.app.get('io');
    if (io) {
      io.to(rooms.userRoom(friend.userId)).emit(events.FRIEND_ACCEPTED, {
        friend: {
          userId: req.user.id,
          username: req.user.username,
        },
        requestId: req.params.requestId,
      });
    }

    return res.json({ friend });
  } catch (err) {
    return next(err);
  }
}

export async function rejectRequest(req, res, next) {
  try {
    await friendsService.rejectRequest(req.user.id, req.params.requestId);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

export async function remove(req, res, next) {
  try {
    await friendsService.remove(req.user.id, req.params.userId);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}
