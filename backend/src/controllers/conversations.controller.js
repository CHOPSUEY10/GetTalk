import * as conversationsService from '../services/conversations.service.js';

export async function list(req, res, next) {
  try {
    const conversations = await conversationsService.list(req.user.id);
    return res.json({ conversations });
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
