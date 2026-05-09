import express from 'express';
import { sendOtp, verifyOtp, me, updateProfile, forgotPassword, googleLogin } from '../controllers/authController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/google-login', googleLogin);
router.get('/me', auth, me);
router.patch('/profile', auth, updateProfile);
router.post('/forgot-password', forgotPassword);

export default router;
