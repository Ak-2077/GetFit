import express from 'express';
import auth from '../middleware/authMiddleware.js';
import { submit, status, result, correction, cancel } from '../controllers/analysisController.js';

const router = express.Router();

// AI exercise analysis — all routes protected by auth (req.userId)
router.post('/submit', auth, submit);
router.get('/status/:jobId', auth, status);
router.post('/cancel/:jobId', auth, cancel);
router.get('/result/:jobId', auth, result);
router.post('/:id/correction', auth, correction);

export default router;
