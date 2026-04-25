import express from 'express';
import { 
  addBrandFood, 
  getBrandFoods, 
  getFoodByBarcode, 
  addFoodToLog, 
  getTodaysFoodLog, 
  removeFoodFromLog,
  searchFoods
} from '../controllers/foodController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

// Food management
router.post('/add-food', auth, addBrandFood);
router.get('/brand-foods', auth, getBrandFoods);
router.get('/search', auth, searchFoods);
router.get('/barcode/:barcode', auth, getFoodByBarcode);

// Food logging
router.post('/log', auth, addFoodToLog);
router.get('/log/today', auth, getTodaysFoodLog);
router.delete('/log/:logId', auth, removeFoodFromLog);

export default router;
