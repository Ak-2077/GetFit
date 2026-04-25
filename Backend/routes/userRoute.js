import express from 'express';
import {
  saveOnboarding,
  getProfile,
  updateUserProfile,
  changeUserPassword,
  deleteAccount,
} from '../controllers/onboardingController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/onboarding', auth, saveOnboarding);
router.get('/profile', auth, getProfile);
router.put('/profile', auth, updateUserProfile);
router.post('/change-password', auth, changeUserPassword);
router.delete('/delete-account', auth, deleteAccount);

export default router;
