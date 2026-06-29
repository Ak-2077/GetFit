/**
 * Stage 17 — Visual Feature Extractor
 * ──────────────────────────────────────────────────────────────
 * Converts raw vision text + detected objects into a STRUCTURED feature
 * object. The reasoning engine consumes this structured object instead of
 * re-parsing raw text in multiple places.
 *
 * Pure & dependency-free → unit-testable without a DB.
 * Additive: the engine still accepts raw text for backward compatibility.
 * ──────────────────────────────────────────────────────────────
 */

const FEATURE_LEXICON = {
  shape: ['round', 'oval', 'flat', 'folded', 'layered', 'rolled', 'triangular', 'square', 'cylindrical', 'spiral', 'whole', 'halved', 'quartered', 'sliced', 'diced', 'cubed', 'mashed', 'shredded', 'crumbled', 'strips', 'wedge'],
  color: ['golden', 'brown', 'dark brown', 'light brown', 'white', 'yellow', 'red', 'green', 'orange', 'black', 'charred', 'caramelized', 'pale', 'cream', 'pink'],
  texture: ['crispy', 'creamy', 'fluffy', 'smooth', 'chunky', 'crunchy', 'soft', 'flaky', 'moist', 'dry', 'sticky', 'grainy', 'silky', 'crumbly', 'tender', 'chewy', 'bubbly', 'glazed'],
  container: ['bowl', 'plate', 'glass', 'cup', 'mug', 'pan', 'pot', 'tray', 'jar', 'bottle'],
  surface: ['fried marks', 'grill marks', 'char marks', 'browned', 'sizzling', 'oily', 'greasy'],
  structural: ['shell', 'bone', 'bones', 'skin', 'cheese', 'rice', 'bread', 'noodle', 'noodles', 'gravy', 'sauce', 'liquid', 'steam', 'garnish', 'vegetables', 'fruit', 'yolk', 'albumen'],
  utensils: ['fork', 'spoon', 'knife', 'chopsticks', 'skewer'],
};

const CUT_STATES = ['halved', 'halves', 'half', 'sliced', 'diced', 'cubed', 'quartered', 'crumbled', 'mashed', 'pieces', 'whole'];

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, single: 1, couple: 2, few: 3, several: 4, dozen: 12 };

/** Word-boundary, negation-aware presence test. */
function present(term, text) {
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const m = re.exec(text);
  if (!m) return false;
  const before = text.slice(Math.max(0, m.index - 14), m.index);
  if (/\b(no|not|without|never|absent|lacks?|free of)\b/.test(before)) return false;
  return true;
}

/**
 * Extract structured visual features.
 * @param {string} rawText - vision model description
 * @param {Array<{name:string,count:number}>} detectedObjects
 * @returns structured feature object
 */
export function extractVisualFeatures(rawText = '', detectedObjects = []) {
  const text = (rawText || '').toLowerCase();
  const features = {
    shape: [], color: [], texture: [], container: [],
    surface: [], structural: [], utensils: [],
    cutState: 'unknown',
    hasSteam: false, hasLiquid: false, hasGravy: false,
    hasCheese: false, hasShell: false, hasBone: false,
    hasRiceGrains: false, hasBread: false, hasNoodles: false,
    counts: {},
    objects: [],
  };

  for (const [group, terms] of Object.entries(FEATURE_LEXICON)) {
    for (const t of terms) {
      if (present(t, text)) features[group].push(t);
    }
  }

  // Boolean shortcuts (commonly needed by hard-negative + evidence stages)
  features.hasSteam = present('steam', text);
  features.hasLiquid = present('liquid', text) || present('broth', text);
  features.hasGravy = present('gravy', text) || present('sauce', text) || present('curry', text);
  features.hasCheese = present('cheese', text);
  features.hasShell = present('shell', text);
  features.hasBone = present('bone', text) || present('bones', text);
  features.hasRiceGrains = present('rice', text);
  features.hasBread = present('bread', text) || present('toast', text) || present('bun', text);
  features.hasNoodles = present('noodle', text) || present('noodles', text);

  // Cut state (whole / halved / sliced / pieces …)
  for (const cs of CUT_STATES) {
    if (present(cs, text)) {
      // Normalize halves/half → halved for downstream consistency
      features.cutState = (cs === 'halves' || cs === 'half') ? 'halved' : cs;
      break;
    }
  }

  // Counts from text: "two eggs", "3 wings"
  const countRe = new RegExp(`\\b(\\d+|${Object.keys(NUM_WORDS).join('|')})\\s+([a-z]{3,})`, 'gi');
  let m;
  while ((m = countRe.exec(text)) !== null) {
    const numStr = m[1].toLowerCase();
    const n = parseInt(numStr) || NUM_WORDS[numStr] || 1;
    const noun = m[2].replace(/s$/, '');
    features.counts[noun] = Math.max(1, Math.min(n, 50));
  }

  // Object detection counts take precedence
  for (const o of detectedObjects) {
    if (o.name) {
      const key = o.name.toLowerCase().replace(/s$/, '');
      features.objects.push({ name: key, count: o.count || 1 });
      if (o.count) features.counts[key] = o.count;
    }
  }

  return features;
}

/** Flatten structured features into a token set for hard-negative / evidence gates. */
export function featuresToTokens(features) {
  const tokens = new Set();
  for (const group of ['shape', 'color', 'texture', 'container', 'surface', 'structural', 'utensils']) {
    for (const t of (features[group] || [])) tokens.add(t);
  }
  if (features.cutState && features.cutState !== 'unknown') tokens.add(features.cutState);
  if (features.hasGravy) { tokens.add('gravy'); tokens.add('sauce'); }
  if (features.hasRiceGrains) tokens.add('rice');
  if (features.hasBread) tokens.add('bread');
  if (features.hasNoodles) { tokens.add('noodle'); tokens.add('noodles'); }
  if (features.hasCheese) tokens.add('cheese');
  for (const o of (features.objects || [])) tokens.add(o.name);
  return [...tokens];
}
