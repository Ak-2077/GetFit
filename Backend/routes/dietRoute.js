import express from 'express';
import { getDietPlan, generateDiet } from '../controllers/dietController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/plan', auth, getDietPlan);
router.post('/generate', auth, generateDiet);

export default router;
