/**
 * Payments routes
 *
 * Note: the webhook route is mounted with express.raw() in index.js
 * (NOT json) because Razorpay's HMAC is computed over the raw bytes.
 */

import express from 'express';
import auth from '../middleware/authMiddleware.js';
import {
  listPlans,
  createRazorpayOrder,
  verifyRazorpayPayment,
  razorpayWebhook,
  getSubscriptionStatus,
  restoreSubscription,
  cancelSubscription,
  verifyAppleReceipt,
  appleWebhook,
} from '../controllers/paymentsController.js';

const router = express.Router();

/* ── Public ─────────────────────────────────────────────────── */
// Webhook is registered separately in index.js with raw body parser.

/* ── Authenticated ──────────────────────────────────────────── */
router.get('/plans', auth, listPlans);
router.post('/razorpay/create-order', auth, createRazorpayOrder);
router.post('/razorpay/verify', auth, verifyRazorpayPayment);
router.get('/subscription/status', auth, getSubscriptionStatus);
router.post('/subscription/restore', auth, restoreSubscription);
router.post('/subscription/cancel', auth, cancelSubscription);

/* ── Apple IAP (iOS) ───────────────────────────────────────── */
router.post('/apple/verify', auth, verifyAppleReceipt);

/* Webhooks are mounted in index.js with raw body parsers. */
export { razorpayWebhook, appleWebhook };
export default router;
