import express from 'express';
import { getDietPlan } from '../controllers/dietController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/plan', auth, getDietPlan);

export default router;
