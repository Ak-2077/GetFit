import express from 'express';
import auth from '../middleware/authMiddleware.js';
import { getWorkoutModel } from '../controllers/workoutController.js';

const router = express.Router();

router.get('/model', auth, getWorkoutModel);

export default router;
