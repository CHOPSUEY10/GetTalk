import { Router } from 'express';
import * as friendsController from '../controllers/friends.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validation.middleware.js';
import { validateSendRequest } from '../validators/friends.validator.js';

const router = Router();

router.use(authenticate);

router.get('/', friendsController.list);
router.get('/requests', friendsController.listRequests);
router.post('/requests', validate(validateSendRequest), friendsController.sendRequest);
router.post('/requests/:requestId/accept', friendsController.acceptRequest);
router.post('/requests/:requestId/reject', friendsController.rejectRequest);
router.delete('/:userId', friendsController.remove);

export default router;
