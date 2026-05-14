/**
 * Payments Controller
 * ──────────────────────────────────────────────────────────────
 * Endpoints:
 *   POST /api/payments/razorpay/create-order   (auth)
 *   POST /api/payments/razorpay/verify         (auth)
 *   POST /api/payments/razorpay/webhook        (raw body, public)
 *   GET  /api/payments/subscription/status     (auth)
 *   POST /api/payments/subscription/restore    (auth)
 *
 * Security invariants:
 *   • Plan price is ALWAYS resolved server-side from config/plans.js.
 *     The frontend never gets to pick the amount.
 *   • A subscription only flips to status='active' AFTER the HMAC
 *     signature verifies. Pending orders are written first so we
 *     can audit failed attempts.
 *   • Replay protection: razorpayPaymentId is unique-indexed.
 * ──────────────────────────────────────────────────────────────
 */

import Subscription from '../models/subscription.js';
import {
  getAllPlans,
  getPlanById,
  getFeaturesForTier,
  tierRank,
} from '../config/plans.js';
import {
  isRazorpayConfigured,
  getPublicKeyId,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from '../services/razorpayService.js';
import {
  resolveActivePlan,
  syncUserPlanCache,
} from '../services/subscriptionService.js';

/* ─────────────────────────────────────────────────────────────
   Plan listing  (GET /api/payments/plans)
───────────────────────────────────────────────────────────── */

export const listPlans = async (req, res) => {
  try {
    const plans = getAllPlans();
    const current = await resolveActivePlan(req.userId);
    return res.status(200).json({
      currentPlan: current.tier,
      currentPlanId: current.planId,
      expiryDate: current.expiryDate,
      isActive: current.isActive,
      plans,
    });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to fetch plans', error: e.message });
  }
};

/* ─────────────────────────────────────────────────────────────
   Razorpay: Create Order  (POST /api/payments/razorpay/create-order)
───────────────────────────────────────────────────────────── */

export const createRazorpayOrder = async (req, res) => {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({
        message:
          'Razorpay is not configured on the server. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.',
      });
    }

    const userId = req.userId;
    const { planId } = req.body || {};
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!planId) return res.status(400).json({ message: 'planId is required' });

    const plan = getPlanById(planId);
    if (!plan || plan.tier === 'free') {
      return res.status(400).json({ message: 'Invalid or non-purchasable plan' });
    }

    // Prevent purchasing a strictly lower tier than the user already has.
    const current = await resolveActivePlan(userId);
    if (current.isActive && tierRank(plan.tier) < tierRank(current.tier)) {
      return res.status(400).json({
        message: `You already have a higher plan (${current.tier}).`,
      });
    }

    // ── Idempotency: reuse a recent pending order for the same plan ──
    // If the user taps "Subscribe" multiple times within 30 minutes,
    // return the existing Razorpay order instead of creating duplicates.
    const PENDING_REUSE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
    const existingPending = await Subscription.findOne({
      userId,
      planId: plan.id,
      status: 'pending',
      createdAt: { $gte: new Date(Date.now() - PENDING_REUSE_WINDOW_MS) },
    }).sort({ createdAt: -1 });

    if (existingPending?.razorpayOrderId) {
      console.log(
        `[payments] reusing pending order ${existingPending.razorpayOrderId} for user ${userId} / plan ${plan.id}`
      );
      return res.status(200).json({
        orderId: existingPending.razorpayOrderId,
        amount: plan.amountPaise,
        currency: plan.currency,
        keyId: getPublicKeyId(),
        planId: plan.id,
        planName: plan.name,
        displayPrice: plan.displayPrice,
        period: plan.period,
        reused: true,
      });
    }

    // Create a Razorpay order with server-resolved amount.
    const receipt = `gf_${Date.now()}_${userId.toString().slice(-6)}`;
    const order = await createOrder({
      amount: plan.amountPaise,
      currency: plan.currency,
      receipt,
      notes: {
        userId: String(userId),
        planId: plan.id,
        tier: plan.tier,
      },
    });

    // Write a "pending" subscription row so we have a paper trail
    // even if the user abandons checkout.
    await Subscription.create({
      userId,
      planId: plan.id,
      planTier: plan.tier,
      billingCycle: plan.billingCycle,
      platform: 'android',
      provider: 'razorpay',
      status: 'pending',
      amount: plan.amountPaise,
      currency: plan.currency,
      razorpayOrderId: order.id,
      verified: false,
      metadata: { receipt },
    });

    return res.status(200).json({
      orderId: order.id,
      amount: plan.amountPaise,
      currency: plan.currency,
      keyId: getPublicKeyId(),
      planId: plan.id,
      planName: plan.name,
      displayPrice: plan.displayPrice,
      period: plan.period,
    });
  } catch (e) {
    console.error('[payments] createRazorpayOrder error:', e);
    return res
      .status(500)
      .json({ message: e.message || 'Failed to create order' });
  }
};

/* ─────────────────────────────────────────────────────────────
   Razorpay: Verify Payment  (POST /api/payments/razorpay/verify)
───────────────────────────────────────────────────────────── */

export const verifyRazorpayPayment = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        message:
          'razorpay_order_id, razorpay_payment_id and razorpay_signature are required',
      });
    }

    // Locate the pending subscription this order belongs to.
    const sub = await Subscription.findOne({
      razorpayOrderId: razorpay_order_id,
      userId,
    });
    if (!sub) {
      return res.status(404).json({ message: 'Order not found for this user' });
    }

    // Replay protection: a paymentId can only be consumed once.
    if (sub.status === 'active' && sub.razorpayPaymentId === razorpay_payment_id) {
      const plan = await resolveActivePlan(userId);
      return res.status(200).json({
        message: 'Already verified',
        status: 'active',
        plan,
      });
    }

    // HMAC SHA256 signature check.
    const ok = verifyPaymentSignature({
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    });
    if (!ok) {
      sub.status = 'failed';
      sub.metadata = { ...(sub.metadata || {}), failedReason: 'bad_signature' };
      await sub.save();
      return res.status(400).json({ message: 'Invalid payment signature' });
    }

    // ✅ Verified — activate.
    const plan = getPlanById(sub.planId);
    if (!plan) {
      return res.status(500).json({ message: 'Plan no longer exists' });
    }

    const now = new Date();
    const expiry = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    sub.razorpayPaymentId = razorpay_payment_id;
    sub.razorpaySignature = razorpay_signature;
    sub.status = 'active';
    sub.verified = true;
    sub.startDate = now;
    sub.expiryDate = expiry;
    sub.autoRenew = false; // Razorpay one-time payment
    await sub.save();

    // Cancel any other previously-active subs (user upgraded).
    await Subscription.updateMany(
      {
        userId,
        _id: { $ne: sub._id },
        status: 'active',
      },
      { $set: { status: 'cancelled', cancelledAt: now } }
    );

    // Sync the User.subscriptionPlan cache for fast reads.
    const activePlan = await syncUserPlanCache(userId);

    return res.status(200).json({
      message: 'Payment verified — subscription activated',
      status: 'active',
      plan: activePlan,
      expiryDate: expiry,
    });
  } catch (e) {
    console.error('[payments] verifyRazorpayPayment error:', e);
    return res.status(500).json({ message: e.message || 'Verification failed' });
  }
};

/* ─────────────────────────────────────────────────────────────
   Razorpay: Webhook  (POST /api/payments/razorpay/webhook)
   Body must arrive as raw bytes (configured in index.js).
───────────────────────────────────────────────────────────── */

export const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body; // Buffer — see express.raw() in index.js

    if (!verifyWebhookSignature(rawBody, signature)) {
      console.warn('[payments] webhook signature mismatch');
      return res.status(400).send('invalid signature');
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    const eventType = event?.event;

    console.log(`[payments] webhook received: ${eventType}`);

    // Webhooks are a *backup* path — the primary verification
    // happens client-driven via /verify above. Still, we honor a
    // few key events for resilience.
    if (eventType === 'payment.captured') {
      const payment = event?.payload?.payment?.entity;
      if (payment?.order_id && payment?.id) {
        const sub = await Subscription.findOne({
          razorpayOrderId: payment.order_id,
        });
        if (sub && sub.status !== 'active') {
          const plan = getPlanById(sub.planId);
          if (plan) {
            const now = new Date();
            sub.razorpayPaymentId = payment.id;
            sub.status = 'active';
            sub.verified = true;
            sub.startDate = now;
            sub.expiryDate = new Date(
              now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000
            );
            await sub.save();
            await syncUserPlanCache(sub.userId);
            console.log(`[payments] webhook activated sub ${sub._id}`);
          }
        }
      }
    } else if (eventType === 'payment.failed') {
      const payment = event?.payload?.payment?.entity;
      if (payment?.order_id) {
        await Subscription.updateOne(
          { razorpayOrderId: payment.order_id, status: 'pending' },
          {
            $set: {
              status: 'failed',
              metadata: { failureReason: payment?.error_description || 'unknown' },
            },
          }
        );
      }
    }

    return res.status(200).send('ok');
  } catch (e) {
    console.error('[payments] webhook error:', e);
    // Always 200 to webhooks unless the signature failed — Razorpay
    // retries on non-2xx, which would amplify partial-state bugs.
    return res.status(200).send('ok');
  }
};

/* ─────────────────────────────────────────────────────────────
   Subscription Status  (GET /api/payments/subscription/status)
───────────────────────────────────────────────────────────── */

export const getSubscriptionStatus = async (req, res) => {
  try {
    const plan = await resolveActivePlan(req.userId);
    return res.status(200).json({
      tier: plan.tier,
      planId: plan.planId,
      billingCycle: plan.billingCycle,
      expiryDate: plan.expiryDate,
      isActive: plan.isActive,
      provider: plan.provider,
      platform: plan.platform,
      allowedFeatures: plan.allowedFeatures,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ message: 'Failed to fetch subscription status', error: e.message });
  }
};

/* ─────────────────────────────────────────────────────────────
   Restore Subscription  (POST /api/payments/subscription/restore)
   For Razorpay this just refreshes the cache. iOS Apple-IAP
   restore lives in a separate controller (Phase 3).
───────────────────────────────────────────────────────────── */

export const restoreSubscription = async (req, res) => {
  try {
    const plan = await syncUserPlanCache(req.userId);
    return res.status(200).json({
      message: plan.isActive
        ? 'Subscription restored'
        : 'No active subscription found',
      plan,
    });
  } catch (e) {
    return res.status(500).json({ message: e.message || 'Restore failed' });
  }
};
