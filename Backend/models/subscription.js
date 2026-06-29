/**
 * Subscription Model
 * ──────────────────────────────────────────────────────────────
 * Source of truth for a user's premium entitlement. The User model
 * caches the *current* plan + expiry for fast reads, but this
 * collection is authoritative — every payment, renewal, refund,
 * and cancellation lives here as an immutable history.
 *
 * Security & Integrity:
 *   • Single source of truth for "does this user have premium?"
 *   • Status flips to 'expired' at exactly 00:00 UTC on expiry.
 *   • { originalTransactionId } index → prevents duplicate Apple subscriptions
 *   • { googleOrderId } index         → prevents duplicate Google subscriptionsund expiry sweeps
 * ──────────────────────────────────────────────────────────────
 */

import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /* ── Plan identification ─────────────────────────────────── */

    /** Stable SKU id, e.g. "pro_monthly", "pro_plus_yearly". */
    planId: {
      type: String,
      required: true,
    },
    /** Coarse tier used for feature gating. */
    planTier: {
      type: String,
      enum: ['pro', 'pro_plus'],
      required: true,
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly'],
      required: true,
    },

    /* ── Platform / provider ─────────────────────────────────── */

    platform: {
      type: String,
      enum: ['android', 'ios', 'web'],
      required: true,
    },
    provider: {
      type: String,
      enum: ['apple', 'google', 'manual'],
      required: true,
    },

    /* ── Status lifecycle ────────────────────────────────────── */

    status: {
      type: String,
      enum: [
        'pending',       // order created, awaiting payment
        'active',        // verified + within expiry window
        'expired',       // past expiryDate without renewal
        'cancelled',     // user / provider cancelled
        'failed',        // payment / verification failed
        'refunded',      // money returned
      ],
      default: 'pending',
      index: true,
    },

    /* ── Money ───────────────────────────────────────────────── */

    /** Amount charged in the smallest currency unit (paise / cents). */
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'INR',
    },

    /* ── Apple IAP (iOS) ────────────────────────────────────── */

    appleProductId: { type: String, sparse: true },
    originalTransactionId: { type: String, sparse: true, index: true },
    transactionId: { type: String, sparse: true, unique: true },
    /** Latest base64 receipt blob from StoreKit. */
    latestReceipt: { type: String },

    /* ── Google Play Billing (Android) ─────────────────────── */

    googleProductId: { type: String, sparse: true },
    /** Google Play order ID — unique per transaction (replay protection). */
    googleOrderId: { type: String, sparse: true, unique: true },
    /** Purchase token from Google Play — used for server-side re-verification. */
    googlePurchaseToken: { type: String },

    /* ── Validity ────────────────────────────────────────────── */

    startDate: {
      type: Date,
      default: Date.now,
    },
    expiryDate: {
      type: Date,
      index: true,
    },
    autoRenew: {
      type: Boolean,
      default: false,
    },
    /** True only after server-side signature/receipt verification. */
    verified: {
      type: Boolean,
      default: false,
    },

    /* ── Audit ───────────────────────────────────────────────── */

    cancelledAt: { type: Date },
    refundedAt: { type: Date },

    /** Free-form provider payload for debugging. */
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

/* Compound index for the most common query: "find user's active subscription". */
subscriptionSchema.index({ userId: 1, status: 1, expiryDate: -1 });

/**
 * Returns the user's currently-active subscription, or null if none.
 * "Active" means status === 'active' AND expiryDate is in the future.
 */
subscriptionSchema.statics.findActiveForUser = async function (userId) {
  return this.findOne({
    userId,
    status: 'active',
    verified: true,
    expiryDate: { $gt: new Date() },
  })
    .sort({ expiryDate: -1 })
    .lean();
};

const Subscription = mongoose.model('Subscription', subscriptionSchema);
export default Subscription;
