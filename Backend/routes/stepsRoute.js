import express from 'express';
import auth from '../middleware/authMiddleware.js';
import { getStepsToday } from '../controllers/caloriesController.js';

const router = express.Router();

router.get('/today', auth, getStepsToday);

export default router;
