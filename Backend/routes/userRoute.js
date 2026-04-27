import express from 'express';
import {
  saveOnboarding,
  getProfile,
  updateUserProfile,
  changeUserPassword,
  deleteAccount,
} from '../controllers/onboardingController.js';
import { getWeeklyCalories } from '../controllers/weeklyCaloriesController.js';
import { sendProfileEmailOtp, verifyProfileEmailOtp } from '../controllers/authController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/onboarding', auth, saveOnboarding);
router.get('/profile', auth, getProfile);
router.put('/profile', auth, updateUserProfile);
router.post('/change-password', auth, changeUserPassword);
router.delete('/delete-account', auth, deleteAccount);
router.get('/weekly-calories', auth, getWeeklyCalories);
router.post('/send-email-otp', auth, sendProfileEmailOtp);
router.post('/verify-email-otp', auth, verifyProfileEmailOtp);

export default router;
