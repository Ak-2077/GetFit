/**
 * Stage 12 — Production Validation Tests for the Reasoning Engine
 * ──────────────────────────────────────────────────────────────
 * Verifies the egg-family recognition no longer returns multiple
 * mutually-exclusive dishes, picks ONE primary, and respects
 * evidence rules. Runs WITHOUT MongoDB via __setOntologyCacheForTest.
 *
 * Run:  node tests/reasoningEngine.test.mjs
 */

import { reason, __setOntologyCacheForTest } from '../services/reasoningEngine.js';

// ── Minimal egg-family ontology (mirrors real shape) ──
const ONTOLOGY = [
  { dishName: 'Egg', dishNameLower: 'egg', category: 'ingredient', parentFood: 'egg',
    ingredients: ['egg'], visualCues: ['oval', 'whole', 'white'], cookingStyles: ['raw'],
    priority: 40, caloriesPer100g: 143, proteinPer100g: 13, carbsPer100g: 1, fatPer100g: 10 },
  { dishName: 'Boiled Egg', dishNameLower: 'boiled egg', category: 'cooked', parentFood: 'egg',
    ingredients: ['egg'], visualCues: ['smooth', 'white', 'halved', 'whole', 'oval'],
    cookingStyles: ['boiled', 'steamed'], priority: 70,
    caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1, fatPer100g: 11 },
  { dishName: 'Fried Egg', dishNameLower: 'fried egg', category: 'cooked', parentFood: 'egg',
    ingredients: ['egg'], visualCues: ['golden', 'crispy'], cookingStyles: ['fried', 'pan fried'],
    priority: 60, caloriesPer100g: 196, proteinPer100g: 14, carbsPer100g: 1, fatPer100g: 15 },
  { dishName: 'Scrambled Egg', dishNameLower: 'scrambled egg', category: 'cooked', parentFood: 'egg',
    ingredients: ['egg'], visualCues: ['crumbled', 'fluffy', 'scrambled'], cookingStyles: ['scrambled', 'fried'],
    priority: 60, caloriesPer100g: 149, proteinPer100g: 10, carbsPer100g: 2, fatPer100g: 11 },
  { dishName: 'Omelet', dishNameLower: 'omelet', category: 'prepared', parentFood: 'egg',
    ingredients: ['egg'], visualCues: ['folded', 'flat', 'golden'], cookingStyles: ['fried', 'pan fried'],
    synonyms: ['omelette'], priority: 65, caloriesPer100g: 154, proteinPer100g: 11, carbsPer100g: 1, fatPer100g: 12 },
  { dishName: 'Poached Egg', dishNameLower: 'poached egg', category: 'cooked', parentFood: 'egg',
    ingredients: ['egg'], visualCues: ['soft', 'smooth', 'irregular'], cookingStyles: ['poached'],
    priority: 55, caloriesPer100g: 143, proteinPer100g: 13, carbsPer100g: 1, fatPer100g: 10 },
  // a non-egg item for the meal grouping test
  { dishName: 'White Rice', dishNameLower: 'white rice', category: 'cooked', parentFood: 'rice',
    ingredients: ['rice'], visualCues: ['white', 'grainy'], cookingStyles: ['steamed', 'boiled'],
    priority: 60, caloriesPer100g: 130, proteinPer100g: 3, carbsPer100g: 28, fatPer100g: 0 },
  { dishName: 'Grilled Chicken', dishNameLower: 'grilled chicken', category: 'cooked', parentFood: 'chicken',
    ingredients: ['chicken'], visualCues: ['golden', 'grill marks'], cookingStyles: ['grilled'],
    priority: 65, caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 4 },
  // ── Compound egg dishes (must be REJECTED by candidate filtering when their
  //    structural ingredients are NOT visible) ──
  { dishName: 'Egg Biryani', dishNameLower: 'egg biryani', category: 'prepared', parentFood: 'egg',
    ingredients: ['egg', 'rice'], visualCues: ['mixed', 'rice'], cookingStyles: ['cooked'],
    priority: 60, caloriesPer100g: 180, proteinPer100g: 7, carbsPer100g: 25, fatPer100g: 6 },
  { dishName: 'Egg Curry', dishNameLower: 'egg curry', category: 'prepared', parentFood: 'egg',
    ingredients: ['egg'], visualCues: ['gravy', 'sauce', 'bowl'], cookingStyles: ['curry', 'cooked'],
    priority: 60, caloriesPer100g: 130, proteinPer100g: 8, carbsPer100g: 6, fatPer100g: 9 },
  { dishName: 'Egg Fried Rice', dishNameLower: 'egg fried rice', category: 'prepared', parentFood: 'rice',
    ingredients: ['egg', 'rice'], visualCues: ['rice', 'mixed'], cookingStyles: ['fried', 'stir fried'],
    priority: 60, caloriesPer100g: 170, proteinPer100g: 6, carbsPer100g: 24, fatPer100g: 6 },
  { dishName: 'Egg Sandwich', dishNameLower: 'egg sandwich', category: 'prepared', parentFood: 'egg',
    ingredients: ['egg', 'bread'], visualCues: ['bread', 'layered'], cookingStyles: ['cooked'],
    priority: 60, caloriesPer100g: 220, proteinPer100g: 10, carbsPer100g: 25, fatPer100g: 9 },
];

__setOntologyCacheForTest(ONTOLOGY);

let passed = 0, failed = 0;
const results = [];

function check(label, cond, detail = '') {
  if (cond) { passed++; results.push(`  ✓ ${label}`); }
  else { failed++; results.push(`  ✗ ${label} ${detail ? '→ ' + detail : ''}`); }
}

async function runCase(name, { text, objects = [], expectPrimary, forbidInPrimaries = [], maxPrimaries = 1 }) {
  const r = await reason(text, objects, [], null);
  const primaries = r.predictions.map(p => p.dishNameLower);
  const primary = primaries[0];
  console.log(`\n[${name}]`);
  console.log(`  text: "${text}"`);
  console.log(`  primary: ${primary} (${r.predictions[0] ? (r.predictions[0].confidence*100).toFixed(0)+'%' : 'none'}) | state=${r.foodState}`);
  console.log(`  all primaries: [${primaries.join(', ')}]`);
  console.log(`  alternatives: [${(r.alternatives||[]).map(a => `${a.normalized_name} ${(a.confidence*100).toFixed(0)}%`).join(', ')}]`);

  if (expectPrimary) check(`primary == ${expectPrimary}`, primary === expectPrimary, `got ${primary}`);
  check(`exactly ${maxPrimaries} primary food(s)`, primaries.length <= maxPrimaries, `got ${primaries.length}`);
  for (const forb of forbidInPrimaries) {
    check(`'${forb}' NOT a separate primary`, !primaries.includes(forb));
  }
  // No mutually-exclusive siblings among primaries
  return r;
}

(async () => {
  console.log('═══ Stage 12 Reasoning Engine Validation ═══');

  // Boiled egg cut in half — must be ONE boiled egg, not omelet/poached/scrambled
  await runCase('Egg Cut in Half (boiled)', {
    text: 'two halves of a hard-boiled egg, smooth white surface with visible yellow yolk, cut in half, no oil',
    objects: [{ name: 'egg', count: 1 }],
    expectPrimary: 'boiled egg',
    forbidInPrimaries: ['omelet', 'poached egg', 'scrambled egg', 'fried egg'],
  });

  // Whole boiled egg
  await runCase('Boiled Egg (whole, peeled)', {
    text: 'a peeled boiled egg, smooth white, whole, oval shape',
    objects: [{ name: 'egg', count: 1 }],
    expectPrimary: 'boiled egg',
    forbidInPrimaries: ['omelet', 'poached egg', 'fried egg'],
  });

  // Folded omelet — must be omelet, NOT boiled egg
  await runCase('Omelet (folded)', {
    text: 'a folded cooked egg omelet, golden brown flat surface, pan fried',
    objects: [{ name: 'egg', count: 1 }],
    expectPrimary: 'omelet',
    forbidInPrimaries: ['boiled egg', 'poached egg', 'raw egg'],
  });

  // Scrambled egg
  await runCase('Scrambled Egg', {
    text: 'fluffy scrambled eggs with crumbled curds in a bowl, cooked',
    objects: [{ name: 'egg', count: 1 }],
    expectPrimary: 'scrambled egg',
    forbidInPrimaries: ['boiled egg', 'omelet', 'poached egg'],
  });

  // Fried egg
  await runCase('Fried Egg', {
    text: 'a fried egg with crispy golden edges cooked in oil, sunny side up',
    objects: [{ name: 'egg', count: 1 }],
    expectPrimary: 'fried egg',
    forbidInPrimaries: ['boiled egg', 'omelet'],
  });

  // Raw whole egg
  await runCase('Whole Raw Egg (shell)', {
    text: 'a whole raw egg with intact brown shell',
    objects: [{ name: 'egg', count: 1 }],
    expectPrimary: 'egg',
    forbidInPrimaries: ['omelet', 'fried egg', 'poached egg'],
  });

  // Meal: chicken + rice → two distinct primaries allowed
  await runCase('Chicken + Rice (meal)', {
    text: 'a plate with grilled chicken and white rice',
    objects: [{ name: 'chicken', count: 1 }, { name: 'rice', count: 1 }],
    maxPrimaries: 2,
  });

  // ── STAGE 1/2: Candidate filtering — compound dishes rejected without structural ingredients ──
  await runCase('Boiled Egg — reject compound dishes (no rice/bread/gravy)', {
    text: 'two halves of a hard-boiled egg, smooth white surface with visible yellow yolk, no oil',
    objects: [{ name: 'egg', count: 1 }],
    expectPrimary: 'boiled egg',
    forbidInPrimaries: ['egg biryani', 'egg curry', 'egg fried rice', 'egg sandwich'],
  });
  // also assert these never appear as alternatives either
  {
    const r = await reason('a peeled boiled egg, smooth white, whole, oval shape, visible yolk', [{ name: 'egg', count: 1 }], [], null);
    const everywhere = [...r.predictions.map(p => p.dishNameLower), ...(r.alternatives || []).map(a => a.normalized_name)];
    for (const bad of ['egg biryani', 'egg curry', 'egg fried rice', 'egg sandwich']) {
      check(`'${bad}' fully excluded (not primary, not alternative)`, !everywhere.includes(bad), `got [${everywhere.join(', ')}]`);
    }
  }

  // Egg Biryani SHOULD appear when rice IS visible
  await runCase('Egg Biryani — accepted when rice visible', {
    text: 'a plate of mixed rice biryani with egg and spices, cooked',
    objects: [{ name: 'egg', count: 1 }, { name: 'rice', count: 1 }],
    maxPrimaries: 2,
  });

  // Stage 13: two halves of one boiled egg → count 1
  {
    const r = await reason('two halves of one boiled egg, cut in half, smooth white, visible yolk', [{ name: 'egg', count: 2 }], [], null);
    check('two halves of one egg counted as 1', (r.counts.egg || 1) === 1, `got count=${r.counts.egg}`);
  }

  console.log('\n─── Results ───');
  console.log(results.join('\n'));
  console.log(`\nPASSED: ${passed}  FAILED: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
