/**
 * Recognition v3 — Hierarchy / Hard-Negative / Evidence-Matrix tests
 * Run: node tests/foodHierarchy.test.mjs
 */
import {
  hardNegativeReject, evidenceMatrixCheck, weightedDishScore, deriveHierarchy,
} from '../services/foodHierarchy.js';

let passed = 0, failed = 0;
const lines = [];
const check = (label, cond, detail = '') => {
  if (cond) { passed++; lines.push(`  ✓ ${label}`); }
  else { failed++; lines.push(`  ✗ ${label} ${detail ? '→ ' + detail : ''}`); }
};

console.log('═══ Recognition v3 Hierarchy/Hard-Negative Tests ═══');

// ── STAGE 5: Hard Negative Classifier ──
check('egg biryani rejected without rice',
  hardNegativeReject('egg biryani', new Set(['egg'])).rejected);
check('egg biryani accepted with rice',
  !hardNegativeReject('egg biryani', new Set(['egg', 'rice'])).rejected);
check('egg sandwich rejected without bread',
  hardNegativeReject('egg sandwich', new Set(['egg'])).rejected);
check('egg sandwich accepted with bread',
  !hardNegativeReject('egg sandwich', new Set(['egg', 'bread'])).rejected);
check('chicken curry rejected without gravy',
  hardNegativeReject('chicken curry', new Set(['chicken'])).rejected);
check('chicken curry accepted with gravy',
  !hardNegativeReject('chicken curry', new Set(['chicken', 'gravy'])).rejected);
check('chicken noodles rejected without noodles',
  hardNegativeReject('chicken noodles', new Set(['chicken'])).rejected);
check('plain boiled egg never hard-negative',
  !hardNegativeReject('boiled egg', new Set(['egg'])).rejected);

// ── STAGE 3: Evidence Matrix ──
check('boiled egg passes with yolk+boiled',
  evidenceMatrixCheck('boiled egg', 'smooth white boiled egg with visible yolk', ['smooth', 'white'], ['boiled']).ok);
check('boiled egg rejected when folded present',
  !evidenceMatrixCheck('boiled egg', 'folded cooked egg', ['folded'], ['fried']).ok);
check('omelet passes with folded+fried',
  evidenceMatrixCheck('omelet', 'folded pan fried egg omelet', ['folded', 'flat'], ['fried']).ok);
check('omelet rejected when shell present',
  !evidenceMatrixCheck('omelet', 'egg with shell', ['whole'], ['boiled']).ok);
check('"no oil" not counted as fried evidence',
  evidenceMatrixCheck('boiled egg', 'boiled egg with no oil, smooth white, yolk', ['smooth', 'white'], ['boiled']).ok);

// ── STAGE 4: Weighted scoring sums correctly ──
const full = weightedDishScore({ visualMatch: 1, cookingMatch: 1, stateMatch: 1, objectContext: 1, ingredientMatch: 1, ontologyPriority: 1 });
check('weighted score full = 1.0', Math.abs(full - 1.0) < 1e-9, `got ${full}`);
const visualOnly = weightedDishScore({ visualMatch: 1, cookingMatch: 0, stateMatch: 0, objectContext: 0, ingredientMatch: 0, ontologyPriority: 0 });
check('visual-only score = 0.40', Math.abs(visualOnly - 0.40) < 1e-9, `got ${visualOnly}`);
const none = weightedDishScore({});
check('empty score = 0', none === 0, `got ${none}`);

// ── STAGE 1: Hierarchy derivation ──
const h1 = deriveHierarchy(['egg'], 'cooked', ['boiled']);
check('hierarchy: egg → egg/cooked/boiled', h1.category === 'egg' && h1.state === 'cooked' && h1.cooking === 'boiled', JSON.stringify(h1));
const h2 = deriveHierarchy(['rice'], 'cooked', []);
check('hierarchy: rice → grain', h2.category === 'grain', JSON.stringify(h2));

console.log(lines.join('\n'));
console.log(`\nPASSED: ${passed}  FAILED: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
