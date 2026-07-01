import express from 'express';
import auth from '../middleware/authMiddleware.js';
import { requireAdmin, getMetrics } from '../controllers/adminAnalyticsController.js';

// ═══════════════════════════════════════════════════════════════════════════
// Admin analytics routes (Req 46) — additive, mounted at /api/admin/analytics
// in index.js WITHOUT changing any existing route.
//
// Two-layer protection: the existing `auth` middleware authenticates the
// request (populates req.user), then `requireAdmin` authorizes administrators
// only. Non-admins are denied with 403 and receive no metrics (Req 46.4).
// ═══════════════════════════════════════════════════════════════════════════

const router = express.Router();

router.get('/metrics', auth, requireAdmin, getMetrics);

export default router;
