import express from 'express';
import auth from '../middleware/authMiddleware.js';
import { addFoodToLog } from '../controllers/foodController.js';
import {
  getCaloriesToday,
  getCaloriesWeekly,
  getCaloriesMacros,
  getCaloriesBurn,
} from '../controllers/caloriesController.js';

const router = express.Router();

router.post('/log', auth, addFoodToLog);
router.get('/today', auth, getCaloriesToday);
router.get('/weekly', auth, getCaloriesWeekly);
router.get('/macros', auth, getCaloriesMacros);
router.get('/burn', auth, getCaloriesBurn);

export default router;
