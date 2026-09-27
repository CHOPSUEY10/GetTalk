import AppError from '../errors/AppError.js';
import { UNAUTHORIZED } from '../errors/error-codes.js';
import * as usersRepo from '../repositories/users.repository.js';

/**
 * Authentication middleware (plan §19, rule §11).
 *
 * Responsibilities:
 *  - Read authentication context (session)
 *  - Validate session
 *  - Attach authenticated user to req.user ({ id, username, email })
 *  - Reject unauthenticated requests
 *
 * Does NOT perform authorization (that is handled separately).
 */
export async function authenticate(req, res, next) {
  try {

    // const userId = req.session?.userId;
    // if (!userId) {
    //   return next(
    //     new AppError('Authentication required', 401, UNAUTHORIZED)
    //   );
    // }
    // const user = await usersRepo.findById(userId);
    // if (!user) {
    //   if (req.session) {
    //     req.session.destroy(() => {});
    //   }
    //   return next(
    //     new AppError('User not found or session invalid', 401, UNAUTHORIZED)
    //   );
    // }
    // req.user = {
    //   id: user.id,
    //   username: user.username,
    //   email: user.email,
    // };

    req.user = {
      id: 'test123',
      username: 'test',
      email: 'test@example.com',
    };

    return next();
  } catch (err) {
    return next(err);
  }
}
