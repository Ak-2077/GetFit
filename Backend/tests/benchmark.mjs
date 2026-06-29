/**
 * Stage 25 — Benchmark Framework
 * ──────────────────────────────────────────────────────────────
 * Consumes labeled fixtures and computes recognition metrics against the
 * reasoning engine (DB-free, via injected ontology).
 *
 * Fixture format (tests/fixtures/food-benchmark.json):
 * [
 *   {
 *     "id": "egg_boiled_01",
 *     "rawVisionText": "two halves of a hard-boiled egg ...",
 *     "objects": [{ "name": "egg", "count": 1 }],
 *     "groundTruth": "boiled egg",
 *     "groundTruthGrams": 100,           // optional, for portion error
 *     "groundTruthFoods": ["boiled egg"] // optional, for multi-food
 *   }
 * ]
 *
 * Run: node tests/benchmark.mjs
 * A small built-in fixture set runs if no JSON file is present.
 * ──────────────────────────────────────────────────────────────
 */
import { reason, __setOntologyCacheForTest } from '../services/reasoningEngine.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Benchmark ontology (mirror of test ontology) ──
const ONTOLOGY = [
  { dishName: 'Egg', dishNameLower: 'egg', category: 'ingredient', parentFood: 'egg', ingredients: ['egg'], visualCues: ['oval','whole','white'], cookingStyles: ['raw'], priority: 40 },
  { dishName: 'Boiled Egg', dishNameLower: 'boiled egg', category: 'cooked', parentFood: 'egg', ingredients: ['egg'], visualCues: ['smooth','white','halved','whole','oval'], cookingStyles: ['boiled','steamed'], priority: 70 },
  { dishName: 'Fried Egg', dishNameLower: 'fried egg', category: 'cooked', parentFood: 'egg', ingredients: ['egg'], visualCues: ['golden','crispy'], cookingStyles: ['fried','pan fried'], priority: 60 },
  { dishName: 'Scrambled Egg', dishNameLower: 'scrambled egg', category: 'cooked', parentFood: 'egg', ingredients: ['egg'], visualCues: ['crumbled','fluffy','scrambled'], cookingStyles: ['scrambled','fried'], priority: 60 },
  { dishName: 'Omelet', dishNameLower: 'omelet', category: 'prepared', parentFood: 'egg', ingredients: ['egg'], visualCues: ['folded','flat','golden'], cookingStyles: ['fried','pan fried'], synonyms: ['omelette'], priority: 65 },
  { dishName: 'Poached Egg', dishNameLower: 'poached egg', category: 'cooked', parentFood: 'egg', ingredients: ['egg'], visualCues: ['soft','smooth','irregular'], cookingStyles: ['poached'], priority: 55 },
  { dishName: 'White Rice', dishNameLower: 'white rice', category: 'cooked', parentFood: 'rice', ingredients: ['rice'], visualCues: ['white','grainy'], cookingStyles: ['steamed','boiled'], priority: 60 },
  { dishName: 'Grilled Chicken', dishNameLower: 'grilled chicken', category: 'cooked', parentFood: 'chicken', ingredients: ['chicken'], visualCues: ['golden','grill marks'], cookingStyles: ['grilled'], priority: 65 },
  { dishName: 'Egg Biryani', dishNameLower: 'egg biryani', category: 'prepared', parentFood: 'egg', ingredients: ['egg','rice'], visualCues: ['mixed','rice'], cookingStyles: ['cooked'], priority: 60 },
  { dishName: 'Egg Curry', dishNameLower: 'egg curry', category: 'prepared', parentFood: 'egg', ingredients: ['egg'], visualCues: ['gravy','sauce','bowl'], cookingStyles: ['curry','cooked'], priority: 60 },
];
__setOntologyCacheForTest(ONTOLOGY);

// ── Built-in fixtures (used if no JSON file present) ──
const BUILTIN = [
  { id: 'boiled_01', rawVisionText: 'two halves of a hard-boiled egg, smooth white, visible yolk, no oil', objects: [{ name: 'egg', count: 1 }], groundTruth: 'boiled egg', groundTruthGrams: 50 },
  { id: 'fried_01', rawVisionText: 'a fried egg with crispy golden edges cooked in oil, sunny side up', objects: [{ name: 'egg', count: 1 }], groundTruth: 'fried egg', groundTruthGrams: 55 },
  { id: 'scrambled_01', rawVisionText: 'fluffy scrambled eggs with crumbled curds, cooked', objects: [{ name: 'egg', count: 1 }], groundTruth: 'scrambled egg' },
  { id: 'omelet_01', rawVisionText: 'a folded golden omelet, pan fried, flat', objects: [{ name: 'egg', count: 1 }], groundTruth: 'omelet' },
  { id: 'raw_01', rawVisionText: 'a whole raw egg with intact brown shell', objects: [{ name: 'egg', count: 1 }], groundTruth: 'egg' },
  { id: 'rice_01', rawVisionText: 'a bowl of plain steamed white rice', objects: [{ name: 'rice', count: 1 }], groundTruth: 'white rice' },
  { id: 'biryani_01', rawVisionText: 'mixed rice biryani with egg and spices, cooked', objects: [{ name: 'egg', count: 1 }, { name: 'rice', count: 1 }], groundTruth: 'egg biryani', groundTruthFoods: ['egg biryani'] },
  { id: 'meal_01', rawVisionText: 'a plate with grilled chicken and white rice', objects: [{ name: 'chicken', count: 1 }, { name: 'rice', count: 1 }], groundTruth: 'grilled chicken', groundTruthFoods: ['grilled chicken', 'white rice'] },
];

function loadFixtures() {
  const p = join(__dirname, 'fixtures', 'food-benchmark.json');
  if (existsSync(p)) {
    try { return JSON.parse(readFileSync(p, 'utf-8')); } catch (e) { console.warn('Bad fixtures, using built-in:', e.message); }
  }
  return BUILTIN;
}

async function run() {
  const fixtures = loadFixtures();
  const N = fixtures.length;
  let top1 = 0, top3 = 0, hallucinations = 0, unknowns = 0;
  let confSum = 0, calErrSum = 0, portionErrSum = 0, portionN = 0;
  let multiCorrect = 0, multiTotal = 0;
  let timeSum = 0;
  const knownNames = new Set(ONTOLOGY.map(o => o.dishNameLower));

  for (const fx of fixtures) {
    const t0 = Date.now();
    const r = await reason(fx.rawVisionText, fx.objects || [], [], null);
    timeSum += Date.now() - t0;

    const primary = r.predictions[0]?.dishNameLower || '';
    const conf = r.predictions[0]?.confidence || 0;
    confSum += conf;

    const alts = (r.alternatives || []).map(a => a.normalized_name);
    const top3set = [primary, ...alts];

    // Top-1 / Top-3
    if (primary === fx.groundTruth) top1++;
    if (top3set.includes(fx.groundTruth)) top3++;

    // Calibration error: |confidence - correctness|
    calErrSum += Math.abs(conf - (primary === fx.groundTruth ? 1 : 0));

    // Hallucination: primary is a real ontology dish but wrong AND not unknown
    if (!r.isUnknown && primary && primary !== fx.groundTruth && knownNames.has(primary)) {
      hallucinations++;
    }
    if (r.isUnknown) unknowns++;

    // Portion error
    if (fx.groundTruthGrams && r.predictions[0]) {
      // engine doesn't compute grams (route does) — skip if absent
    }

    // Multi-food
    if (fx.groundTruthFoods) {
      multiTotal++;
      const predicted = new Set(r.predictions.map(p => p.dishNameLower));
      const allFound = fx.groundTruthFoods.every(g => predicted.has(g));
      if (allFound) multiCorrect++;
    }
  }

  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const report = {
    samples: N,
    top1Accuracy: pct(top1 / N),
    top3Accuracy: pct(top3 / N),
    hallucinationRate: pct(hallucinations / N),
    unknownRate: pct(unknowns / N),
    avgConfidence: pct(confSum / N),
    confidenceCalibrationError: pct(calErrSum / N),
    multiFoodAccuracy: multiTotal ? pct(multiCorrect / multiTotal) : 'n/a',
    avgInferenceMs: (timeSum / N).toFixed(1),
  };

  console.log('═══ Stage 25 — Recognition Benchmark Report ═══');
  console.table(report);
  console.log('\nNote: portion error & memory usage require the full route + DB; '
    + 'add labeled fixtures to tests/fixtures/food-benchmark.json to expand coverage.');
  return report;
}

run();
