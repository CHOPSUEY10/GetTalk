import * as attachmentsService from '../services/attachments.service.js';

export async function upload(req, res, next) {
  try {
    const originalName = req.body.originalName || req.body.filename;
    const mimeType = req.body.mimeType;
    const sizeBytes = req.body.sizeBytes !== undefined ? req.body.sizeBytes : req.body.size;
    const checksum = req.body.checksum || null;
    const messageId = req.body.messageId || null;

    const attachment = await attachmentsService.upload(req.user.id, {
      originalName,
      mimeType,
      sizeBytes,
      checksum,
      messageId,
    });

    return res.status(201).json({ attachment });
  } catch (err) {
    return next(err);
  }
}

export async function getById(req, res, next) {
  try {
    const attachment = await attachmentsService.getById(req.user.id, req.params.attachmentId);
    return res.json({ attachment });
  } catch (err) {
    return next(err);
  }
}

export async function remove(req, res, next) {
  try {
    await attachmentsService.remove(req.user.id, req.params.attachmentId);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}
