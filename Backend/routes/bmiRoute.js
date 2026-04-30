import express from 'express';
import { calculateBMI } from '../controllers/bmiController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/calculate', auth, calculateBMI);

export default router;
