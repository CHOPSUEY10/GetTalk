import * as usersService from '../services/users.service.js';

const DUMMY_USER = {
  id: 'test123',
  username: 'test',
};

export async function getMe(req, res, next) {
  try {
    // const user = await usersService.getMe(req.user.id);
    // return res.json({
    //   user: {
    //     id: user.id,
    //     username: user.username,
    //   },
    // });

    return res.json({
      user: {
        id: req.user?.id || DUMMY_USER.id,
        username: req.user?.username || DUMMY_USER.username,
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function search(req, res, next) {
  try {

    // const q = req.query.q || '';
    // const users = await usersService.search(q);
    // return res.json({ users });

    const q = (req.query.q || '').toLowerCase();
    const mockUsers = [
      { id: 'test123', username: 'test' },
      { id: 'test1234', username: 'test2' },
      { id: 'test1235', username: 'test3' },
    ];
    const users = mockUsers.filter(u => u.username.toLowerCase().includes(q));
    return res.json({ users });
  } catch (err) {
    return next(err);
  }
}

export async function getById(req, res, next) {
  try {

    // const user = await usersService.getById(req.params.userId);
    // return res.json({
    //   user: {
    //     id: user.id,
    //     username: user.username,
    //   },
    // });


    return res.json({
      user: {
        id: req.params.userId,
        username: req.params.userId === 'test1234' ? 'test2' : 'test',
      },
    });
  } catch (err) {
    return next(err);
  }
}
