import express from 'express';
import { globalSearch } from '../controllers/searchController.js';
import auth from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', auth, globalSearch);

export default router;
