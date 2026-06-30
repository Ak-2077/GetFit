/**
 * Stage 30 — Visual Certainty & Recipe Confidence Tests
 * ──────────────────────────────────────────────────────────────
 * Verifies the engine separates visual facts from recipe inference:
 *   • plain red-sauce penne → generic "Penne Pasta", recipe = null,
 *     possible recipes surfaced as alternatives
 *   • named/visually-distinct recipes still resolve (Alfredo, Margherita)
 *   • visibleSauce / visibleIngredients / visualConfidence populated
 *
 * Run:  node tests/visualCertainty.test.mjs
 */

import { reason, __setOntologyCacheForTest } from '../services/reasoningEngine.js';
import {
  detectVisibleSauce, extractVisibleIngredients, isSpecificRecipe,
  computeVisualCertainty, RECIPE_CONFIDENCE_THRESHOLD,
} from '../services/visualCertainty.js';

const ONTOLOGY = [
  // Pasta family (generic + specific recipes)
  { dishName: 'Penne Pasta', dishNameLower: 'penne pasta', category: 'prepared', parentFood: 'pasta',
    ingredients: ['pasta'], visualCues: ['saucy'], cookingStyles: ['boiled', 'cooked'], priority: 58,
    caloriesPer100g: 160, proteinPer100g: 6, carbsPer100g: 28, fatPer100g: 4 },
  { dishName: 'Spaghetti', dishNameLower: 'spaghetti', category: 'prepared', parentFood: 'pasta',
    ingredients: ['pasta', 'spaghetti'], visualCues: ['stringy'], cookingStyles: ['boiled', 'cooked'], priority: 57,
    caloriesPer100g: 158, proteinPer100g: 6, carbsPer100g: 30, fatPer100g: 1 },
  { dishName: 'Arrabbiata', dishNameLower: 'arrabbiata', category: 'prepared', parentFood: 'pasta',
    ingredients: ['pasta', 'tomato'], visualCues: ['red', 'spicy'], cookingStyles: ['cooked'], priority: 60,
    caloriesPer100g: 155, proteinPer100g: 5, carbsPer100g: 28, fatPer100g: 4 },
  { dishName: 'Penne Marinara', dishNameLower: 'penne marinara', category: 'prepared', parentFood: 'pasta',
    ingredients: ['pasta', 'tomato'], visualCues: ['red'], cookingStyles: ['cooked'], priority: 60,
    caloriesPer100g: 150, proteinPer100g: 5, carbsPer100g: 27, fatPer100g: 3 },
  { dishName: 'Penne Alfredo', dishNameLower: 'penne alfredo', category: 'prepared', parentFood: 'pasta',
    ingredients: ['pasta', 'cream'], visualCues: ['white', 'creamy'], cookingStyles: ['cooked'], priority: 62,
    caloriesPer100g: 200, proteinPer100g: 7, carbsPer100g: 25, fatPer100g: 9 },
  // Pizza
  { dishName: 'Margherita Pizza', dishNameLower: 'margherita pizza', category: 'prepared', parentFood: 'bread',
    ingredients: ['bread', 'cheese', 'tomato'], visualCues: ['round', 'cheesy'], cookingStyles: ['baked'], priority: 60,
    caloriesPer100g: 266, proteinPer100g: 11, carbsPer100g: 33, fatPer100g: 10 },
  // Burger
  { dishName: 'Cheese Burger', dishNameLower: 'cheese burger', category: 'prepared', parentFood: 'bread',
    ingredients: ['bread', 'beef', 'cheese'], visualCues: ['stacked', 'bun'], cookingStyles: ['grilled'], priority: 60,
    caloriesPer100g: 295, proteinPer100g: 17, carbsPer100g: 24, fatPer100g: 14 },
  // Egg
  { dishName: 'Boiled Egg', dishNameLower: 'boiled egg', category: 'cooked', parentFood: 'egg',
    ingredients: ['egg'], visualCues: ['smooth', 'white', 'oval', 'yolk'], cookingStyles: ['boiled'], priority: 70,
    caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1, fatPer100g: 11 },
];

__setOntologyCacheForTest(ONTOLOGY);

let passed = 0, failed = 0;
const out = [];
function check(label, cond, detail = '') {
  if (cond) { passed++; out.push(`  ✓ ${label}`); }
  else { failed++; out.push(`  ✗ ${label} ${detail ? '→ ' + detail : ''}`); }
}

(async () => {
  console.log('═══ Stage 30 Visual Certainty Tests ═══');

  // ── Unit: helpers ──
  check('detectVisibleSauce(tomato) = Tomato Sauce', detectVisibleSauce('penne in red tomato sauce').name === 'Tomato Sauce');
  check('detectVisibleSauce(white) = White/Cream', detectVisibleSauce('creamy white sauce').name === 'White/Cream Sauce');
  check('detectVisibleSauce(none) = Unknown', detectVisibleSauce('a plate of plain rice').name === 'Unknown');
  check('extractVisibleIngredients picks cheese+parsley', (() => {
    const v = extractVisibleIngredients('pasta with cheese and parsley', []);
    return v.includes('cheese') && v.includes('parsley');
  })());
  check('isSpecificRecipe(arrabbiata) = true', isSpecificRecipe('arrabbiata') === true);
  check('isSpecificRecipe(penne pasta) = false', isSpecificRecipe('penne pasta') === false);
  check('visualCertainty high for visible base', computeVisualCertainty({ dishNameLower: 'penne pasta', ingredients: ['pasta'], detectedObjects: [{ name: 'pasta' }], familyInferred: true, cueMatches: 2 }) >= 0.95);
  check('RECIPE_CONFIDENCE_THRESHOLD = 0.75', RECIPE_CONFIDENCE_THRESHOLD === 0.75);

  // ── Penne + Tomato Sauce → generic, recipe unknown, alternatives ──
  {
    const r = await reason('a plate of penne pasta coated in red tomato sauce with parsley', [{ name: 'penne pasta', count: 1 }], [], null);
    const primary = r.predictions[0]?.dishNameLower;
    console.log(`\n[Penne+Tomato] primary=${primary} recipe=${r.recipe} sauce=${r.visibleSauce?.name} visualConf=${r.visualConfidence} possible=[${r.possibleRecipes.map(p => p.normalized_name).join(', ')}]`);
    check('Penne+Tomato: primary = penne pasta', primary === 'penne pasta', `got ${primary}`);
    check('Penne+Tomato: recipe = null (uncertain)', r.recipe === null, `got ${r.recipe}`);
    check('Penne+Tomato: visibleSauce = Tomato Sauce', r.visibleSauce?.name === 'Tomato Sauce');
    check('Penne+Tomato: visualConfidence >= 0.9', r.visualConfidence >= 0.9, `got ${r.visualConfidence}`);
    check('Penne+Tomato: arrabbiata is a POSSIBLE recipe', r.possibleRecipes.some(p => p.normalized_name === 'arrabbiata'));
    check('Penne+Tomato: foodFamily = Pasta', r.foodFamily === 'Pasta', `got ${r.foodFamily}`);
  }

  // ── Spaghetti + White Sauce → generic spaghetti, sauce White/Cream ──
  {
    const r = await reason('spaghetti pasta in a creamy white sauce', [{ name: 'spaghetti', count: 1 }], [], null);
    const primary = r.predictions[0]?.dishNameLower;
    console.log(`[Spaghetti+White] primary=${primary} sauce=${r.visibleSauce?.name}`);
    check('Spaghetti+White: visibleSauce = White/Cream Sauce', r.visibleSauce?.name === 'White/Cream Sauce');
    check('Spaghetti+White: primary is a pasta-family food', ['spaghetti', 'penne pasta', 'penne alfredo'].includes(primary), `got ${primary}`);
    check('Spaghetti+White: primary NOT arrabbiata/marinara', !['arrabbiata', 'penne marinara'].includes(primary), `got ${primary}`);
  }

  // ── Pizza + Cheese + Basil → Margherita Pizza ──
  {
    const r = await reason('a round margherita pizza with bread base, melted cheese and basil, baked', [{ name: 'pizza', count: 1 }], [], null);
    const primary = r.predictions[0]?.dishNameLower;
    console.log(`[Pizza] primary=${primary} family=${r.foodFamily}`);
    check('Pizza: primary = margherita pizza', primary === 'margherita pizza', `got ${primary}`);
    check('Pizza: foodFamily = Pizza', r.foodFamily === 'Pizza');
  }

  // ── Burger + Cheese + Patty → Cheeseburger ──
  {
    const r = await reason('a cheese burger with a bread bun, beef patty and melted cheese', [{ name: 'bun', count: 1 }, { name: 'patty', count: 1 }], [], null);
    const primary = r.predictions[0]?.dishNameLower;
    console.log(`[Burger] primary=${primary} family=${r.foodFamily}`);
    check('Burger: primary = cheese burger', primary === 'cheese burger', `got ${primary}`);
    check('Burger: foodFamily = Burger', r.foodFamily === 'Burger');
  }

  // ── Boiled Egg → high visual certainty, food type cooked ──
  {
    const r = await reason('a peeled boiled egg, smooth white, oval, visible yolk', [{ name: 'egg', count: 1 }], [], null);
    const primary = r.predictions[0]?.dishNameLower;
    console.log(`[Boiled Egg] primary=${primary} visualConf=${r.visualConfidence} foodType=${r.foodType}`);
    check('Boiled Egg: primary = boiled egg', primary === 'boiled egg', `got ${primary}`);
    check('Boiled Egg: visualConfidence >= 0.9', r.visualConfidence >= 0.9, `got ${r.visualConfidence}`);
  }

  console.log('\n─── Results ───');
  console.log(out.join('\n'));
  console.log(`\nPASSED: ${passed}  FAILED: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
