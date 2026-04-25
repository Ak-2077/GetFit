import express from 'express';
import auth from '../middleware/authMiddleware.js';
import { generateActivityGoal } from '../controllers/aiController.js';

const router = express.Router();

router.post('/activity-goal', auth, generateActivityGoal);

export default router;
