import express from 'express';
import {
	sendOtp,
	verifyOtp,
	sendEmailOtp,
	verifyEmailOtp,
	emailPasswordAuth,
	me,
	updateProfile,
	googleLogin,
} from '../controllers/authController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/send-email-otp', sendEmailOtp);
router.post('/verify-email-otp', verifyEmailOtp);
router.post('/email-auth', emailPasswordAuth);
router.post('/google-login', googleLogin);
router.get('/me', auth, me);
router.patch('/profile', auth, updateProfile);

export default router;