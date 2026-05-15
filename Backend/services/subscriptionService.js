/**
 * Subscription Service
 * ──────────────────────────────────────────────────────────────
 * Centralizes the "what plan does this user have right now?" logic
 * so controllers and middleware never re-implement it.
 *
 *   resolveActivePlan(userId) →
 *     {
 *       tier: 'free' | 'pro' | 'pro_plus',
 *       planId, billingCycle, expiryDate, subscriptionId,
 *       allowedFeatures, isActive
 *     }
 *
 * Single Mongo round-trip per call. Falls back to the User cache
 * (`subscriptionPlan` field) if no Subscription document is found
 * — useful during the migration window.
 * ──────────────────────────────────────────────────────────────
 */

import Subscription from '../models/subscription.js';
import User from '../models/user.js';
import { getFeaturesForTier } from '../config/plans.js';

/**
 * Returns the user's effective plan + features.
 * Auto-marks expired subscriptions on the fly so stale "active"
 * rows don't keep granting access.
 */
export const resolveActivePlan = async (userId) => {
  if (!userId) {
    return _freePlan();
  }

  const sub = await Subscription.findActiveForUser(userId);

  if (sub) {
    return {
      tier: sub.planTier,
      planId: sub.planId,
      billingCycle: sub.billingCycle,
      expiryDate: sub.expiryDate,
      subscriptionId: sub._id,
      provider: sub.provider,
      platform: sub.platform,
      allowedFeatures: getFeaturesForTier(sub.planTier),
      isActive: true,
      verified: true,
      // Cancellation lifecycle metadata. autoRenew=false + cancelledAt
      // means the user has cancelled but premium remains until expiryDate.
      autoRenew: !!sub.autoRenew,
      cancelledAt: sub.cancelledAt || null,
      status: sub.status, // 'active' even after cancel — cancel only flips autoRenew
    };
  }

  // Sweep stale rows — flip any "active" subs whose expiry has passed.
  await _expireStale(userId);

  // Fallback: legacy User.subscriptionPlan cache (pre-migration users).
  const user = await User.findById(userId).select('subscriptionPlan').lean();
  const legacyTier = user?.subscriptionPlan || 'free';

  return {
    tier: legacyTier,
    planId: null,
    billingCycle: null,
    expiryDate: null,
    subscriptionId: null,
    provider: null,
    platform: null,
    allowedFeatures: getFeaturesForTier(legacyTier),
    isActive: legacyTier !== 'free',
    verified: false,
  };
};

/**
 * Lightweight check used by middleware.
 *
 * @param {string} userId
 * @param {'pro'|'pro_plus'} requiredTier
 * @returns {Promise<boolean>}
 */
export const userHasTier = async (userId, requiredTier) => {
  const plan = await resolveActivePlan(userId);
  if (requiredTier === 'pro') return plan.tier === 'pro' || plan.tier === 'pro_plus';
  if (requiredTier === 'pro_plus') return plan.tier === 'pro_plus';
  return true;
};

/**
 * Sync the User.subscriptionPlan cache to match the active sub.
 * Called after every successful purchase / restore.
 */
export const syncUserPlanCache = async (userId) => {
  const plan = await resolveActivePlan(userId);
  await User.findByIdAndUpdate(userId, {
    subscriptionPlan: plan.tier,
  });
  return plan;
};

/* ── Internal ──────────────────────────────────────────────── */

const _freePlan = () => ({
  tier: 'free',
  planId: null,
  billingCycle: null,
  expiryDate: null,
  subscriptionId: null,
  provider: null,
  platform: null,
  allowedFeatures: getFeaturesForTier('free'),
  isActive: false,
  verified: false,
});

const _expireStale = async (userId) => {
  await Subscription.updateMany(
    {
      userId,
      status: 'active',
      expiryDate: { $lte: new Date() },
    },
    { $set: { status: 'expired' } }
  );
};

export default {
  resolveActivePlan,
  userHasTier,
  syncUserPlanCache,
};
