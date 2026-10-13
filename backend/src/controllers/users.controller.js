import * as usersService from '../services/users.service.js';

// In-memory public key exchange registry (Rule §17: public keys may be shared for ECDH key exchange)
const userPublicKeys = new Map();

export async function getMe(req, res, next) {
  try {
    const user = await usersService.getMe(req.user.id);
    return res.json({
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function search(req, res, next) {
  try {
    const q = req.query.q || '';
    const users = await usersService.search(q);
    return res.json({ users });
  } catch (err) {
    return next(err);
  }
}

export async function getById(req, res, next) {
  try {
    const user = await usersService.getById(req.params.userId);
    return res.json({
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function setPublicKey(req, res, next) {
  try {
    const { publicKey } = req.body;
    if (!publicKey || typeof publicKey !== 'string') {
      return res.status(400).json({ error: 'publicKey string is required' });
    }
    userPublicKeys.set(req.user.id, publicKey);
    return res.json({ success: true, userId: req.user.id, publicKey });
  } catch (err) {
    return next(err);
  }
}

export async function getPublicKey(req, res, next) {
  try {
    const publicKey = userPublicKeys.get(req.params.userId) || null;
    return res.json({ userId: req.params.userId, publicKey });
  } catch (err) {
    return next(err);
  }
}
