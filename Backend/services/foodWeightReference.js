/**
 * Central Immutable Food Weight Reference Table
 * ──────────────────────────────────────────────────────────────
 * Single source of truth for per-UNIT weights of COUNTABLE foods.
 * Reusable by the portion estimator and all nutrition providers.
 *
 * Weights are grams for ONE item at small / medium / large size.
 * `default` is the medium weight used when size is unknown.
 *
 * Frozen so no caller can accidentally mutate it.
 * ──────────────────────────────────────────────────────────────
 */

export const FOOD_WEIGHT_REFERENCE = Object.freeze({
  // ── Eggs ──
  'egg':            { small: 45, medium: 50, large: 60, default: 50 },
  'boiled egg':     { small: 45, medium: 50, large: 60, default: 50 },
  'hard-boiled egg':{ small: 45, medium: 50, large: 60, default: 50 },
  'hard boiled egg':{ small: 45, medium: 50, large: 60, default: 50 },
  'soft-boiled egg':{ small: 45, medium: 50, large: 60, default: 50 },
  'soft boiled egg':{ small: 45, medium: 50, large: 60, default: 50 },
  'fried egg':      { small: 46, medium: 50, large: 60, default: 50 },
  'poached egg':    { small: 45, medium: 50, large: 60, default: 50 },
  'egg white':      { small: 30, medium: 33, large: 38, default: 33 },

  // ── Flatbreads / baked single items ──
  'roti':       { small: 30, medium: 40, large: 55, default: 40 },
  'chapati':    { small: 30, medium: 40, large: 55, default: 40 },
  'naan':       { small: 60, medium: 90, large: 120, default: 90 },
  'paratha':    { small: 45, medium: 60, large: 80, default: 60 },
  'puri':       { small: 18, medium: 25, large: 35, default: 25 },
  'bread':      { small: 25, medium: 30, large: 40, default: 30 },
  'bread slice':{ small: 25, medium: 30, large: 40, default: 30 },
  'toast':      { small: 20, medium: 25, large: 35, default: 25 },

  // ── South-Indian single items ──
  'idli':  { small: 45, medium: 55, large: 70, default: 55 },
  'vada':  { small: 35, medium: 50, large: 65, default: 50 },
  'dosa':  { small: 60, medium: 80, large: 120, default: 80 },

  // ── Snacks ──
  'samosa':  { small: 50, medium: 80, large: 110, default: 80 },
  'pakora':  { small: 15, medium: 25, large: 35, default: 25 },
  'cookie':  { small: 10, medium: 15, large: 25, default: 15 },
  'muffin':  { small: 50, medium: 80, large: 120, default: 80 },
  'donut':   { small: 50, medium: 70, large: 90, default: 70 },
  'croissant': { small: 40, medium: 60, large: 80, default: 60 },
  'pancake': { small: 45, medium: 65, large: 90, default: 65 },

  // ── Fruits (whole) ──
  'apple':   { small: 130, medium: 180, large: 220, default: 180 },
  'banana':  { small: 90, medium: 120, large: 150, default: 120 },
  'orange':  { small: 100, medium: 130, large: 170, default: 130 },
  'mango':   { small: 150, medium: 200, large: 300, default: 200 },
  'kiwi':    { small: 60, medium: 75, large: 95, default: 75 },
  'peach':   { small: 120, medium: 150, large: 185, default: 150 },

  // ── Sweets (single piece) ──
  'gulab jamun': { small: 30, medium: 40, large: 55, default: 40 },
  'rasgulla':    { small: 35, medium: 45, large: 60, default: 45 },
  'ladoo':       { small: 25, medium: 40, large: 55, default: 40 },
  'jalebi':      { small: 15, medium: 25, large: 40, default: 25 },
});

/** Size aliases → canonical bucket. */
const SIZE_ALIASES = {
  small: 'small', tiny: 'small', mini: 'small', 'bite-sized': 'small', half: 'small',
  medium: 'medium', regular: 'medium', normal: 'medium',
  large: 'large', big: 'large', huge: 'large', generous: 'large', 'very large': 'large', full: 'large',
};

/**
 * Is this food countable (has a per-unit reference weight)?
 * Matches the longest reference key contained in the food name so
 * "boiled egg" resolves to the egg family, not a partial mismatch.
 */
export function getCountableReference(foodName) {
  const lower = (foodName || '').toLowerCase().trim();
  if (FOOD_WEIGHT_REFERENCE[lower]) {
    return { key: lower, weights: FOOD_WEIGHT_REFERENCE[lower] };
  }
  let bestKey = null, bestLen = 0;
  for (const key of Object.keys(FOOD_WEIGHT_REFERENCE)) {
    if ((lower.includes(key) || key.includes(lower)) && key.length > bestLen) {
      bestKey = key; bestLen = key.length;
    }
  }
  return bestKey ? { key: bestKey, weights: FOOD_WEIGHT_REFERENCE[bestKey] } : null;
}

/** Resolve a per-unit weight for a countable food at a given size. */
export function perUnitWeight(foodName, size = 'medium') {
  const ref = getCountableReference(foodName);
  if (!ref) return null;
  const bucket = SIZE_ALIASES[size] || 'medium';
  return ref.weights[bucket] || ref.weights.default;
}

export { SIZE_ALIASES };
