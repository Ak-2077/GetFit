/**
 * Payments Controller
 * ──────────────────────────────────────────────────────────────
 * Endpoints:
 *   GET  /api/payments/plans                    (auth)
 *   POST /api/payments/google/verify            (auth)
 *   POST /api/payments/apple/verify             (auth)
 *   POST /api/payments/apple/webhook            (raw body, public)
 *   GET  /api/payments/subscription/status      (auth)
 *   POST /api/payments/subscription/restore     (auth)
 *   POST /api/payments/subscription/cancel      (auth)
 *
 * Platform billing:
 *   • iOS    → Apple In-App Purchase (StoreKit)
 *   • Android → Google Play Billing
 *
 * Security invariants:
 *   • Plan price is ALWAYS resolved server-side from config/plans.js.
 *   • A subscription only flips to status='active' AFTER server-side
 *     verification with Apple/Google.
 *   • Replay protection: transactionId / googleOrderId are unique-indexed.
 *   • Never trust client-supplied productId — use the one from the
 *     platform's verification API.
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
  resolveActivePlan,
  syncUserPlanCache,
} from '../services/subscriptionService.js';
import {
  isAppleIapConfigured,
  verifyAppleReceipt as verifyAppleReceiptRaw,
  parseS2SNotification,
  notificationToAction,
} from '../services/appleIapService.js';
import { getPlanByAppleProductId, getPlanByGoogleProductId } from '../config/plans.js';
import {
  isGooglePlayConfigured,
  verifySubscription as verifyGoogleToken,
  acknowledgeSubscription as acknowledgeGoogle,
} from '../services/googlePlayService.js';
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
   Google Play: Verify Purchase  (POST /api/payments/google/verify)
   ──────────────────────────────────────────────────────────────
   Called by the Android client after Google Play Billing returns
   a successful purchase. The client sends the purchaseToken and
   productId; we verify with Google's API server-side.

   Body: { purchaseToken: "<token>", productId: "com.getfit.fitness.pro.monthly" }
───────────────────────────────────────────────────────────── */

export const verifyGooglePurchase = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    if (!isGooglePlayConfigured()) {
      return res.status(503).json({
        message: 'Google Play verification not configured on server',
        code: 'GOOGLE_PLAY_NOT_CONFIGURED',
      });
    }

    const { purchaseToken, productId: clientProductId } = req.body || {};
    if (!purchaseToken) {
      return res.status(400).json({ message: 'Missing purchaseToken' });
    }

    // 1. Verify with Google (NEVER trust the client)
    const verified = await verifyGoogleToken(purchaseToken);

    // 2. Resolve our internal SKU from Google's productId
    const plan = getPlanByGoogleProductId(verified.productId);
    if (!plan) {
      return res.status(400).json({
        message: `Unknown product id: ${verified.productId}`,
        code: 'UNKNOWN_PRODUCT',
      });
    }

    // Soft sanity check — log if client lied about the productId.
    if (clientProductId && clientProductId !== verified.productId) {
      console.warn(
        `[google-play] productId mismatch: client=${clientProductId} google=${verified.productId} userId=${userId}`
      );
    }

    // 3. Idempotent upsert keyed on googleOrderId (unique-indexed).
    const existing = verified.orderId
      ? await Subscription.findOne({ googleOrderId: verified.orderId })
      : null;

    let sub;
    if (existing) {
      // Same order, refresh expiry (Google may extend after grace period etc.)
      existing.expiryDate = verified.expiryDate;
      existing.autoRenew = verified.isAutoRenewing;
      existing.status =
        verified.expiryDate && verified.expiryDate > new Date()
          ? 'active'
          : 'expired';
      existing.googlePurchaseToken = purchaseToken;
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
        platform: 'android',
        provider: 'google',
        status:
          verified.expiryDate && verified.expiryDate > new Date()
            ? 'active'
            : 'expired',
        amount: plan.amountPaise,
        currency: plan.currency,
        googleProductId: verified.productId,
        googleOrderId: verified.orderId,
        googlePurchaseToken: purchaseToken,
        startDate: verified.startDate,
        expiryDate: verified.expiryDate,
        autoRenew: verified.isAutoRenewing,
        verified: true,
        metadata: {
          environment: verified.environment,
        },
      });
    }

    // 4. Cancel any other previously-active subs (user upgraded).
    if (sub.status === 'active') {
      await Subscription.updateMany(
        {
          userId,
          _id: { $ne: sub._id },
          status: 'active',
        },
        { $set: { status: 'cancelled', cancelledAt: new Date() } }
      );
    }

    // 5. Acknowledge the purchase with Google (required within 3 days)
    acknowledgeGoogle(purchaseToken, verified.productId).catch(() => {});

    // 6. Refresh the cached User.subscriptionPlan field for fast reads.
    if (sub.status === 'active') {
      await User.updateOne(
        { _id: userId },
        {
          $set: {
            subscriptionPlan: plan.tier,
            subscriptionExpiresAt: verified.expiryDate,
            activeSubscriptionId: sub._id,
          },
        }
      );
    }

    return res.status(200).json({
      message: 'Purchase verified',
      subscription: {
        planId: plan.id,
        tier: plan.tier,
        expiryDate: verified.expiryDate,
        autoRenew: verified.isAutoRenewing,
        environment: verified.environment,
      },
    });
  } catch (e) {
    console.error('[payments] verifyGooglePurchase error:', e.message);
    return res.status(400).json({
      message: e.message || 'Google Play purchase verification failed',
      code: 'GOOGLE_VERIFY_FAILED',
    });
  }
};

/* ─────────────────────────────────────────────────────────────
   Subscription Status  (GET /api/payments/subscription/status)
───────────────────────────────────────────────────────────── */

export const getSubscriptionStatus = async (req, res) => {
  try {
    const plan = await resolveActivePlan(req.userId);
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
      autoRenew: plan.autoRenew ?? false,
      cancelledAt: plan.cancelledAt ?? null,
      cancelled,
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

   NOTE: For Apple IAP and Google Play subscriptions, the actual
   cancellation must happen through the platform's subscription
   management page. This endpoint only records the intent locally.
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
          'metadata.cancellationSource': 'user',
        },
      }
    );

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
   Works for both platforms — refreshes the subscription cache.
   Platform-specific receipt/token re-verification is done
   client-side via IAPService before calling this endpoint.
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
    const plan = getPlanByAppleProductId(verified.productId);
    if (!plan) {
      return res.status(400).json({
        message: `Unknown product id: ${verified.productId}`,
        code: 'UNKNOWN_PRODUCT',
      });
    }

    // Soft sanity check
    if (clientProductId && clientProductId !== verified.productId) {
      console.warn(
        `[apple-iap] productId mismatch: client=${clientProductId} apple=${verified.productId} userId=${userId}`
      );
    }

    // 3. Idempotent upsert keyed on transactionId (unique-indexed).
    const existing = await Subscription.findOne({
      transactionId: verified.transactionId,
    });

    let sub;
    if (existing) {
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
───────────────────────────────────────────────────────────── */

export const appleWebhook = async (req, res) => {
  // Acknowledge immediately so Apple doesn't retry while we work.
  res.status(200).json({ received: true });

  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const notif = parseS2SNotification(raw);

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
        sub.transactionId = tx.transactionId;
        sub.autoRenew = true;
        sub.cancelledAt = undefined;
        sub.metadata = {
          ...(sub.metadata || {}),
          lastRenewalAt: new Date(),
          environment: notif.environment,
        };
        await sub.save();
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
    console.error('[payments] appleWebhook error:', e);
  }
};
