import express from 'express';
import { upgradePlan, getPlans } from '../controllers/subscriptionController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/plans', auth, getPlans);
router.post('/upgrade', auth, upgradePlan);

export default router;
