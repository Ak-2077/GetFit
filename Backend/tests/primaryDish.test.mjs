/**
 * Stage 29 — Primary Dish Recognition & Compound Dish Reasoning Tests
 * ──────────────────────────────────────────────────────────────
 * Verifies the engine infers ONE primary dish family and rejects
 * out-of-family dishes (pasta ≠ soup/pizza/burger), across multiple
 * compound categories. Runs WITHOUT MongoDB via __setOntologyCacheForTest.
 *
 * Run:  node tests/primaryDish.test.mjs
 */

import { reason, __setOntologyCacheForTest } from '../services/reasoningEngine.js';
import { inferPrimaryFamily, dishFamily, detectSauces } from '../services/primaryDishRecognition.js';

// ── Cross-family ontology (mirrors real shape) ──
const ONTOLOGY = [
  // Pasta family
  { dishName: 'Penne Pasta', dishNameLower: 'penne pasta', category: 'prepared', parentFood: 'pasta',
    ingredients: ['pasta'], visualCues: ['saucy'], cookingStyles: ['boiled', 'cooked'],
    priority: 58, caloriesPer100g: 160, proteinPer100g: 6, carbsPer100g: 28, fatPer100g: 4 },
  { dishName: 'Penne Marinara', dishNameLower: 'penne marinara', category: 'prepared', parentFood: 'pasta',
    ingredients: ['pasta', 'tomato'], visualCues: ['red', 'saucy'], cookingStyles: ['boiled', 'cooked'],
    priority: 65, caloriesPer100g: 150, proteinPer100g: 5, carbsPer100g: 27, fatPer100g: 3 },
  { dishName: 'Penne Alfredo', dishNameLower: 'penne alfredo', category: 'prepared', parentFood: 'pasta',
    ingredients: ['pasta', 'cream'], visualCues: ['white', 'creamy'], cookingStyles: ['cooked'],
    priority: 62, caloriesPer100g: 200, proteinPer100g: 7, carbsPer100g: 25, fatPer100g: 9 },
  { dishName: 'Arrabbiata', dishNameLower: 'arrabbiata', category: 'prepared', parentFood: 'pasta',
    ingredients: ['pasta', 'tomato'], visualCues: ['red', 'spicy'], cookingStyles: ['cooked'],
    priority: 60, caloriesPer100g: 155, proteinPer100g: 5, carbsPer100g: 28, fatPer100g: 4 },
  { dishName: 'Bolognese', dishNameLower: 'bolognese', category: 'prepared', parentFood: 'pasta',
    ingredients: ['pasta', 'tomato'], visualCues: ['red', 'meaty'], cookingStyles: ['cooked'],
    priority: 80, caloriesPer100g: 180, proteinPer100g: 9, carbsPer100g: 22, fatPer100g: 6 },
  // Out-of-family distractors
  { dishName: 'Tomato Soup', dishNameLower: 'tomato soup', category: 'prepared', parentFood: 'tomato',
    ingredients: ['tomato'], visualCues: ['red', 'liquid'], cookingStyles: ['cooked'],
    priority: 55, caloriesPer100g: 40, proteinPer100g: 1, carbsPer100g: 7, fatPer100g: 1 },
  { dishName: 'Margherita Pizza', dishNameLower: 'margherita pizza', category: 'prepared', parentFood: 'bread',
    ingredients: ['bread', 'cheese', 'tomato'], visualCues: ['round', 'cheesy'], cookingStyles: ['baked'],
    priority: 60, caloriesPer100g: 266, proteinPer100g: 11, carbsPer100g: 33, fatPer100g: 10 },
  { dishName: 'Cheese Burger', dishNameLower: 'cheese burger', category: 'prepared', parentFood: 'bread',
    ingredients: ['bread', 'beef', 'cheese'], visualCues: ['stacked', 'bun'], cookingStyles: ['grilled'],
    priority: 60, caloriesPer100g: 295, proteinPer100g: 17, carbsPer100g: 24, fatPer100g: 14 },
  { dishName: 'Cheese Sandwich', dishNameLower: 'cheese sandwich', category: 'prepared', parentFood: 'bread',
    ingredients: ['bread', 'cheese'], visualCues: ['layered', 'sliced'], cookingStyles: ['cooked'],
    priority: 55, caloriesPer100g: 290, proteinPer100g: 12, carbsPer100g: 30, fatPer100g: 12 },
  { dishName: 'Toast', dishNameLower: 'toast', category: 'cooked', parentFood: 'bread',
    ingredients: ['bread'], visualCues: ['golden', 'flat'], cookingStyles: ['toasted'],
    priority: 50, caloriesPer100g: 313, proteinPer100g: 10, carbsPer100g: 55, fatPer100g: 5 },
  // Rice family
  { dishName: 'Egg Fried Rice', dishNameLower: 'egg fried rice', category: 'prepared', parentFood: 'rice',
    ingredients: ['rice', 'egg', 'peas'], visualCues: ['mixed', 'rice'], cookingStyles: ['fried', 'stir fried'],
    priority: 60, caloriesPer100g: 170, proteinPer100g: 6, carbsPer100g: 24, fatPer100g: 6 },
  { dishName: 'White Rice', dishNameLower: 'white rice', category: 'cooked', parentFood: 'rice',
    ingredients: ['rice'], visualCues: ['white', 'grainy'], cookingStyles: ['steamed', 'boiled'],
    priority: 55, caloriesPer100g: 130, proteinPer100g: 3, carbsPer100g: 28, fatPer100g: 0 },
  // Egg family distractors (must be rejected when family = Rice)
  { dishName: 'Boiled Egg', dishNameLower: 'boiled egg', category: 'cooked', parentFood: 'egg',
    ingredients: ['egg'], visualCues: ['smooth', 'white', 'oval'], cookingStyles: ['boiled'],
    priority: 70, caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1, fatPer100g: 11 },
  { dishName: 'Egg Curry', dishNameLower: 'egg curry', category: 'prepared', parentFood: 'egg',
    ingredients: ['egg'], visualCues: ['gravy', 'sauce'], cookingStyles: ['curry', 'cooked'],
    priority: 60, caloriesPer100g: 130, proteinPer100g: 8, carbsPer100g: 6, fatPer100g: 9 },
];

__setOntologyCacheForTest(ONTOLOGY);

let passed = 0, failed = 0;
const results = [];
function check(label, cond, detail = '') {
  if (cond) { passed++; results.push(`  ✓ ${label}`); }
  else { failed++; results.push(`  ✗ ${label} ${detail ? '→ ' + detail : ''}`); }
}

async function run(name, { text, objects = [], expectPrimary, rejectEverywhere = [], expectFamily }) {
  const r = await reason(text, objects, [], null);
  const primaries = r.predictions.map(p => p.dishNameLower);
  const everywhere = [...primaries, ...(r.alternatives || []).map(a => a.normalized_name)];
  console.log(`\n[${name}] family=${r.primaryFamily} primary=${primaries[0]} all=[${primaries.join(', ')}]`);

  if (expectFamily !== undefined) check(`${name}: family == ${expectFamily}`, r.primaryFamily === expectFamily, `got ${r.primaryFamily}`);
  if (expectPrimary) check(`${name}: primary == ${expectPrimary}`, primaries[0] === expectPrimary, `got ${primaries[0]}`);
  for (const bad of rejectEverywhere) {
    check(`${name}: '${bad}' fully rejected`, !everywhere.includes(bad), `got [${everywhere.join(', ')}]`);
  }
  return r;
}

(async () => {
  console.log('═══ Stage 29 Primary Dish Recognition Tests ═══');

  // ── Unit tests for the pure helpers ──
  check('inferPrimaryFamily(penne) = Pasta', inferPrimaryFamily('penne pasta with tomato sauce', ['pasta', 'tomato']).family === 'Pasta');
  check('inferPrimaryFamily(pizza) = Pizza', inferPrimaryFamily('a margherita pizza', ['bread']).family === 'Pizza');
  check('inferPrimaryFamily(burger) = Burger', inferPrimaryFamily('a cheese burger', ['bread']).family === 'Burger');
  check('inferPrimaryFamily(bun+patty) = Burger', inferPrimaryFamily('grilled', [], [{ name: 'bun' }, { name: 'patty' }]).family === 'Burger');
  check('inferPrimaryFamily(fried rice) = Rice', inferPrimaryFamily('egg fried rice', ['rice', 'egg']).family === 'Rice');
  check('inferPrimaryFamily(plain chicken+rice) = null', inferPrimaryFamily('grilled chicken and white rice', ['chicken', 'rice']) === null);
  check('dishFamily(bolognese) = Pasta', dishFamily('bolognese') === 'Pasta');
  check('dishFamily(tomato soup) = Soup', dishFamily('tomato soup') === 'Soup');
  check('dishFamily(boiled egg) = null', dishFamily('boiled egg') === null);
  check('detectSauces(tomato) includes tomato sauce', detectSauces('penne in tomato sauce').includes('tomato sauce'));

  // ── Integration: Penne Pasta ──
  await run('Penne Pasta', {
    text: 'a plate of penne pasta in tomato sauce',
    objects: [{ name: 'penne pasta', count: 1 }, { name: 'tomato', count: 1 }],
    expectFamily: 'Pasta',
    rejectEverywhere: ['tomato soup', 'margherita pizza', 'cheese burger'],
  });

  // ── Integration: Penne in tomato sauce, NO meat → must NOT be Bolognese ──
  // Bolognese is a meat sauce; with no protein detected it must be rejected,
  // and a meatless tomato pasta (Marinara/Arrabbiata) should win.
  await run('Penne tomato sauce (no meat) — reject Bolognese', {
    text: 'penne pasta coated in red tomato sauce with herbs, no meat visible',
    objects: [{ name: 'penne pasta', count: 1 }],
    expectFamily: 'Pasta',
    rejectEverywhere: ['bolognese'],
  });

  // ── Integration: plain red-sauce penne → GENERIC Penne Pasta, not a specific
  //    named sauce. Arrabbiata/Marinara need their own signal. ──
  await run('Plain red-sauce penne → generic Penne Pasta', {
    text: 'a plate of penne pasta coated in red tomato sauce with herbs and cilantro',
    objects: [{ name: 'penne pasta', count: 1 }],
    expectFamily: 'Pasta',
    expectPrimary: 'penne pasta',
  });
  {
    const r = await reason('a plate of penne pasta in red tomato sauce with herbs', [{ name: 'penne pasta', count: 1 }], [], null);
    const primary = r.predictions[0]?.dishNameLower;
    check('plain red penne: primary is NOT arrabbiata', primary !== 'arrabbiata', `got ${primary}`);
    check('plain red penne: primary is NOT marinara', primary !== 'penne marinara', `got ${primary}`);
  }

  // ── Integration: explicitly named Arrabbiata → allowed ──
  await run('Named arrabbiata → allowed', {
    text: 'spicy penne pasta arrabbiata in a fiery red sauce',
    objects: [{ name: 'penne pasta', count: 1 }],
    expectFamily: 'Pasta',
    expectPrimary: 'arrabbiata',
  });

  // ── Integration: creamy white penne → Alfredo (visual cream cue) ──
  await run('Creamy penne → Alfredo', {
    text: 'penne pasta in a creamy white alfredo sauce',
    objects: [{ name: 'penne pasta', count: 1 }],
    expectFamily: 'Pasta',
    expectPrimary: 'penne alfredo',
  });

  // ── Integration: Penne WITH meat → Bolognese allowed ──
  await run('Penne with beef → Bolognese allowed', {
    text: 'penne pasta with beef in a rich meaty tomato bolognese sauce',
    objects: [{ name: 'penne pasta', count: 1 }, { name: 'beef', count: 1 }],
    expectFamily: 'Pasta',
  });
  {
    const r = await reason('penne pasta with beef in a rich meaty bolognese sauce', [{ name: 'beef', count: 1 }], [], null);
    const everywhere = [...r.predictions.map(p => p.dishNameLower), ...(r.alternatives || []).map(a => a.normalized_name)];
    check('Bolognese present when beef detected', everywhere.includes('bolognese'), `got [${everywhere.join(', ')}]`);
  }

  // ── Integration: Egg Fried Rice → reject egg-family dishes ──
  await run('Egg Fried Rice', {
    text: 'a bowl of egg fried rice with peas, stir fried',
    objects: [{ name: 'rice', count: 1 }, { name: 'egg', count: 1 }],
    expectFamily: 'Rice',
    expectPrimary: 'egg fried rice',
    rejectEverywhere: ['egg curry', 'boiled egg'],
  });

  // ── Integration: Cheese Burger → reject toast/sandwich ──
  await run('Cheese Burger', {
    text: 'a cheese burger with a bread bun and a beef patty',
    objects: [{ name: 'bun', count: 1 }, { name: 'patty', count: 1 }],
    expectFamily: 'Burger',
    expectPrimary: 'cheese burger',
    rejectEverywhere: ['toast', 'cheese sandwich'],
  });

  // ── Integration: Pizza → reject sandwich ──
  await run('Pizza', {
    text: 'a margherita pizza, round bread base with cheese, baked',
    objects: [{ name: 'pizza', count: 1 }],
    expectFamily: 'Pizza',
    expectPrimary: 'margherita pizza',
    rejectEverywhere: ['cheese sandwich', 'toast'],
  });

  // ── Regression: plain multi-food plate must NOT be family-restricted ──
  await run('Chicken + Rice plate (no restriction)', {
    text: 'grilled chicken and white rice on a plate',
    objects: [{ name: 'rice', count: 1 }],
    expectFamily: null,
  });

  console.log('\n─── Results ───');
  console.log(results.join('\n'));
  console.log(`\nPASSED: ${passed}  FAILED: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})();
