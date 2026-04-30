import express from 'express';
import { getFeatures } from '../controllers/featureController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', auth, getFeatures);

export default router;
