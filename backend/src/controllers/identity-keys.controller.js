import * as identityKeysService from '../services/identity-keys.service.js';

export async function register(req, res, next) {
  try {
    const identityKey = await identityKeysService.register(req.user.id, req.body.publicKey);
    return res.json({ identityKey });
  } catch (err) {
    return next(err);
  }
}

export async function get(req, res, next) {
  try {
    const identityKey = await identityKeysService.get(req.params.userId);
    return res.json({ identityKey });
  } catch (err) {
    return next(err);
  }
}

export async function remove(req, res, next) {
  try {
    await identityKeysService.remove(req.user.id);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}
