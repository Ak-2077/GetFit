/**
 * Feature controller
 * Reads the user's active plan from the authoritative Subscription
 * collection (via subscriptionService) and returns the allowed
 * feature flags. Always server-resolved — the frontend can't lie.
 */

import { resolveActivePlan } from '../services/subscriptionService.js';

export const getFeatures = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const plan = await resolveActivePlan(userId);

    return res.status(200).json({
      subscriptionPlan: plan.tier,
      planId: plan.planId,
      expiryDate: plan.expiryDate,
      isActive: plan.isActive,
      allowedFeatures: plan.allowedFeatures,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to fetch features',
      error: error.message,
    });
  }
};
