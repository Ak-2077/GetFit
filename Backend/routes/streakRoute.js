import express from 'express';
import auth from '../middleware/authMiddleware.js';
import {
  getMonthlyStreak,
  updateStreak,
  getDayStreak,
} from '../controllers/streakController.js';

const router = express.Router();

router.get('/monthly', auth, getMonthlyStreak);
router.post('/update', auth, updateStreak);
router.get('/day/:date', auth, getDayStreak);

export default router;
