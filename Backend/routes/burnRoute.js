import express from 'express';
import auth from '../middleware/authMiddleware.js';
import { addBurnLog, getTodaysBurnLog, removeBurnLog } from '../controllers/burnController.js';

const router = express.Router();

router.post('/log', auth, addBurnLog);
router.get('/log/today', auth, getTodaysBurnLog);
router.delete('/log/:logId', auth, removeBurnLog);

export default router;
