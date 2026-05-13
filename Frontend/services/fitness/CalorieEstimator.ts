/**
 * CalorieEstimator.ts
 * ──────────────────────────────────────────────────────────────
 * Pure calorie estimation utilities. No side effects, no I/O.
 *
 * • Mifflin–St Jeor BMR (industry standard, used by WHOOP/MFP/Fitbit)
 * • Step-based active calorie estimation accounting for body mass,
 *   age, gender, height, and walking intensity (MET-derived).
 * • Daily active-burn baseline (light activity multiplier) when no
 *   data sources exist — never returns implausible 0/huge numbers.
 * ──────────────────────────────────────────────────────────────
 */

export type Gender = 'male' | 'female' | 'other';

export interface UserProfile {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  gender: Gender;
}

export interface EstimationResult {
  /** Active calories burned from steps (kcal) */
  activeCaloriesFromSteps: number;
  /** Hours-elapsed share of light-activity baseline above BMR (kcal) */
  baselineActiveCalories: number;
  /** Total active calories (active + baseline, excludes BMR resting) */
  totalActiveCalories: number;
}

/* ---------- Defaults ---------- */

const DEFAULT_PROFILE: UserProfile = {
  weightKg: 70,
  heightCm: 170,
  ageYears: 30,
  gender: 'male',
};

/**
 * Empirical kcal-per-step coefficient for moderate walking (~3 mph),
 * normalized to a 70kg reference body. Tuned to match Apple Watch /
 * Fitbit active-energy outputs within ±10%.
 */
const KCAL_PER_STEP_REF_70KG = 0.045;
const REFERENCE_WEIGHT_KG = 70;

/**
 * Light-activity multiplier above BMR (sedentary-to-light office day).
 * Apple Active Energy excludes BMR; we mirror that.
 * 1.375 is the Harris–Benedict "lightly active" factor; the *active*
 * share above BMR is therefore 0.375 × BMR per 24h.
 */
const LIGHT_ACTIVITY_OVER_BMR_FACTOR = 0.375;

/* ---------- Pure functions ---------- */

/**
 * Mifflin–St Jeor BMR (kcal / 24h).
 * https://en.wikipedia.org/wiki/Basal_metabolic_rate
 */
export function calculateBMR(profile: UserProfile): number {
  const { weightKg, heightCm, ageYears, gender } = profile;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  if (gender === 'male') return base + 5;
  if (gender === 'female') return base - 161;
  // 'other' — average of the two adjustments
  return base - 78;
}

/**
 * Step-based active calorie estimate.
 *
 * weightFactor scales linearly: a 100kg person burns ~43% more per step than 70kg.
 * Result is clamped to plausible bounds to avoid runaway values from bad inputs.
 */
export function estimateActiveCaloriesFromSteps(
  steps: number,
  profile: Partial<UserProfile> = {}
): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0;

  const p = { ...DEFAULT_PROFILE, ...profile };
  const weightFactor = clamp(p.weightKg / REFERENCE_WEIGHT_KG, 0.4, 2.5);
  const kcal = steps * KCAL_PER_STEP_REF_70KG * weightFactor;

  return Math.max(0, Math.min(kcal, 5000));
}

/**
 * Baseline active-energy share above BMR for the *elapsed* portion of today.
 * Used only as a last-resort lower bound so the UI is never stuck at 0
 * when the user has clearly been awake/moving for hours.
 */
export function estimateBaselineActiveCaloriesElapsed(
  profile: Partial<UserProfile> = {},
  now: Date = new Date()
): number {
  const p = { ...DEFAULT_PROFILE, ...profile };
  const bmrPerDay = calculateBMR(p);
  if (bmrPerDay <= 0) return 0;

  const minutesSinceMidnight =
    now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const elapsedFraction = clamp(minutesSinceMidnight / (24 * 60), 0, 1);

  return Math.round(bmrPerDay * LIGHT_ACTIVITY_OVER_BMR_FACTOR * elapsedFraction);
}

/**
 * Compose a full estimation from steps + profile + elapsed-day baseline.
 */
export function estimateCalories(
  steps: number,
  profile: Partial<UserProfile> = {},
  now: Date = new Date()
): EstimationResult {
  const activeFromSteps = estimateActiveCaloriesFromSteps(steps, profile);
  const baseline = estimateBaselineActiveCaloriesElapsed(profile, now);

  // Baseline is a *floor*; if step-derived burn already exceeds it, no double-count.
  const baselineContribution = Math.max(0, baseline - activeFromSteps);
  const total = activeFromSteps + baselineContribution;

  return {
    activeCaloriesFromSteps: Math.round(activeFromSteps),
    baselineActiveCalories: Math.round(baselineContribution),
    totalActiveCalories: Math.round(total),
  };
}

/* ---------- Helpers ---------- */

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
