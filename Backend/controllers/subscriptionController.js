import { getAllPlans } from '../config/plans.js';
import { resolveActivePlan } from '../services/subscriptionService.js';

/**
 * ⚠ DEPRECATED. The original implementation directly mutated
 * `user.subscriptionPlan` with no payment verification — a
 * trivial premium-bypass exploit.
 *
 * Real upgrades now go through:
 *   POST /api/payments/razorpay/create-order
 *   POST /api/payments/razorpay/verify
 *
 * This stub is kept only so older client builds get a clean,
 * informative error instead of a silent unlock.
 */
export const upgradePlan = async (_req, res) => {
  return res.status(410).json({
    message:
      'This endpoint is deprecated. Use /api/payments/razorpay/create-order to start a real payment.',
    code: 'UPGRADE_FLOW_CHANGED',
  });
};

/**
 * Returns plans + the user's current tier.
 *
 * Shape preserved for backwards compatibility with older clients
 * (still emits `key`, `price`, `period`, `features`). New clients
 * should consume /api/payments/plans which exposes the full SKU
 * catalogue including monthly + yearly billing cycles.
 */
export const getPlans = async (req, res) => {
  try {
    const current = await resolveActivePlan(req.userId);

    // Compress 5 SKUs → 3 legacy keys: free / pro / pro_plus
    // (pick the monthly variant to stay backwards compatible).
    const all = getAllPlans();
    const legacy = all
      .filter((p) => p.tier === 'free' || p.billingCycle === 'monthly')
      .map((p) => ({
        key: p.tier,
        name: p.name,
        price: p.displayPrice,
        period: p.period,
        badge: p.badge || undefined,
        features: p.featureList,
      }));

    return res.status(200).json({
      currentPlan: current.tier,
      plans: legacy,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: 'Failed to fetch plans', error: error.message });
  }
};
