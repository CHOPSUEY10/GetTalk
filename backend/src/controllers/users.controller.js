import * as usersService from '../services/users.service.js';
import { parseOffsetPaginationQuery } from '../utils/pagination.js';
import { DEFAULT_USER_SEARCH_LIMIT } from '../validators/users.validator.js';

// In-memory public key exchange registry (Rule §17: public keys may be shared for ECDH key exchange)
const userPublicKeys = new Map();

export async function getMe(req, res, next) {
  try {
    const user = await usersService.getMe(req.user.id);
    return res.json({
      user,
    });
  } catch (err) {
    return next(err);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const { username, nickname, bio } = req.body;
    const user = await usersService.updateProfile(
      req.user.id,
      { username, nickname, bio },
      { ipAddress: req.ip || req.socket?.remoteAddress || null }
    );
    return res.json({
      user,
    });
  } catch (err) {
    return next(err);
  }
}

export async function getPrivacy(req, res, next) {
  try {
    const privacy = await usersService.getPrivacySettings(req.user.id);
    return res.json({
      privacy,
      ...privacy,
    });
  } catch (err) {
    return next(err);
  }
}

export async function updatePrivacy(req, res, next) {
  try {
    const privacy = await usersService.updatePrivacySettings(req.user.id, req.body, {
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });
    return res.json({
      privacy,
      ...privacy,
    });
  } catch (err) {
    return next(err);
  }
}

export async function listBlockedUsers(req, res, next) {
  try {
    const { limit, offset, cursor } = parseOffsetPaginationQuery(req.query, {
      defaultLimit: 20,
      cursorParam: 'after',
    });
    const result = await usersService.listBlockedUsers(req.user.id, {
      limit,
      offset,
      after: cursor,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function blockUser(req, res, next) {
  try {
    const result = await usersService.blockUser(req.user.id, req.params.userId, {
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function unblockUser(req, res, next) {
  try {
    const result = await usersService.unblockUser(req.user.id, req.params.userId, {
      ipAddress: req.ip || req.socket?.remoteAddress || null,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function search(req, res, next) {
  try {
    const q = req.query.q || '';
    const { limit, offset } = parseOffsetPaginationQuery(req.query, {
      defaultLimit: DEFAULT_USER_SEARCH_LIMIT,
    });
    const result = await usersService.search(q, { limit, offset });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function getById(req, res, next) {
  try {
    const user = await usersService.getById(req.params.userId, req.user?.id || null);
    return res.json({
      user,
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
