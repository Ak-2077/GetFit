/**
 * Portion Estimation v2 — automated tests
 * Verifies count-based weight, size adjustment, area-based fallback,
 * portion confidence/source, and the egg ×1/×2/×3 nutrition correctness.
 *
 * Run: node tests/portionEstimator.test.mjs
 * (userId omitted → no DB access)
 */
import { estimatePortion } from '../services/portionEstimator.js';
import { perUnitWeight, getCountableReference } from '../services/foodWeightReference.js';

let passed = 0, failed = 0;
const lines = [];
const check = (label, cond, detail = '') => {
  if (cond) { passed++; lines.push(`  ✓ ${label}`); }
  else { failed++; lines.push(`  ✗ ${label} ${detail ? '→ ' + detail : ''}`); }
};

// Simulate the nutrition lookup the route performs: per100g × grams/100.
const BOILED_EGG_PER_100G = { calories: 155, protein: 13, carbs: 1.1, fat: 11 };
function nutritionFor(grams, per100g = BOILED_EGG_PER_100G) {
  const m = grams / 100;
  return {
    calories: Math.round(per100g.calories * m),
    protein: +(per100g.protein * m).toFixed(1),
    carbs: +(per100g.carbs * m).toFixed(1),
    fat: +(per100g.fat * m).toFixed(1),
  };
}

(async () => {
  console.log('═══ Portion Estimation v2 Tests ═══');

  // ── Stage 1: count-based eggs ──
  const e1 = await estimatePortion('Boiled Egg', [], 1, 'cooked', { small: 80, medium: 150, large: 250 });
  check('Egg ×1 = 50g (ignores ontology 150g default)', e1.grams === 50, `got ${e1.grams}`);
  check('Egg ×1 portionSource = count', e1.portionSource === 'count', e1.portionSource);
  check('Egg ×1 portionConfidence = 0.99 (count-based)', e1.portionConfidence === 0.99, `${e1.portionConfidence}`);
  check('Egg ×1 needsConfirmation = false', e1.needsConfirmation === false, `${e1.needsConfirmation}`);
  check('Egg ×1 never exceeds 70g', e1.grams <= 70, `got ${e1.grams}`);

  const e2 = await estimatePortion('Boiled Egg', [], 2, 'cooked', { medium: 150 });
  check('Egg ×2 = 100g', e2.grams === 100, `got ${e2.grams}`);

  const e3 = await estimatePortion('Boiled Egg', [], 3, 'cooked', { medium: 150 });
  check('Egg ×3 ≈ 150g', e3.grams === 150, `got ${e3.grams}`);

  // ── Stage 1: nutrition correctness for 1 boiled egg ──
  const n1 = nutritionFor(e1.grams);
  check('Boiled Egg ×1 calories 72–78', n1.calories >= 72 && n1.calories <= 78, `got ${n1.calories}`);
  check('Boiled Egg ×1 protein 6–7g', n1.protein >= 6 && n1.protein <= 7, `got ${n1.protein}`);
  check('Boiled Egg ×1 carbs ~0.5g', n1.carbs >= 0.4 && n1.carbs <= 0.7, `got ${n1.carbs}`);
  check('Boiled Egg ×1 fat 5–5.5g', n1.fat >= 5 && n1.fat <= 5.6, `got ${n1.fat}`);

  // egg ×3 nutrition is ~3× single (proves grams drive nutrition)
  const n3 = nutritionFor(e3.grams);
  check('Boiled Egg ×3 calories ≈ 3× single', Math.abs(n3.calories - n1.calories * 3) <= 2, `got ${n3.calories}`);

  // ── Other egg preparations ──
  const fried = await estimatePortion('Fried Egg', [], 1, 'cooked', { medium: 150 });
  check('Fried Egg ×1 = 50g', fried.grams === 50, `got ${fried.grams}`);
  const poached = await estimatePortion('Poached Egg', [], 1, 'cooked', { medium: 150 });
  check('Poached Egg ×1 = 50g', poached.grams === 50, `got ${poached.grams}`);

  // ── Stage 2: size adjustment ──
  const small = await estimatePortion('Boiled Egg', ['small'], 1, 'cooked');
  const large = await estimatePortion('Boiled Egg', ['large'], 1, 'cooked');
  check('Small egg = 45g', small.grams === 45, `got ${small.grams}`);
  check('Large egg = 60g', large.grams === 60, `got ${large.grams}`);

  // ── Countable fruits / bread ──
  const apple = await estimatePortion('Apple', [], 1, 'fruit');
  check('Apple ×1 = 180g', apple.grams === 180, `got ${apple.grams}`);
  const banana2 = await estimatePortion('Banana', [], 2, 'fruit');
  check('Banana ×2 = 240g', banana2.grams === 240, `got ${banana2.grams}`);
  const bread3 = await estimatePortion('Bread', [], 3, 'grain');
  check('Bread ×3 = 90g', bread3.grams === 90, `got ${bread3.grams}`);

  // ── Stage 3: area-based (non-countable) ──
  const rice = await estimatePortion('Rice', ['bowl'], 1, 'cooked', { medium: 150 });
  check('Rice bowl uses serving default (not count)', rice.grams >= 100 && rice.grams <= 250, `got ${rice.grams}`);
  check('Rice portionSource = plate_area', rice.portionSource === 'plate_area', rice.portionSource);

  const curry = await estimatePortion('Chicken Curry', ['bowl'], 1, 'prepared', { medium: 180 });
  check('Chicken Curry uses serving size', curry.grams >= 120 && curry.grams <= 250, `got ${curry.grams}`);

  const biryani = await estimatePortion('Biryani', ['plate'], 1, 'prepared', { medium: 320 });
  check('Biryani uses large plate serving', biryani.grams >= 300, `got ${biryani.grams}`);

  // ── Mixed meal: each food independent ──
  const mRice = await estimatePortion('Rice', ['bowl'], 1, 'cooked');
  const mChicken = await estimatePortion('Grilled Chicken', ['plate'], 1, 'cooked');
  const mSalad = await estimatePortion('Salad', [], 1, 'cooked');
  check('Mixed meal foods get independent weights',
    mRice.grams !== mChicken.grams || mChicken.grams !== mSalad.grams,
    `rice=${mRice.grams} chicken=${mChicken.grams} salad=${mSalad.grams}`);

  // ── Reference table sanity ──
  check('perUnitWeight boiled egg medium = 50', perUnitWeight('boiled egg', 'medium') === 50);
  check('getCountableReference(rice) = null (not countable)', getCountableReference('rice') === null);

  // ── Stage 3: confirmation behavior ──
  check('Countable egg → needsConfirmation false', e1.needsConfirmation === false);
  check('Rice → needsConfirmation true (below 95%)', rice.needsConfirmation === true, `conf=${rice.portionConfidence}`);
  check('Biryani → needsConfirmation true', biryani.needsConfirmation === true, `conf=${biryani.portionConfidence}`);
  check('Apple → needsConfirmation false (countable)', apple.needsConfirmation === false);
  check('Banana ×2 → needsConfirmation false', banana2.needsConfirmation === false);

  // ── Stage 2/3: portion options exist for confirmation sheet ──
  check('Rice provides 4 portion options', Array.isArray(rice.portionOptions) && rice.portionOptions.length === 4, `${rice.portionOptions?.length}`);
  check('Rice options sized small<medium<large<xl',
    rice.portionOptions[0].grams < rice.portionOptions[1].grams &&
    rice.portionOptions[1].grams < rice.portionOptions[2].grams &&
    rice.portionOptions[2].grams < rice.portionOptions[3].grams);
  check('estimatedWeight present on all', e1.estimatedWeight === 50 && rice.estimatedWeight > 0);

  // ── Stage 11: nutrition recalculates from final weight (not estimate) ──
  const recalc80 = nutritionFor(80);
  check('Recalc at 80g → ~124 kcal', recalc80.calories >= 122 && recalc80.calories <= 126, `got ${recalc80.calories}`);

  console.log(lines.join('\n'));
  console.log(`\nPASSED: ${passed}  FAILED: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
