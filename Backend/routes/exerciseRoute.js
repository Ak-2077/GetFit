import express from 'express';
import auth from '../middleware/authMiddleware.js';
import {
  getExercisesByMuscle,
  getAllExercises,
} from '../controllers/exerciseController.js';

const router = express.Router();

// GET /api/exercises       — all exercises
router.get('/', auth, getAllExercises);

// GET /api/exercises/:muscleGroup — exercises for a specific muscle
router.get('/:muscleGroup', auth, getExercisesByMuscle);

export default router;
