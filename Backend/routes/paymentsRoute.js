/**
 * Payments routes
 *
 * Platform billing:
 *   • iOS    → Apple In-App Purchase
 *   • Android → Google Play Billing
 *
 * Webhooks are mounted separately in index.js with raw body parsers.
 */

import express from 'express';
import auth from '../middleware/authMiddleware.js';
import {
  listPlans,
  verifyGooglePurchase,
  getSubscriptionStatus,
  restoreSubscription,
  cancelSubscription,
  verifyAppleReceipt,
  appleWebhook,
} from '../controllers/paymentsController.js';

const router = express.Router();

/* ── Authenticated ──────────────────────────────────────────── */
router.get('/plans', auth, listPlans);
router.get('/subscription/status', auth, getSubscriptionStatus);
router.post('/subscription/restore', auth, restoreSubscription);
router.post('/subscription/cancel', auth, cancelSubscription);

/* ── Google Play Billing (Android) ──────────────────────────── */
router.post('/google/verify', auth, verifyGooglePurchase);

/* ── Apple IAP (iOS) ────────────────────────────────────────── */
router.post('/apple/verify', auth, verifyAppleReceipt);

/* Webhooks are mounted in index.js with raw body parsers. */
export { appleWebhook };
export default router;
