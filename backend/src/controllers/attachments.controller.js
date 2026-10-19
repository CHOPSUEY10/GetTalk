import * as attachmentsService from '../services/attachments.service.js';

export async function upload(req, res, next) {
  try {
    const { messageId, sizeBytes, metadataCiphertext, metadataNonce } = req.body;

    const attachment = await attachmentsService.upload(req.user.id, {
      messageId,
      sizeBytes,
      metadataCiphertext,
      metadataNonce,
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
