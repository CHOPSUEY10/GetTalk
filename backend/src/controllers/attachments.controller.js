import * as attachmentsService from '../services/attachments.service.js';
import * as events from '../socket/events.js';
import * as rooms from '../socket/rooms.js';

export async function upload(req, res, next) {
  try {
    const { attachment, conversationId } = await attachmentsService.upload(req.user.id, {
      messageId: req.headers['x-message-id'],
      metadataCiphertext: req.headers['x-metadata-ciphertext'],
      metadataNonce: req.headers['x-metadata-nonce'],
      ciphertext: req.body,
    });

    // Let the recipient attach the file to the message in real time.
    const io = req.app.get('io');
    if (io) {
      io.to(rooms.conversationRoom(conversationId)).emit(events.ATTACHMENT_NEW, {
        attachment,
      });
    }

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

export async function getContent(req, res, next) {
  try {
    const { filePath } = await attachmentsService.getContent(
      req.user.id,
      req.params.attachmentId
    );

    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'no-store');
    return res.sendFile(filePath);
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
