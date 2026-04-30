import express from 'express';
import { calculateBMB } from '../controllers/bmbController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/calculate', auth, calculateBMB);

export default router;
