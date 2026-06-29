/**
 * Portion Estimator v2 — Object-Aware Weight Estimation
 * ──────────────────────────────────────────────────────────────
 * Pipeline (in priority order):
 *   Stage 1  Count-based  → countable foods ALWAYS use detected count × per-unit
 *   Stage 2  Size adjust  → small/medium/large modifies per-unit weight
 *   Stage 3  Area-based   → non-countable foods use plate/bowl serving defaults
 *   Stage 5  Confidence   → portionConfidence per method
 *   Stage 6  Source       → portionSource: count|visual_size|plate_area|database_default|manual
 *
 * Weight is ALWAYS finalized BEFORE nutrition lookup.
 * Backward compatible: still returns { grams, perUnit, size, count } plus new
 * { portionConfidence, portionSource }.
 * ──────────────────────────────────────────────────────────────
 */

import FoodMemory from '../models/foodMemory.js';
import { getCountableReference, perUnitWeight, SIZE_ALIASES } from './foodWeightReference.js';

// ═══ STAGE 3: AREA-BASED SERVING DEFAULTS (non-countable foods) ═══
const SERVING_DEFAULTS = {
  'rice': { small: 100, medium: 150, large: 250 },
  'fried rice': { small: 150, medium: 250, large: 350 },
  'biryani': { small: 200, medium: 320, large: 450 },
  'pulao': { small: 150, medium: 200, large: 300 },
  'pasta': { small: 150, medium: 200, large: 300 },
  'spaghetti': { small: 150, medium: 200, large: 300 },
  'noodle': { small: 150, medium: 200, large: 300 },
  'noodles': { small: 150, medium: 200, large: 300 },
  'curry': { small: 120, medium: 180, large: 250 },
  'chicken curry': { small: 120, medium: 180, large: 250 },
  'dal': { small: 120, medium: 200, large: 280 },
  'salad': { small: 80, medium: 150, large: 250 },
  'soup': { small: 150, medium: 250, large: 350 },
  'stew': { small: 150, medium: 250, large: 350 },
  'khichdi': { small: 150, medium: 200, large: 300 },
  'poha': { small: 100, medium: 150, large: 220 },
  'upma': { small: 100, medium: 150, large: 220 },
  'porridge': { small: 150, medium: 250, large: 350 },
  'oats': { small: 30, medium: 45, large: 60 },
  'oatmeal': { small: 150, medium: 220, large: 300 },
  'cereal': { small: 30, medium: 40, large: 55 },
  'chicken': { small: 80, medium: 120, large: 180 },
  'grilled chicken': { small: 90, medium: 120, large: 180 },
  'fish': { small: 80, medium: 120, large: 180 },
  'steak': { small: 120, medium: 200, large: 300 },
  'paneer': { small: 60, medium: 100, large: 150 },
  'scrambled egg': { small: 60, medium: 100, large: 140 },
  'omelet': { small: 80, medium: 120, large: 160 },
  'omelette': { small: 80, medium: 120, large: 160 },
  'egg bhurji': { small: 80, medium: 120, large: 160 },
  'egg curry': { small: 120, medium: 180, large: 250 },
  // Drinks (ml ≈ g)
  'milk': { small: 150, medium: 200, large: 300 },
  'lassi': { small: 150, medium: 200, large: 300 },
  'juice': { small: 150, medium: 250, large: 350 },
  'smoothie': { small: 200, medium: 300, large: 450 },
  'shake': { small: 200, medium: 350, large: 500 },
  'tea': { small: 100, medium: 150, large: 200 },
  'coffee': { small: 100, medium: 150, large: 200 },
};

function resolveSize(portionCues = []) {
  for (const c of portionCues) {
    const a = SIZE_ALIASES[c];
    if (a === 'small' || a === 'large') return a;
  }
  return 'medium';
}

function lookupServingDefault(lower, size) {
  let best = null, bestLen = 0;
  for (const [key, sizes] of Object.entries(SERVING_DEFAULTS)) {
    if ((lower.includes(key) || key.includes(lower)) && key.length > bestLen) {
      best = sizes; bestLen = key.length;
    }
  }
  if (!best) return null;
  return best[size] || best.medium;
}

// ── Confirmation threshold: below this, the UI should ask the user. ──
export const CONFIRM_THRESHOLD = 0.95;

/**
 * Build small/medium/large/xl portion options for the confirmation sheet.
 * Anchored to the estimated medium weight so options scale per food.
 */
function buildPortionOptions(mediumGrams) {
  const m = Math.max(20, Math.round(mediumGrams));
  return [
    { label: 'Small', grams: Math.round(m * 0.6) },
    { label: 'Medium', grams: m },
    { label: 'Large', grams: Math.round(m * 1.4) },
    { label: 'Extra Large', grams: Math.round(m * 1.9) },
  ];
}

/**
 * Estimate portion weight in grams. Weight is finalized here, before any
 * nutrition lookup.
 *
 * @returns {{ grams, perUnit, size, count, portionConfidence, portionSource }}
 */
export async function estimatePortion(foodName, portionCues = [], count = 1, category = '', ontologyGrams = null, userId = null) {
  const lower = (foodName || '').toLowerCase().trim();
  const size = resolveSize(portionCues);
  const safeCount = Math.max(1, Math.round(Number(count) || 1));

  // ── STAGE 1: COUNT-BASED (highest priority) ──
  // Countable foods ALWAYS use detected count × per-unit reference weight.
  // The ontology serving-default is intentionally IGNORED here — that was the
  // bug that made 1 boiled egg show as 150g.
  const ref = getCountableReference(lower);
  if (ref) {
    const unit = perUnitWeight(lower, size); // Stage 2: size-adjusted per-unit
    const grams = unit * safeCount;
    const result = {
      grams,
      perUnit: unit,
      size,
      count: safeCount,
      portionConfidence: 0.99,                 // Stage 6: count-based = highest
      portionSource: 'count',                  // Stage 7
      estimatedWeight: grams,
      needsConfirmation: false,                // Stage 1: never ask for countable
      portionOptions: buildPortionOptions(unit),
    };
    // User history may refine, but never silently 3x the count.
    return await _applyHistory(result, lower, safeCount, userId);
  }

  // ── STAGE 3: AREA-BASED (non-countable foods) ──
  let perUnit = null;
  let portionSource = 'database_default';
  let portionConfidence = 0.55;

  // Ontology default (only for non-countable foods)
  if (ontologyGrams && ontologyGrams[size]) {
    perUnit = ontologyGrams[size];
    portionSource = 'database_default';
    portionConfidence = 0.6;
  }

  // Serving-default table (plate/bowl foods)
  const serving = lookupServingDefault(lower, size);
  if (serving != null) {
    perUnit = serving;
    portionSource = 'plate_area';
    portionConfidence = portionCues.includes('bowl') || portionCues.includes('plate') ? 0.72 : 0.6;
  }

  // Category fallback
  if (perUnit == null) {
    if (category === 'beverage') perUnit = size === 'small' ? 150 : size === 'large' ? 350 : 250;
    else if (category === 'dessert') perUnit = size === 'small' ? 50 : size === 'large' ? 150 : 80;
    else if (category === 'snack') perUnit = size === 'small' ? 30 : size === 'large' ? 100 : 60;
    else perUnit = 100;
    portionSource = 'database_default';
    portionConfidence = 0.5;
  }

  // For area-based foods, count is usually 1 serving (don't multiply servings).
  const grams = perUnit * (safeCount > 1 && ref ? safeCount : 1);
  const result = {
    grams, perUnit, size, count: safeCount, portionConfidence, portionSource,
    estimatedWeight: grams,
    // Stage 2/3: non-countable foods below the confirm threshold ask the user.
    needsConfirmation: portionConfidence < CONFIRM_THRESHOLD,
    portionOptions: buildPortionOptions(perUnit),
  };
  return await _applyHistory(result, lower, safeCount, userId);
}

/**
 * Learning override — uses PortionLearning (Stage 5/14) if the user has
 * repeatedly corrected this food. Falls back to FoodMemory grams.
 * Marks portionSource = 'user_selected' since it reflects a learned preference.
 */
async function _applyHistory(result, lower, count, userId) {
  if (!userId) return result;

  // Stage 5/14: personalized portion learning takes priority.
  try {
    const PortionLearning = (await import('../models/portionLearning.js')).default;
    const learned = await PortionLearning.findOne({ userId, foodName: lower }).lean();
    if (learned && learned.timesCorrected >= 2 && learned.averageWeight > 0) {
      return {
        ...result,
        grams: Math.round(learned.averageWeight),
        perUnit: Math.round(learned.averageWeight) / Math.max(1, count),
        size: 'learned',
        portionConfidence: 0.92,
        portionSource: 'user_selected',
        estimatedWeight: result.estimatedWeight,
        needsConfirmation: false,             // user already taught us
      };
    }
  } catch (err) {
    // model may not exist in some envs — non-fatal
  }

  try {
    const memory = await FoodMemory.findOne({ userId, foodName: lower }).sort({ lastLoggedAt: -1 }).lean();
    if (memory && memory.grams > 0 && memory.logCount > 0) {
      const recent = memory.lastLoggedAt && (Date.now() - new Date(memory.lastLoggedAt).getTime() < 30 * 24 * 60 * 60 * 1000);
      if (memory.logCount > 1 || recent) {
        return {
          ...result,
          grams: memory.grams,
          perUnit: memory.grams / Math.max(1, count),
          size: 'historical',
          portionConfidence: 0.9,
          portionSource: 'user_selected',
          needsConfirmation: false,
        };
      }
    }
  } catch (err) {
    console.warn(`[PortionEstimator] history fetch failed for ${lower}:`, err.message);
  }
  return result;
}
