import * as messagesService from '../services/messages.service.js';

export async function list(req, res, next) {
  try {
    const { conversationId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const before = req.query.before || null;

    const result = await messagesService.list(req.user.id, conversationId, { limit, before });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function create(req, res, next) {
  try {
    const { conversationId } = req.params;
    const { bodyCiphertext, nonce, clientMessageId } = req.body;

    const message = await messagesService.create(req.user.id, conversationId, {
      bodyCiphertext,
      nonce,
      clientMessageId,
    });

    return res.status(201).json({ message });
  } catch (err) {
    return next(err);
  }
}

export async function update(req, res, next) {
  try {
    const { messageId } = req.params;
    const { bodyCiphertext, nonce } = req.body;

    const message = await messagesService.update(req.user.id, messageId, {
      bodyCiphertext,
      nonce,
    });

    return res.json({ message });
  } catch (err) {
    return next(err);
  }
}

export async function remove(req, res, next) {
  try {
    const { messageId } = req.params;
    await messagesService.remove(req.user.id, messageId);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

export async function receipt(req, res, next) {
  try {
    const { messageId } = req.params;
    const { status } = req.body;

    await messagesService.markReceipt(req.user.id, messageId, status);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}
