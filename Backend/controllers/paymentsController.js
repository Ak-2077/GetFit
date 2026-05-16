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
import {
  isAppleIapConfigured,
  verifyAppleReceipt as verifyAppleReceiptRaw,
  parseS2SNotification,
  notificationToAction,
} from '../services/appleIapService.js';
import { getPlanByAppleProductId } from '../config/plans.js';
import User from '../models/user.js';

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
    // Cancellation lifecycle: when autoRenew is false and we have an
    // expiryDate, the UI should show "Your subscription expires on DATE"
    // and disable the cancel CTA (already cancelled — only restore makes sense).
    const cancelled = plan.isActive && plan.autoRenew === false && !!plan.cancelledAt;

    return res.status(200).json({
      tier: plan.tier,
      planId: plan.planId,
      billingCycle: plan.billingCycle,
      expiryDate: plan.expiryDate,
      isActive: plan.isActive,
      provider: plan.provider,
      platform: plan.platform,
      allowedFeatures: plan.allowedFeatures,
      // Cancellation lifecycle fields
      autoRenew: plan.autoRenew ?? false,
      cancelledAt: plan.cancelledAt ?? null,
      cancelled,
      /** Date premium will be revoked. Same as expiryDate when cancelled, null otherwise. */
      willDowngradeOn: cancelled ? plan.expiryDate : null,
      subscriptionId: plan.subscriptionId ?? null,
    });
  } catch (e) {
    return res
      .status(500)
      .json({ message: 'Failed to fetch subscription status', error: e.message });
  }
};

/* ─────────────────────────────────────────────────────────────
   Cancel Subscription  (POST /api/payments/subscription/cancel)
   ──────────────────────────────────────────────────────────────
   Industry-standard "cancel" semantics (Netflix / Spotify / Apple):
     • autoRenew → false
     • cancelledAt → now()
     • status stays 'active' until expiryDate is reached
     • The daily sweep flips it to 'expired' at the boundary
   The user keeps premium access for the rest of the billing period.
───────────────────────────────────────────────────────────── */

export const cancelSubscription = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const sub = await Subscription.findActiveForUser(userId);
    if (!sub) {
      return res.status(404).json({
        message: 'No active subscription to cancel',
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
    }

    // Already cancelled — idempotent.
    if (sub.autoRenew === false && sub.cancelledAt) {
      return res.status(200).json({
        message: 'Subscription is already cancelled',
        cancelled: true,
        autoRenew: false,
        cancelledAt: sub.cancelledAt,
        expiryDate: sub.expiryDate,
        willDowngradeOn: sub.expiryDate,
        tier: sub.planTier,
      });
    }

    const now = new Date();
    await Subscription.updateOne(
      { _id: sub._id },
      {
        $set: {
          autoRenew: false,
          cancelledAt: now,
          // status stays 'active' — premium continues until expiryDate
          'metadata.cancellationSource': 'user',
        },
      }
    );

    // Razorpay: this codebase uses one-time orders, not recurring
    // subscriptions, so there is nothing to cancel on the gateway side.
    // For Apple IAP / Razorpay subscriptions (Phase 3+), call the
    // provider's cancel API here. Keep the comment as a placeholder.
    // if (sub.provider === 'apple') await appleService.cancel(sub.originalTransactionId);

    return res.status(200).json({
      message:
        'Subscription cancelled. You will retain premium access until your billing period ends.',
      cancelled: true,
      autoRenew: false,
      cancelledAt: now,
      expiryDate: sub.expiryDate,
      willDowngradeOn: sub.expiryDate,
      tier: sub.planTier,
    });
  } catch (e) {
    console.error('[payments] cancelSubscription error:', e);
    return res.status(500).json({ message: e.message || 'Cancel failed' });
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

/* ─────────────────────────────────────────────────────────────
   Apple IAP — Verify Receipt  (POST /api/payments/apple/verify)
   ──────────────────────────────────────────────────────────────
   Called by the iOS client right after StoreKit returns a successful
   purchase. The client sends the base64 receipt; we round-trip it
   to Apple, then create / update a Subscription document.

   Body: { receipt: "<base64>", productId: "com.getfit.fitness.pro.monthly" }
───────────────────────────────────────────────────────────── */

export const verifyAppleReceipt = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    if (!isAppleIapConfigured()) {
      return res.status(503).json({
        message: 'Apple IAP not configured on server',
        code: 'APPLE_IAP_NOT_CONFIGURED',
      });
    }

    const { receipt, productId: clientProductId } = req.body || {};
    if (!receipt) {
      return res.status(400).json({ message: 'Missing receipt' });
    }

    // 1. Verify with Apple (handles prod → sandbox fallback automatically)
    const verified = await verifyAppleReceiptRaw(receipt);

    // 2. Resolve our internal SKU from the receipt's productId
    //    (NOT the client-supplied one — never trust the client).
    const plan = getPlanByAppleProductId(verified.productId);
    if (!plan) {
      return res.status(400).json({
        message: `Unknown product id: ${verified.productId}`,
        code: 'UNKNOWN_PRODUCT',
      });
    }

    // Soft sanity check — log if client lied about the productId.
    if (clientProductId && clientProductId !== verified.productId) {
      console.warn(
        `[apple-iap] productId mismatch: client=${clientProductId} apple=${verified.productId} userId=${userId}`
      );
    }

    // 3. Idempotent upsert keyed on transactionId (unique-indexed).
    //    If the same transaction comes back (duplicate verify call,
    //    or the user re-installs the app and we re-receipt), update
    //    instead of duplicating.
    const existing = await Subscription.findOne({
      transactionId: verified.transactionId,
    });

    let sub;
    if (existing) {
      // Same transaction, refresh expiry (Apple may extend it after refunds etc.)
      existing.expiryDate = verified.expiresDate;
      existing.autoRenew = verified.isAutoRenewing;
      existing.status =
        verified.expiresDate && verified.expiresDate > new Date()
          ? 'active'
          : 'expired';
      existing.latestReceipt = verified.rawLatestReceipt;
      existing.metadata = {
        ...(existing.metadata || {}),
        environment: verified.environment,
        lastVerifiedAt: new Date(),
      };
      await existing.save();
      sub = existing;
    } else {
      sub = await Subscription.create({
        userId,
        planId: plan.id,
        planTier: plan.tier,
        billingCycle: plan.billingCycle,
        platform: 'ios',
        provider: 'apple',
        status:
          verified.expiresDate && verified.expiresDate > new Date()
            ? 'active'
            : 'expired',
        amount: plan.amountPaise,
        currency: plan.currency,
        appleProductId: verified.productId,
        originalTransactionId: verified.originalTransactionId,
        transactionId: verified.transactionId,
        latestReceipt: verified.rawLatestReceipt,
        startDate: verified.purchaseDate,
        expiryDate: verified.expiresDate,
        autoRenew: verified.isAutoRenewing,
        verified: true,
        metadata: {
          environment: verified.environment,
          isTrial: verified.isTrial,
        },
      });
    }

    // 4. Refresh the cached User.subscriptionPlan field for fast reads.
    if (sub.status === 'active') {
      await User.updateOne(
        { _id: userId },
        {
          $set: {
            subscriptionPlan: plan.tier,
            subscriptionExpiresAt: verified.expiresDate,
            activeSubscriptionId: sub._id,
          },
        }
      );
    }

    return res.status(200).json({
      message: 'Receipt verified',
      subscription: {
        planId: plan.id,
        tier: plan.tier,
        expiryDate: verified.expiresDate,
        autoRenew: verified.isAutoRenewing,
        environment: verified.environment,
      },
    });
  } catch (e) {
    console.error('[payments] verifyAppleReceipt error:', e);
    return res.status(400).json({
      message: e.message || 'Apple receipt verification failed',
      code: 'APPLE_VERIFY_FAILED',
    });
  }
};

/* ─────────────────────────────────────────────────────────────
   Apple IAP — Server Notifications v2  (POST /api/payments/apple/webhook)
   ──────────────────────────────────────────────────────────────
   Apple posts JWS-signed events here for renewals, refunds,
   cancellations, billing retries, etc.

   We mount this route with express.raw() in index.js because the
   notification body is JSON (no HMAC over raw bytes needed) but
   we want to keep parity with the Razorpay webhook setup.

   Apple expects 200 quickly; reply fast then process.
───────────────────────────────────────────────────────────── */

export const appleWebhook = async (req, res) => {
  // Acknowledge immediately so Apple doesn't retry while we work.
  res.status(200).json({ received: true });

  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const notif = parseS2SNotification(raw);

    // Optional bundle id sanity check
    const expectedBundle = process.env.APPLE_BUNDLE_ID || 'com.getfit.fitness';
    if (notif.bundleId && notif.bundleId !== expectedBundle) {
      console.warn(
        `[apple-webhook] bundle id mismatch: got=${notif.bundleId} expected=${expectedBundle}`
      );
      return;
    }

    const tx = notif.transactionInfo;
    if (!tx?.originalTransactionId) {
      console.log('[apple-webhook] no transactionInfo, type=', notif.notificationType);
      return;
    }

    // Find the matching subscription (originalTransactionId is stable across renewals).
    const sub = await Subscription.findOne({
      originalTransactionId: tx.originalTransactionId,
    });

    if (!sub) {
      console.warn(
        `[apple-webhook] no Subscription doc for originalTransactionId=${tx.originalTransactionId}, type=${notif.notificationType}`
      );
      return;
    }

    const action = notificationToAction(notif);
    const newExpiry = tx.expiresDate ? new Date(tx.expiresDate) : sub.expiryDate;

    switch (action.kind) {
      case 'renew': {
        sub.expiryDate = newExpiry;
        sub.status = newExpiry && newExpiry > new Date() ? 'active' : 'expired';
        sub.transactionId = tx.transactionId; // a fresh tx for the renewal
        sub.autoRenew = true;
        sub.cancelledAt = undefined;
        sub.metadata = {
          ...(sub.metadata || {}),
          lastRenewalAt: new Date(),
          environment: notif.environment,
        };
        await sub.save();
        // Push out the User cache too.
        await User.updateOne(
          { _id: sub.userId },
          { $set: { subscriptionExpiresAt: newExpiry, subscriptionPlan: sub.planTier } }
        );
        break;
      }
      case 'autoRenewChange': {
        sub.autoRenew = action.autoRenew;
        if (!action.autoRenew && !sub.cancelledAt) sub.cancelledAt = new Date();
        if (action.autoRenew) sub.cancelledAt = undefined;
        await sub.save();
        break;
      }
      case 'expired':
      case 'failToRenew': {
        sub.status = 'expired';
        sub.autoRenew = false;
        await sub.save();
        // The sweeper will downgrade the User cache on its next pass,
        // but do it eagerly here so the lockdown is immediate.
        await User.updateOne(
          { _id: sub.userId },
          { $set: { subscriptionPlan: 'free' }, $unset: { activeSubscriptionId: '' } }
        );
        break;
      }
      case 'refund': {
        sub.status = 'refunded';
        sub.autoRenew = false;
        sub.refundedAt = new Date();
        await sub.save();
        await User.updateOne(
          { _id: sub.userId },
          { $set: { subscriptionPlan: 'free' }, $unset: { activeSubscriptionId: '' } }
        );
        break;
      }
      default:
        console.log(
          `[apple-webhook] noop type=${notif.notificationType} subtype=${notif.subtype}`
        );
    }
  } catch (e) {
    // Already 200'd, just log. Apple will not retry on our internal errors.
    console.error('[payments] appleWebhook error:', e);
  }
};
