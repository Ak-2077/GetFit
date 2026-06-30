/**
 * checkDailyUsage(field) middleware
 * ──────────────────────────────────────────────────────────────
 * Enforces per-day free-tier usage limits, atomically, on the backend.
 * Use AFTER `auth` so req.userId is populated.
 *
 *   router.post('/recognize', auth, checkDailyUsage('foodScans'), handler)
 *
 * Flow:
 *   1. Resolve the user's active plan (subscriptionService — single source).
 *   2. Premium (pro / pro_plus) → bypass, attach unlimited usage info.
 *   3. Free → atomically consume one unit BEFORE the AI runs. If the
 *      limit is reached, respond 429 and never reach the handler.
 *
 * Why increment BEFORE the AI: prevents retry abuse. A user cannot burn
 * the model and then dodge the counter by aborting the response.
 *
 * The atomic consume() guarantees that two simultaneous requests with
 * one scan remaining result in exactly one success + one 429.
 *
 * On success it attaches `req.usageInfo` so the route can echo
 * remaining/limit/subscription in its response.
 * ──────────────────────────────────────────────────────────────
 */

import UserUsage from '../models/userUsage.js';
import { resolveActivePlan } from '../services/subscriptionService.js';
import { USAGE_LIMITS, UNLIMITED_TIERS, nextMidnightISO } from '../config/usageLimits.js';

// Human-readable labels for 429 messages, per gated field.
const FEATURE_LABELS = {
  foodScans: 'AI food scan',
  barcodeScans: 'barcode scan',
  aiCoachChats: 'AI coach chat',
};

const checkDailyUsage = (field) => async (req, res, next) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const limit = USAGE_LIMITS[field];
    if (limit === undefined) {
      // Misconfiguration — fail open rather than block a paying user,
      // but log loudly so it's caught in dev.
      console.warn(`[checkDailyUsage] Unknown usage field "${field}" — skipping enforcement`);
      return next();
    }

    // ── Resolve plan (auto-expires stale subs inside) ──
    let tier = 'free';
    try {
      const plan = await resolveActivePlan(req.userId);
      tier = plan?.tier || 'free';
    } catch (e) {
      // If the subscription lookup fails, treat as free so limits still apply.
      console.warn('[checkDailyUsage] plan resolve failed, defaulting to free:', e.message);
    }

    // ── Premium → unlimited bypass ──
    if (UNLIMITED_TIERS.includes(tier)) {
      req.usageInfo = {
        subscription: tier === 'pro_plus' ? 'premium' : 'premium',
        tier,
        remaining: null,
        limit: null,
        unlimited: true,
      };
      return next();
    }

    // ── Free → atomic consume BEFORE running the AI ──
    const { allowed, used } = await UserUsage.consume(req.userId, field, limit);

    if (!allowed) {
      const label = FEATURE_LABELS[field] || 'feature';
      return res.status(429).json({
        success: false,
        code: 'DAILY_SCAN_LIMIT',
        message: `You've reached today's ${label} limit.`,
        remaining: 0,
        limit,
        resetAt: nextMidnightISO(),
        upgradeRequired: true,
        subscription: 'free',
      });
    }

    const remaining = Math.max(0, limit - used);
    req.usageInfo = {
      subscription: 'free',
      tier: 'free',
      remaining,
      limit,
      unlimited: false,
      // expose the field that was consumed so handlers can build a precise response
      field,
    };

    return next();
  } catch (e) {
    console.error('[checkDailyUsage] error:', e);
    return res.status(500).json({ success: false, message: 'Usage check failed', error: e.message });
  }
};

export default checkDailyUsage;
