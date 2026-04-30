import express from 'express';
import { getWorkoutPlan } from '../controllers/workoutPlanController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/plan', auth, getWorkoutPlan);

export default router;
