import * as friendsService from '../services/friends.service.js';

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
    return res.status(201).json({ request });
  } catch (err) {
    return next(err);
  }
}

export async function acceptRequest(req, res, next) {
  try {
    const friend = await friendsService.acceptRequest(req.user.id, req.params.requestId);
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
