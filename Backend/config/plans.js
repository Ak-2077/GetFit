/**
 * Subscription Plans — single source of truth.
 * ──────────────────────────────────────────────────────────────
 * Every other surface (controller, frontend, Razorpay order) must
 * resolve plan details through getPlanById() so price + duration
 * cannot drift between the client UI and what we charge the card.
 *
 * Pricing is stored in **paise** (smallest INR unit) — Razorpay
 * expects orders in paise too, so no float math anywhere.
 * ──────────────────────────────────────────────────────────────
 */

/* ── Feature catalog (keys consumed by /api/features) ─────────── */

const FREE_FEATURES = ['BMI', 'CALORIES', 'WWP'];
const PRO_FEATURES = ['BMI', 'CALORIES', 'BMB', 'AI_DIET', 'WWP'];
const PRO_PLUS_FEATURES = [
  'BMI',
  'CALORIES',
  'BMB',
  'AI_DIET',
  'WWP',
  'PRIORITY_SUPPORT',
  'AI_TRAINER',
];

/* ── Plan SKUs ───────────────────────────────────────────────── */

const PLANS = [
  {
    id: 'free',
    tier: 'free',
    name: 'Free Plan',
    billingCycle: null,
    durationDays: null,
    amountPaise: 0,
    displayPrice: '₹0',
    period: 'forever',
    currency: 'INR',
    badge: null,
    isPopular: false,
    discountPercent: 0,
    trialDays: 0,
    allowedFeatures: FREE_FEATURES,
    featureList: [
      { name: 'Basic Food Logging', included: true },
      { name: 'Step Tracking', included: true },
      { name: 'BMI Calculator', included: true },
      { name: 'Calories Calculator', included: true },
      { name: 'Weekly Workout Plan', included: true },
      { name: 'Balance Meal Meter', included: false },
      { name: 'AI Diet Plans', included: false },
      { name: 'Priority Support', included: false },
    ],
  },
  {
    id: 'pro_monthly',
    tier: 'pro',
    name: 'AI Trainer Pro',
    billingCycle: 'monthly',
    durationDays: 30,
    amountPaise: 19900, // ₹199
    /** Apple App Store product identifier — must match App Store Connect. */
    appleProductId: 'com.getfit.fitness.pro.monthly',
    displayPrice: '₹199',
    period: '/month',
    currency: 'INR',
    badge: 'Most Popular',
    isPopular: true,
    discountPercent: 0,
    trialDays: 0,
    allowedFeatures: PRO_FEATURES,
    featureList: [
      { name: 'Basic Food Logging', included: true },
      { name: 'Step Tracking', included: true },
      { name: 'BMI Calculator', included: true },
      { name: 'Calories Calculator', included: true },
      { name: 'Weekly Workout Plan', included: true },
      { name: 'Balance Meal Meter', included: true },
      { name: 'AI Diet Plans', included: true },
      { name: 'Priority Support', included: false },
    ],
  },
  {
    id: 'pro_yearly',
    tier: 'pro',
    name: 'AI Trainer Pro',
    billingCycle: 'yearly',
    durationDays: 365,
    amountPaise: 199000, // ₹1,990 (≈ 2 months free vs monthly)
    appleProductId: 'com.getfit.fitness.pro.yearly',
    displayPrice: '₹1,990',
    period: '/year',
    currency: 'INR',
    badge: 'Best Value',
    isPopular: false,
    /** 17% off vs 12× monthly (12×199 = 2388 → 1990). */
    discountPercent: 17,
    trialDays: 0,
    allowedFeatures: PRO_FEATURES,
    featureList: [
      { name: 'Basic Food Logging', included: true },
      { name: 'Step Tracking', included: true },
      { name: 'BMI Calculator', included: true },
      { name: 'Calories Calculator', included: true },
      { name: 'Weekly Workout Plan', included: true },
      { name: 'Balance Meal Meter', included: true },
      { name: 'AI Diet Plans', included: true },
      { name: 'Priority Support', included: false },
    ],
  },
  {
    id: 'pro_plus_monthly',
    tier: 'pro_plus',
    name: 'AI Trainer Pro+',
    billingCycle: 'monthly',
    durationDays: 30,
    amountPaise: 39900, // ₹399
    appleProductId: 'com.getfit.fitness.proplus.monthly',
    displayPrice: '₹399',
    period: '/month',
    currency: 'INR',
    badge: 'Pro Plus',
    isPopular: false,
    discountPercent: 0,
    trialDays: 0,
    allowedFeatures: PRO_PLUS_FEATURES,
    featureList: [
      { name: 'Everything in Pro', included: true },
      { name: 'AI Personal Trainer', included: true },
      { name: 'Priority Support', included: true },
      { name: 'Advanced Analytics', included: true },
      { name: 'Custom Workout Plans', included: true },
    ],
  },
  {
    id: 'pro_plus_yearly',
    tier: 'pro_plus',
    name: 'AI Trainer Pro+',
    billingCycle: 'yearly',
    durationDays: 365,
    amountPaise: 399000, // ₹3,990 (≈ 2 months free vs monthly)
    appleProductId: 'com.getfit.fitness.proplus.yearly',
    displayPrice: '₹3,990',
    period: '/year',
    currency: 'INR',
    badge: 'Best Value',
    isPopular: false,
    discountPercent: 17,
    trialDays: 0,
    allowedFeatures: PRO_PLUS_FEATURES,
    featureList: [
      { name: 'Everything in Pro', included: true },
      { name: 'AI Personal Trainer', included: true },
      { name: 'Priority Support', included: true },
      { name: 'Advanced Analytics', included: true },
      { name: 'Custom Workout Plans', included: true },
    ],
  },
];

/* ── Lookup helpers ──────────────────────────────────────────── */

const PLAN_INDEX = Object.fromEntries(PLANS.map((p) => [p.id, p]));

/** Reverse lookup: Apple product id → internal SKU. */
const APPLE_PRODUCT_INDEX = Object.fromEntries(
  PLANS.filter((p) => p.appleProductId).map((p) => [p.appleProductId, p])
);

export const getAllPlans = () => PLANS;

export const getPaidPlans = () => PLANS.filter((p) => p.tier !== 'free');

export const getPlanById = (planId) => PLAN_INDEX[planId] || null;

/** Resolve a plan from its Apple App Store product identifier. */
export const getPlanByAppleProductId = (productId) =>
  APPLE_PRODUCT_INDEX[productId] || null;

/** Returns the feature list for a plan tier ("pro", "pro_plus", "free"). */
export const getFeaturesForTier = (tier) => {
  if (tier === 'pro_plus') return PRO_PLUS_FEATURES;
  if (tier === 'pro') return PRO_FEATURES;
  return FREE_FEATURES;
};

/** Numerical rank of a tier — used for upgrade-only checks. */
export const tierRank = (tier) => {
  if (tier === 'pro_plus') return 2;
  if (tier === 'pro') return 1;
  return 0;
};

export default {
  getAllPlans,
  getPaidPlans,
  getPlanById,
  getPlanByAppleProductId,
  getFeaturesForTier,
  tierRank,
};
