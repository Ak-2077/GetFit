/**
 * Stage 17 + 22 — Visual Feature Extractor & Food Relationship Graph tests
 * Run: node tests/visualFeatures.test.mjs
 */
import { extractVisualFeatures, featuresToTokens } from '../services/visualFeatureExtractor.js';
import { baseOfDish, childrenOf, areExclusiveSiblings, graphCandidateNames } from '../services/foodRelationshipGraph.js';

let passed = 0, failed = 0;
const lines = [];
const check = (label, cond, detail = '') => {
  if (cond) { passed++; lines.push(`  ✓ ${label}`); }
  else { failed++; lines.push(`  ✗ ${label} ${detail ? '→ ' + detail : ''}`); }
};

console.log('═══ Stage 17/22 Feature Extractor & Graph Tests ═══');

// ── Stage 17: Visual Feature Extractor ──
const f1 = extractVisualFeatures('two halves of a boiled egg, smooth white surface with visible yolk, no oil', [{ name: 'egg', count: 1 }]);
check('detects halved cut state', f1.cutState === 'halved', f1.cutState);
check('detects white color', f1.color.includes('white'));
check('detects smooth texture', f1.texture.includes('smooth'));
check('detects yolk structural', f1.structural.includes('yolk'));
check('"no oil" not flagged as oily surface', !f1.surface.includes('oily'));
check('egg object captured', f1.objects.some(o => o.name === 'egg'));

const f2 = extractVisualFeatures('a folded golden omelet on a plate, pan fried', []);
check('detects folded shape', f2.shape.includes('folded'));
check('detects plate container', f2.container.includes('plate'));

const f3 = extractVisualFeatures('chicken curry in a bowl with thick gravy', []);
check('detects gravy flag', f3.hasGravy === true);
check('detects bowl container', f3.container.includes('bowl'));

const f4 = extractVisualFeatures('mixed rice biryani with rice grains and spices', []);
check('detects rice grains flag', f4.hasRiceGrains === true);

// featuresToTokens flattens correctly
const tokens = featuresToTokens(f3);
check('tokens include gravy', tokens.includes('gravy'));

// ── Stage 22: Food Relationship Graph ──
check('baseOfDish(boiled egg) = egg', baseOfDish('boiled egg') === 'egg');
check('baseOfDish(egg biryani) = egg', baseOfDish('egg biryani') === 'egg');
check('baseOfDish(grilled chicken) = chicken', baseOfDish('grilled chicken') === 'chicken');
check('childrenOf(egg) includes omelet', childrenOf('egg').includes('omelet'));
check('boiled egg & omelet are exclusive siblings', areExclusiveSiblings('boiled egg', 'omelet'));
check('boiled egg & egg curry NOT exclusive (curry is compound)', !areExclusiveSiblings('boiled egg', 'egg curry'));
check('graphCandidateNames([egg]) includes boiled egg', graphCandidateNames(['egg']).includes('boiled egg'));
check('graphCandidateNames([egg]) excludes chicken dishes', !graphCandidateNames(['egg']).includes('grilled chicken'));

console.log(lines.join('\n'));
console.log(`\nPASSED: ${passed}  FAILED: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
