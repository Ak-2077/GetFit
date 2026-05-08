import express from 'express';
import auth from '../middleware/authMiddleware.js';
import { getWorkoutModel, getWorkoutsByType, getAllWorkouts } from '../controllers/workoutController.js';

const router = express.Router();

// Static routes MUST come before the :type wildcard
router.get('/model', auth, getWorkoutModel);
router.get('/all', auth, getAllWorkouts);

// Dynamic route — matches /home, /gym, /ai
router.get('/:type', auth, getWorkoutsByType);

export default router;
