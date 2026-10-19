import * as usersService from '../services/users.service.js';

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
