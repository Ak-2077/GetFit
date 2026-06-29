import express from 'express';
import { upgradeSubscription, getPlans } from '../controllers/subscriptionController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/plans', auth, getPlans);
router.post('/upgrade', auth, upgradeSubscription);

export default router;
