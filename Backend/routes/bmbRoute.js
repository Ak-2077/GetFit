import express from 'express';
import { calculateBMB, generateBMBPlan } from '../controllers/bmbController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/calculate', auth, calculateBMB);
router.post('/generate', generateBMBPlan);

export default router;
