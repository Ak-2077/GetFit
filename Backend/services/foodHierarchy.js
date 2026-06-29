/**
 * Food Hierarchy & Hard-Negative Module (Recognition v3)
 * ──────────────────────────────────────────────────────────────
 * Centralizes:
 *   • Hierarchical recognition (Category → State → Cooking → Dish)
 *   • Hard Negative Classifier (reject dishes whose required base is absent)
 *   • Central Visual Evidence Matrix (mandatory evidence per dish family)
 *
 * Extends — does not replace — the existing reasoning engine. All functions
 * are pure and dependency-free so they unit-test without a DB.
 * ──────────────────────────────────────────────────────────────
 */

// ═══ STAGE 1: HIERARCHICAL CATEGORY MAP ═══
// Maps a detected base ingredient → high-level food category (Layer 1).
export const CATEGORY_MAP = {
  egg: 'egg', chicken: 'chicken', fish: 'seafood', salmon: 'seafood',
  tuna: 'seafood', shrimp: 'seafood', prawn: 'seafood', mutton: 'meat',
  lamb: 'meat', beef: 'meat', pork: 'meat',
  rice: 'grain', bread: 'grain', roti: 'grain', naan: 'grain',
  paratha: 'grain', pasta: 'grain', noodle: 'grain', oats: 'grain',
  dosa: 'grain', idli: 'grain',
  paneer: 'dairy', milk: 'dairy', cheese: 'dairy', yogurt: 'dairy', curd: 'dairy',
  dal: 'legume', lentil: 'legume', chickpea: 'legume', rajma: 'legume', beans: 'legume',
  potato: 'vegetable', spinach: 'vegetable', mushroom: 'vegetable',
  tomato: 'vegetable', onion: 'vegetable', corn: 'vegetable',
  banana: 'fruit', apple: 'fruit', mango: 'fruit', orange: 'fruit',
};

// ═══ STAGE 5: HARD NEGATIVE CLASSIFIER ═══
// If a dish needs a base that is NOT detected, it is rejected outright.
// Keyed by a regex that matches dish names → required detected base token(s).
export const HARD_NEGATIVE_RULES = [
  { match: /\b(biryani|pulao|fried rice|jeera rice|curd rice|lemon rice)\b/, requires: ['rice'], label: 'rice dish' },
  { match: /\b(sandwich|toast|burger|bread roll|bruschetta)\b/, requires: ['bread'], label: 'bread dish' },
  { match: /\b(ramen|chow ?mein|noodle|noodles|hakka)\b/, requires: ['noodle', 'noodles'], label: 'noodle dish' },
  { match: /\b(pasta|spaghetti|macaroni|penne|lasagna)\b/, requires: ['pasta', 'spaghetti', 'macaroni'], label: 'pasta dish' },
  { match: /\b(curry|gravy|masala|korma|kadai|tikka masala)\b/, requires: ['gravy', 'curry', 'sauce'], label: 'curry/gravy dish', evidenceToken: true },
  { match: /\b(stew|soup|broth|rasam|sambar)\b/, requires: ['soup', 'broth', 'liquid', 'bowl', 'gravy'], label: 'liquid dish', evidenceToken: true },
  { match: /\b(wrap|roll|burrito|kathi)\b/, requires: ['rolled', 'wrapped', 'bread', 'wrap'], label: 'wrap dish', evidenceToken: true },
  { match: /\b(pizza)\b/, requires: ['cheese', 'bread', 'dough', 'crust'], label: 'pizza', evidenceToken: true },
];

/**
 * STAGE 5 — Hard Negative gate.
 * Returns { rejected: bool, reason } for a given dish name against the set of
 * detected tokens (ingredients + visual cues + cooking indicators).
 */
export function hardNegativeReject(dishNameLower, detectedTokens) {
  const tokens = new Set([...detectedTokens].map(t => t.toLowerCase().replace(/s$/, '')));
  for (const rule of HARD_NEGATIVE_RULES) {
    if (rule.match.test(dishNameLower)) {
      // dish belongs to this hard-negative family — require at least one token
      const ok = rule.requires.some(r => tokens.has(r.replace(/s$/, '')) || tokens.has(r));
      if (!ok) {
        return { rejected: true, reason: `${rule.label} requires one of [${rule.requires.join(', ')}] — none detected` };
      }
    }
  }
  return { rejected: false, reason: '' };
}

// ═══ STAGE 3: CENTRAL VISUAL EVIDENCE MATRIX ═══
// Mandatory evidence per dish family. anyCue = at least one must be present.
// reject = if present, the dish is impossible. This is the single source of
// truth (the reasoning engine's inline rules defer to this when available).
export const EVIDENCE_MATRIX = {
  'boiled egg':        { anyCue: ['smooth', 'white', 'halved', 'whole', 'oval', 'round', 'yolk', 'peeled'], anyCook: ['boiled', 'steamed'], reject: ['folded', 'crispy', 'fried', 'scrambled', 'gravy'] },
  'hard-boiled egg':   { anyCue: ['smooth', 'white', 'halved', 'whole', 'oval', 'round', 'yolk', 'peeled'], anyCook: ['boiled', 'steamed'], reject: ['folded', 'crispy', 'fried', 'scrambled', 'gravy'] },
  'hard boiled egg':   { anyCue: ['smooth', 'white', 'halved', 'whole', 'oval', 'round', 'yolk', 'peeled'], anyCook: ['boiled', 'steamed'], reject: ['folded', 'crispy', 'fried', 'scrambled', 'gravy'] },
  'soft-boiled egg':   { anyCue: ['smooth', 'white', 'runny', 'soft', 'yolk'], anyCook: ['boiled', 'steamed'], reject: ['folded', 'crispy', 'fried', 'scrambled'] },
  'soft boiled egg':   { anyCue: ['smooth', 'white', 'runny', 'soft', 'yolk'], anyCook: ['boiled', 'steamed'], reject: ['folded', 'crispy', 'fried', 'scrambled'] },
  'omelet':            { anyCue: ['folded', 'flat'], anyCook: ['fried', 'pan fried', 'sauteed', 'cooked', 'scrambled'], reject: ['shell', 'peel', 'whole', 'boiled', 'gravy'] },
  'omelette':          { anyCue: ['folded', 'flat'], anyCook: ['fried', 'pan fried', 'sauteed', 'cooked', 'scrambled'], reject: ['shell', 'peel', 'whole', 'boiled', 'gravy'] },
  'scrambled egg':     { anyCue: ['crumbled', 'scrambled', 'fluffy'], anyCook: ['scrambled', 'fried', 'sauteed', 'cooked'], reject: ['shell', 'whole', 'folded', 'boiled'] },
  'poached egg':       { anyCue: ['soft', 'smooth', 'irregular', 'runny'], anyCook: ['poached'], reject: ['shell', 'folded', 'crispy', 'fried', 'boiled'] },
  'fried egg':         { anyCue: ['golden', 'crispy', 'runny', 'whole'], anyCook: ['fried', 'pan fried'], reject: ['shell', 'folded', 'boiled'] },
  'sunny side up':     { anyCue: ['golden', 'runny', 'yolk'], anyCook: ['fried', 'pan fried'], reject: ['shell', 'folded', 'boiled'] },
  'egg bhurji':        { anyCue: ['crumbled', 'scrambled', 'mixed'], anyCook: ['scrambled', 'sauteed', 'fried', 'cooked'], reject: ['shell', 'whole', 'folded', 'boiled'] },
  'egg curry':         { anyCue: ['sauce', 'gravy', 'curry', 'bowl'], anyCook: ['curry', 'cooked'], reject: ['folded', 'crispy', 'shell'] },
  'egg biryani':       { anyCue: ['rice', 'mixed', 'spices', 'masala'], anyCook: ['cooked'], reject: ['shell', 'folded'] },
  'egg fried rice':    { anyCue: ['rice', 'mixed'], anyCook: ['fried', 'stir fried', 'cooked'], reject: ['shell', 'folded'] },
  'egg sandwich':      { anyCue: ['bread', 'sliced', 'layered'], anyCook: ['cooked'], reject: ['shell'] },
  'egg roll':          { anyCue: ['rolled', 'wrapped', 'bread'], anyCook: ['fried', 'cooked'], reject: ['shell'] },
};

/**
 * STAGE 3 — Evidence matrix check (negation/word-boundary aware).
 * Returns { ok: bool, reason }.
 */
export function evidenceMatrixCheck(dishLower, lowerText, visualCues, cookingIndicators) {
  const rule = EVIDENCE_MATRIX[dishLower];
  if (!rule) return { ok: true, reason: '' };
  const has = (t) => {
    if (cookingIndicators.includes(t) || visualCues.includes(t)) return true;
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const m = re.exec(lowerText);
    if (!m) return false;
    const before = lowerText.slice(Math.max(0, m.index - 14), m.index);
    if (/\b(no|not|without|never|absent|lacks?|free of)\b/.test(before)) return false;
    return true;
  };
  if (rule.reject?.some(r => has(r))) return { ok: false, reason: `rejected by impossible cue` };
  if (rule.anyCook?.length && !rule.anyCook.some(c => has(c))) return { ok: false, reason: `missing cooking evidence` };
  if (rule.anyCue?.length && !rule.anyCue.some(c => has(c))) return { ok: false, reason: `missing visual evidence` };
  return { ok: true, reason: '' };
}

// ═══ STAGE 4: WEIGHTED SIMILARITY SCORING ═══
// Component weights (sum = 1.0).
export const SCORE_WEIGHTS = {
  visual: 0.40,
  cooking: 0.20,
  state: 0.15,
  objectContext: 0.10,
  ingredients: 0.10,
  ontology: 0.05,
};

/**
 * STAGE 4 — Weighted evidence score in [0,1].
 * Each sub-score is a 0..1 ratio; combined via SCORE_WEIGHTS.
 */
export function weightedDishScore({ visualMatch, cookingMatch, stateMatch, objectContext, ingredientMatch, ontologyPriority }) {
  const s =
    SCORE_WEIGHTS.visual * clamp01(visualMatch) +
    SCORE_WEIGHTS.cooking * clamp01(cookingMatch) +
    SCORE_WEIGHTS.state * clamp01(stateMatch) +
    SCORE_WEIGHTS.objectContext * clamp01(objectContext) +
    SCORE_WEIGHTS.ingredients * clamp01(ingredientMatch) +
    SCORE_WEIGHTS.ontology * clamp01(ontologyPriority);
  return clamp01(s);
}

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

/**
 * STAGE 1 — Derive the hierarchy (Layer 1-3) from detected signals.
 * Returns { category, state, cooking }.
 */
export function deriveHierarchy(ingredients, foodState, cookingIndicators) {
  let category = 'unknown';
  for (const ing of ingredients) {
    const c = CATEGORY_MAP[ing.toLowerCase().replace(/s$/, '')];
    if (c) { category = c; break; }
  }
  const state = foodState || 'unknown';
  const cooking = (cookingIndicators && cookingIndicators.length) ? cookingIndicators[0] : 'unknown';
  return { category, state, cooking };
}
