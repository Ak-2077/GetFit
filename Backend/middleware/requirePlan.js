/**
 * requirePlan middleware
 * ──────────────────────────────────────────────────────────────
 * Gates routes to a minimum subscription tier. Use AFTER the
 * `auth` middleware so req.userId is populated.
 *
 *   router.post('/ai-diet', auth, requirePlan('pro'), handler)
 *   router.post('/ai-trainer', auth, requirePlan('pro_plus'), handler)
 *
 * Returns 402 (Payment Required) on a tier mismatch — the frontend
 * intercepts this and routes the user to /upgrade.
 * ──────────────────────────────────────────────────────────────
 */

import { userHasTier } from '../services/subscriptionService.js';

const requirePlan = (minTier = 'pro') => async (req, res, next) => {
  try {
    if (!req.userId) return res.status(401).json({ message: 'Unauthorized' });

    const ok = await userHasTier(req.userId, minTier);
    if (!ok) {
      return res.status(402).json({
        message: `This feature requires the ${minTier} plan`,
        code: 'UPGRADE_REQUIRED',
        requiredTier: minTier,
      });
    }
    next();
  } catch (e) {
    return res.status(500).json({ message: 'Plan check failed', error: e.message });
  }
};

export default requirePlan;
