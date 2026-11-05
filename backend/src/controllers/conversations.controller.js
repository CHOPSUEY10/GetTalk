import * as conversationsService from '../services/conversations.service.js';
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
