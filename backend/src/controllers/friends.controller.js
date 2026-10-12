import * as friendsService from '../services/friends.service.js';
import * as events from '../socket/events.js';
import * as rooms from '../socket/rooms.js';

export async function list(req, res, next) {
  try {
    const friends = await friendsService.list(req.user.id);
    return res.json({ friends });
  } catch (err) {
    return next(err);
  }
}

export async function listRequests(req, res, next) {
  try {
    const requests = await friendsService.listRequests(req.user.id);
    return res.json({ requests });
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
