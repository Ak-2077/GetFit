/**
 * Reasoning Engine v3 — Deterministic Food Recognition
 *
 * Pipeline: Extract Cues → Object Detection Sync → Classify Food State → Score → Validate → Calibration → Multi-Food Grouping
 */

import FoodOntology from '../models/foodOntology.js';
import FoodCorrection from '../models/foodCorrection.js';
import mongoose from 'mongoose';
import { hardNegativeReject, evidenceMatrixCheck, deriveHierarchy } from './foodHierarchy.js';
import { extractVisualFeatures, featuresToTokens } from './visualFeatureExtractor.js';

// True only when a live MongoDB connection exists (readyState 1).
const dbReady = () => mongoose.connection?.readyState === 1;

// ═══ IN-MEMORY ONTOLOGY CACHE ═══
let _ontologyCache = [];
let _cacheLoadedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function loadOntologyCache() {
  try {
    _ontologyCache = await FoodOntology.find({ isActive: true }).lean();
    _cacheLoadedAt = Date.now();
    console.log(`[ReasoningEngine] Ontology cache loaded: ${_ontologyCache.length} foods`);
    return _ontologyCache.length;
  } catch (err) {
    console.error('[ReasoningEngine] Failed to load ontology:', err.message);
    return 0;
  }
}

async function ensureCache() {
  if (_ontologyCache.length === 0 || (Date.now() - _cacheLoadedAt) > CACHE_TTL_MS) {
    await loadOntologyCache();
  }
}

// ═══ VISUAL CUE DICTIONARIES ═══
const SHAPE_CUES = ['folded', 'flat', 'round', 'oval', 'layered', 'stacked', 'rolled', 'sliced', 'diced', 'stuffed', 'wrapped', 'triangular', 'square', 'cylindrical', 'spiral', 'shredded', 'crumbled', 'whole', 'halved', 'quartered', 'strips', 'cubed', 'mashed'];
const COLOR_CUES = ['golden', 'brown', 'dark brown', 'light brown', 'white', 'yellow', 'red', 'green', 'orange', 'black', 'charred', 'caramelized', 'pale', 'vibrant', 'colorful', 'cream', 'pink'];
const TEXTURE_CUES = ['crispy', 'creamy', 'fluffy', 'smooth', 'chunky', 'thick', 'thin', 'crunchy', 'soft', 'flaky', 'moist', 'dry', 'sticky', 'grainy', 'silky', 'crumbly', 'tender', 'chewy', 'bubbly', 'glazed'];
const COOKING_CUES = ['fried', 'deep fried', 'pan fried', 'grilled', 'boiled', 'steamed', 'baked', 'roasted', 'sauteed', 'stir fried', 'smoked', 'braised', 'poached', 'blanched', 'toasted', 'charred', 'tandoori', 'barbecued', 'microwaved', 'pressure cooked'];
const CONTAINER_CUES = ['bowl', 'plate', 'glass', 'cup', 'mug', 'pan', 'pot', 'wrapper', 'box', 'container', 'tray', 'basket', 'skewer', 'leaf', 'cone', 'jar', 'bottle'];
const SIZE_CUES = ['small', 'medium', 'large', 'big', 'tiny', 'huge', 'half', 'full', 'portion', 'bite-sized', 'generous', 'mini'];

const RAW_INDICATORS = ['raw', 'uncooked', 'whole', 'shell', 'peel', 'skin', 'rind', 'bunch', 'stem', 'fresh', 'uncut', 'unpeeled', 'ripe', 'unripe', 'organic', 'farm fresh', 'carton', 'basket', 'crate', 'bag', 'pack', 'package', 'tray of'];
const COOKED_EVIDENCE = ['cooked', 'fried', 'grilled', 'baked', 'roasted', 'boiled', 'steamed', 'sauteed', 'stir fried', 'deep fried', 'pan fried', 'smoked', 'braised', 'charred', 'toasted', 'browned', 'caramelized', 'melted', 'crispy', 'crunchy', 'golden brown', 'sizzling', 'bubbling', 'gravy', 'sauce', 'curry', 'masala', 'garnished', 'seasoned', 'marinated', 'glazed', 'flipped', 'plated', 'served', 'mixed with', 'topped with', 'folded', 'stuffed', 'rolled', 'layered', 'spread', 'mashed'];

const ALL_VISUAL_CUES = [...SHAPE_CUES, ...COLOR_CUES, ...TEXTURE_CUES, ...CONTAINER_CUES, ...SIZE_CUES];
const ALL_COOKING_CUES = COOKING_CUES;

const INGREDIENT_KEYWORDS = ['egg', 'eggs', 'chicken', 'fish', 'mutton', 'lamb', 'beef', 'pork', 'shrimp', 'prawn', 'prawns', 'salmon', 'tuna', 'crab', 'lobster', 'tofu', 'paneer', 'soya', 'turkey', 'duck', 'rice', 'bread', 'wheat', 'flour', 'noodle', 'noodles', 'pasta', 'spaghetti', 'macaroni', 'oats', 'cereal', 'semolina', 'corn', 'quinoa', 'barley', 'millet', 'milk', 'cheese', 'butter', 'cream', 'yogurt', 'curd', 'ghee', 'whey', 'potato', 'tomato', 'onion', 'carrot', 'spinach', 'broccoli', 'cauliflower', 'peas', 'beans', 'lentil', 'lentils', 'mushroom', 'pepper', 'cucumber', 'lettuce', 'cabbage', 'corn', 'eggplant', 'zucchini', 'avocado', 'olive', 'banana', 'apple', 'mango', 'orange', 'strawberry', 'blueberry', 'grape', 'grapes', 'watermelon', 'pineapple', 'papaya', 'kiwi', 'pomegranate', 'guava', 'cherry', 'peach', 'coconut', 'lemon', 'lime', 'almond', 'almonds', 'cashew', 'peanut', 'peanuts', 'walnut', 'pistachio', 'chocolate', 'sugar', 'honey', 'jam', 'sauce', 'soup', 'broth',
  // Indian / regional flatbread & dish synonyms (resolved via INGREDIENT_SYNONYMS)
  'chapati', 'chapathi', 'phulka', 'roti', 'naan', 'paratha', 'parantha', 'puri', 'poori', 'bhatura', 'kulcha', 'dosa', 'idli', 'vada', 'uttapam', 'dhokla', 'poha', 'upma', 'biryani', 'pulao', 'khichdi', 'dal', 'daal', 'sambar', 'rasam', 'rajma', 'chole', 'chana', 'curd', 'dahi', 'lassi', 'samosa', 'pakora', 'kachori'];

// ═══ INGREDIENT SYNONYM NORMALIZATION ═══
// Maps equivalent food names to ONE canonical token so "chapati" and "roti"
// resolve to the same candidate set. Prevents valid foods returning 0 results.
const INGREDIENT_SYNONYMS = {
  'chapati': 'roti', 'chapathi': 'roti', 'phulka': 'roti', 'fulka': 'roti',
  'parantha': 'paratha', 'poori': 'puri', 'daal': 'dal', 'dahi': 'curd',
  'chapatti': 'roti', 'rotis': 'roti', 'chappati': 'roti',
  'eggs': 'egg', 'prawns': 'prawn', 'almonds': 'almond', 'peanuts': 'peanut',
  'grapes': 'grape', 'lentils': 'lentil', 'noodles': 'noodle',
};

function canonicalIngredient(token) {
  const t = (token || '').toLowerCase().trim();
  return INGREDIENT_SYNONYMS[t] || t.replace(/s$/, '');
}

export function extractIngredients(rawText) {
  const lower = rawText.toLowerCase();
  const found = new Set();
  for (const kw of INGREDIENT_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`, 'i').test(lower)) {
      // Normalize synonyms → canonical token (chapati → roti, etc.)
      found.add(canonicalIngredient(kw));
    }
  }
  return [...found];
}

export function extractVisualCues(rawText) {
  const lower = rawText.toLowerCase();
  return ALL_VISUAL_CUES.filter(cue => lower.includes(cue));
}

export function extractCookingIndicators(rawText) {
  const lower = rawText.toLowerCase();
  // Word-boundary + negation-aware contains: ignore "no X" / "without X"
  // and never match a term as a substring of another word (oil ⊄ boiled).
  const hasTerm = (t) => {
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const m = re.exec(lower);
    if (!m) return false;
    const before = lower.slice(Math.max(0, m.index - 14), m.index);
    if (/\b(no|not|without|never|absent|lacks?|free of)\b/.test(before)) return false;
    return true;
  };
  const found = ALL_COOKING_CUES.filter(cue => hasTerm(cue));
  if (hasTerm('oil') && !found.includes('fried')) found.push('fried');
  if (hasTerm('grill marks') || hasTerm('char marks')) found.push('grilled');
  if (hasTerm('oven') && !found.includes('baked')) found.push('baked');
  if (hasTerm('water') && lower.includes('bubbl')) found.push('boiled');
  if (hasTerm('steam') && !found.includes('steamed')) found.push('steamed');
  return [...new Set(found)];
}

export function extractCounts(rawText) {
  const counts = {};
  const lower = rawText.toLowerCase();
  const NUM_WORDS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'a ': 1, 'an ': 1, 'single': 1, 'couple': 2, 'few': 3, 'several': 4, 'dozen': 12};
  for (const kw of INGREDIENT_KEYWORDS) {
    const match = new RegExp(`(\\d+|${Object.keys(NUM_WORDS).join('|')})\\s*${kw}`, 'gi').exec(lower);
    if (match) {
      const numStr = match[1].trim().toLowerCase();
      const count = parseInt(numStr) || NUM_WORDS[numStr] || NUM_WORDS[numStr + ' '] || 1;
      counts[kw.replace(/s$/, '')] = Math.max(1, Math.min(count, 50));
    }
  }
  return counts;
}

export function extractPortionCues(rawText) {
  const lower = rawText.toLowerCase();
  const cues = SIZE_CUES.filter(cue => lower.includes(cue));
  if (lower.includes('bowl')) cues.push('bowl');
  if (lower.includes('plate')) cues.push('plate');
  if (lower.includes('glass')) cues.push('glass');
  if (lower.includes('cup')) cues.push('cup');
  return cues;
}

export function classifyFoodState(rawText, ingredients, visualCues, cookingIndicators) {
  const lower = rawText.toLowerCase();

  // ── Explicit cooking-verb override ──
  // If the description literally states a cooking method (word-boundary), the
  // food is cooked/prepared regardless of "peeled/shell" type words (you peel a
  // BOILED egg). This prevents "peeled boiled egg" → raw misclassification.
  const EXPLICIT_COOK_VERBS = ['boiled', 'hard-boiled', 'hard boiled', 'soft boiled', 'fried', 'deep fried', 'pan fried', 'scrambled', 'poached', 'grilled', 'roasted', 'baked', 'steamed', 'sauteed', 'toasted', 'omelet', 'omelette'];
  const PREPARED_VERBS = ['omelet', 'omelette', 'scrambled', 'folded', 'stuffed', 'curry', 'bhurji'];
  for (const v of EXPLICIT_COOK_VERBS) {
    if (new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
      // Negation check
      const idx = lower.search(new RegExp(`\\b${v}\\b`));
      const before = lower.slice(Math.max(0, idx - 14), idx);
      if (!/\b(no|not|without|never)\b/.test(before)) {
        return PREPARED_VERBS.some(p => lower.includes(p)) ? 'prepared' : 'cooked';
      }
    }
  }

  let rawScore = 0, cookedScore = 0;
  for (const ind of RAW_INDICATORS) if (lower.includes(ind)) rawScore += 2;
  for (const ind of COOKED_EVIDENCE) if (lower.includes(ind)) cookedScore += 2;
  if (cookingIndicators.length > 0) {
    const nonRaw = cookingIndicators.filter(c => c !== 'raw');
    if (nonRaw.length > 0) cookedScore += nonRaw.length * 3;
    if (cookingIndicators.includes('raw')) rawScore += 5;
  }
  const transformationCues = ['folded', 'stuffed', 'rolled', 'layered', 'mashed', 'shredded', 'crumbled', 'sliced', 'diced', 'cubed', 'strips'];
  for (const cue of visualCues) if (transformationCues.includes(cue)) cookedScore += 2;
  const cookedTextures = ['crispy', 'crunchy', 'fluffy', 'flaky', 'glazed', 'caramelized', 'tender', 'bubbly'];
  for (const cue of visualCues) if (cookedTextures.includes(cue)) cookedScore += 2;
  if (lower.includes('shell') || lower.includes('peel') || lower.includes('skin')) rawScore += 3;
  if (visualCues.includes('whole') || visualCues.includes('oval')) rawScore += 1;
  const EXPLICIT_DISH = ['omelet', 'omelette', 'omlet', 'biryani', 'curry', 'sandwich', 'burger', 'pizza', 'pasta', 'noodles', 'soup', 'salad', 'cake', 'pie', 'bread', 'dosa', 'idli', 'paratha', 'roti', 'naan', 'dal', 'samosa', 'pakora', 'stir fry', 'stew', 'risotto', 'sushi', 'ramen', 'taco', 'burrito', 'pancake', 'waffle', 'porridge', 'smoothie', 'shake', 'latte', 'cappuccino', 'bhurji', 'scrambled', 'poached'];
  for (const dish of EXPLICIT_DISH) if (lower.includes(dish)) { cookedScore += 10; break; }
  if (cookedScore === 0 && ingredients.length <= 2) rawScore += 2;
  if (rawScore > cookedScore + 2) return 'raw';
  else if (cookedScore > rawScore + 2) return cookedScore > 6 ? 'prepared' : 'cooked';
  return 'unknown';
}

// ═══ STAGE 5/7/13/14: EVIDENCE RULES, MUTUAL EXCLUSION, GROUPING ═══
// Mutually-exclusive dish groups — only ONE can win per base ingredient.
const EXCLUSION_GROUPS = [
  // Egg preparations — cannot coexist for a single egg object
  ['boiled egg', 'hard boiled egg', 'hard-boiled egg', 'soft boiled egg', 'soft-boiled egg',
   'fried egg', 'sunny side up', 'scrambled egg', 'omelet', 'omelette',
   'egg white omelet', 'egg white omelette', 'poached egg', 'egg bhurji', 'egg curry'],
  // Chicken preparations
  ['grilled chicken', 'fried chicken', 'roasted chicken', 'tandoori chicken', 'chicken curry', 'butter chicken'],
  // Potato preparations
  ['boiled potato', 'fried potato', 'mashed potato', 'baked potato', 'french fries'],
];

function conflictsWith(primaryName, otherName) {
  const a = (primaryName || '').toLowerCase().trim();
  const b = (otherName || '').toLowerCase().trim();
  if (a === b) return false;
  return EXCLUSION_GROUPS.some(g => g.includes(a) && g.includes(b));
}

// Required visual/cooking evidence for prepared dishes. Missing → reject.
// Dishes with no rule pass through (lenient default).
const DISH_EVIDENCE_RULES = {
  'omelet':            { needCooking: ['fried', 'pan fried', 'sauteed', 'cooked', 'scrambled'], needCues: ['folded', 'flat'], reject: ['shell', 'peel', 'whole', 'boiled'] },
  'omelette':          { needCooking: ['fried', 'pan fried', 'sauteed', 'cooked', 'scrambled'], needCues: ['folded', 'flat'], reject: ['shell', 'peel', 'whole', 'boiled'] },
  'egg white omelet':  { needCooking: ['fried', 'pan fried', 'sauteed', 'cooked'], needCues: ['folded', 'flat'], reject: ['shell', 'peel', 'whole', 'boiled', 'yolk'] },
  'egg white omelette':{ needCooking: ['fried', 'pan fried', 'sauteed', 'cooked'], needCues: ['folded', 'flat'], reject: ['shell', 'peel', 'whole', 'boiled', 'yolk'] },
  'scrambled egg':     { needCooking: ['scrambled', 'fried', 'sauteed', 'cooked'], needCues: ['crumbled', 'scrambled', 'fluffy'], reject: ['shell', 'whole', 'folded', 'boiled'] },
  'poached egg':       { needCooking: ['poached'], needCues: ['soft', 'smooth', 'irregular'], reject: ['shell', 'folded', 'crispy', 'fried', 'boiled'] },
  'fried egg':         { needCooking: ['fried', 'pan fried'], needCues: [], reject: ['shell', 'folded', 'boiled'] },
  'sunny side up':     { needCooking: ['fried', 'pan fried'], needCues: [], reject: ['shell', 'folded', 'boiled'] },
  'boiled egg':        { needCooking: ['boiled', 'steamed'], needCues: ['smooth', 'white', 'halved', 'whole', 'oval', 'round'], reject: ['folded', 'crispy', 'oil', 'fried'] },
  'hard boiled egg':   { needCooking: ['boiled', 'steamed'], needCues: ['smooth', 'white', 'halved', 'whole', 'oval', 'round'], reject: ['folded', 'crispy', 'oil', 'fried'] },
  'hard-boiled egg':   { needCooking: ['boiled', 'steamed'], needCues: ['smooth', 'white', 'halved', 'whole', 'oval', 'round'], reject: ['folded', 'crispy', 'oil', 'fried'] },
  'egg bhurji':        { needCooking: ['scrambled', 'sauteed', 'fried', 'cooked'], needCues: ['crumbled', 'scrambled'], reject: ['shell', 'whole', 'folded', 'boiled'] },
  'egg curry':         { needCooking: ['curry', 'cooked'], needCues: ['sauce', 'gravy', 'curry', 'bowl'], reject: ['folded', 'crispy', 'shell'] },
  'egg biryani':       { needCooking: ['cooked'], needCues: ['rice', 'mixed', 'spices', 'masala'], reject: ['shell', 'folded'] },
  'egg fried rice':    { needCooking: ['fried', 'stir fried', 'cooked'], needCues: ['rice', 'mixed'], reject: ['shell', 'folded'] },
  'egg sandwich':      { needCooking: ['cooked'], needCues: ['bread', 'sliced', 'layered'], reject: ['shell'] },
  'egg roll':          { needCooking: ['fried', 'cooked'], needCues: ['rolled', 'wrapped', 'bread'], reject: ['shell'] },
};

// ═══ STAGE 1: CANDIDATE GENERATION + FILTERING (pre-reasoning gate) ═══
// Structural (big, visible) ingredients that DEFINE a dish. Condiments like
// oil/butter/salt/spices are intentionally excluded — they're rarely detected
// and must never gate a candidate.
const STRUCTURAL_INGREDIENTS = new Set([
  'egg', 'chicken', 'fish', 'mutton', 'lamb', 'beef', 'pork', 'shrimp', 'prawn',
  'paneer', 'tofu', 'soya', 'turkey', 'duck',
  'rice', 'bread', 'noodle', 'noodles', 'pasta', 'spaghetti', 'macaroni',
  'potato', 'oats', 'wheat', 'roti', 'naan', 'paratha', 'dosa', 'idli',
  'banana', 'apple', 'mango', 'orange', 'milk', 'dal', 'lentil', 'lentils',
  'chickpea', 'beans', 'rajma', 'spinach', 'mushroom', 'corn', 'cheese',
]);

/**
 * Derive the structural ingredients a dish REQUIRES, from its ontology
 * ingredient list + structural tokens inside the dish name.
 */
function requiredStructuralIngredients(dish) {
  const req = new Set();
  for (const ing of (dish.ingredients || [])) {
    const l = ing.toLowerCase().replace(/s$/, '');
    if (STRUCTURAL_INGREDIENTS.has(l)) req.add(l);
  }
  // Parse the dish name for structural words (e.g. "egg biryani" → egg + rice via synonym)
  const nameTokens = (dish.dishNameLower || '').split(/\s+/);
  for (const tok of nameTokens) {
    const l = tok.replace(/s$/, '');
    if (STRUCTURAL_INGREDIENTS.has(l)) req.add(l);
  }
  // Name-implied structural components (compound dishes that imply a base not
  // always listed as an explicit token).
  const n = dish.dishNameLower || '';
  if (/\bbiryani\b|\bpulao\b|\bfried rice\b/.test(n)) req.add('rice');
  if (/\bsandwich\b|\btoast\b|\bburger\b/.test(n)) req.add('bread');
  if (/\bnoodle|\bchowmein\b|\bramen\b/.test(n)) req.add('noodle');
  if (/\bpasta\b/.test(n)) req.add('pasta');
  return [...req];
}

/**
 * STAGE 1 + 5 — Generate the candidate shortlist.
 * Restricts the ontology to dishes that:
 *   (a) share at least one detected base ingredient (category restriction), AND
 *   (b) have ALL their structural ingredients visually detected, AND
 *   (c) survive the Hard Negative Classifier (rice/bread/noodle/gravy gates).
 * Returns the filtered ontology subset — the reasoning engine ONLY sees these.
 */
function generateCandidates(ingredients, detectedObjects, evidenceTokens = []) {
  const detected = new Set(ingredients.map(i => canonicalIngredient(i)));
  // Also fold object-detection names into the detected set (synonym-normalized)
  for (const o of (detectedObjects || [])) {
    if (o.name) detected.add(canonicalIngredient(o.name));
  }
  // Tokens used by the hard-negative classifier (ingredients + visual cues +
  // cooking indicators) so "gravy"/"bread"/"rolled" can satisfy evidence gates.
  const hardNegTokens = new Set([...detected, ...evidenceTokens.map(t => t.toLowerCase().replace(/s$/, ''))]);

  const shortlist = [];
  const rejected = [];

  for (const dish of _ontologyCache) {
    // (a) Base-ingredient / category match: dish must relate to a detected ingredient
    const dishIngredients = (dish.ingredients || []).map(i => i.toLowerCase().replace(/s$/, ''));
    const parent = (dish.parentFood || '').toLowerCase().replace(/s$/, '');
    const nameMatchesIngredient = [...detected].some(d =>
      dish.dishNameLower?.includes(d) || dishIngredients.includes(d) || parent === d
    );
    if (!nameMatchesIngredient) continue; // not in any detected category

    // (b) Structural completeness: every required structural ingredient must be present
    const required = requiredStructuralIngredients(dish);
    const missing = required.filter(r => !detected.has(r));
    if (missing.length > 0) {
      rejected.push(`${dish.dishNameLower} (missing: ${missing.join(', ')})`);
      continue;
    }

    // (c) STAGE 5: Hard Negative Classifier
    const hn = hardNegativeReject(dish.dishNameLower || '', hardNegTokens);
    if (hn.rejected) {
      rejected.push(`${dish.dishNameLower} (${hn.reason})`);
      continue;
    }

    shortlist.push(dish);
  }

  if (rejected.length > 0 && process.env.NODE_ENV !== 'production') {
    console.log(`[CandidateGen] Rejected ${rejected.length} dishes: ${rejected.slice(0, 6).join(' | ')}${rejected.length > 6 ? ' …' : ''}`);
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[CandidateGen] Shortlist: ${shortlist.length}/${_ontologyCache.length} dishes for [${[...detected].join(', ')}]`);
  }
  return shortlist;
}

/**
 * STAGE 13: Normalize object/ingredient counts so halves/slices of ONE item
 * are counted as one (two halves of a boiled egg → 1 egg).
 */
function normalizeCounts(counts, lowerText, detectedObjects) {
  const halfMarkers = /\b(cut in half|halved|two halves|sliced in half|cross[- ]?section|sliced open|split)\b/.test(lowerText);
  const out = { ...counts };
  if (halfMarkers) {
    for (const key of Object.keys(out)) {
      // A single item shown as 2 halves is reported as count 2 → collapse to 1.
      if (out[key] === 2) out[key] = 1;
    }
  }
  return out;
}

function passesEvidenceCheck(dishLower, lowerText, visualCues, cookingIndicators) {
  const rule = DISH_EVIDENCE_RULES[dishLower];
  if (!rule) return true; // no strict requirement → allow
  // Word-boundary + negation-aware presence:
  //  - "boiled" must NOT match the substring "oil"
  //  - "no oil" / "without frying" must NOT count as positive evidence
  const has = (t) => {
    if (cookingIndicators.includes(t) || visualCues.includes(t)) return true;
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const m = re.exec(lowerText);
    if (!m) return false;
    const before = lowerText.slice(Math.max(0, m.index - 14), m.index);
    if (/\b(no|not|without|never|absent|lacks?|free of)\b/.test(before)) return false;
    return true;
  };
  if (rule.reject?.some(r => has(r))) return false;
  if (rule.needCooking?.length && !rule.needCooking.some(c => has(c))) return false;
  if (rule.needCues?.length && !rule.needCues.some(c => has(c))) return false;
  return true;
}

function scoreDish(dish, ingredients, visualCues, cookingIndicators, foodState, lowerText = '') {
  let score = 0.50;
  const explanation = [];

  // ── Direct name match: if the vision text literally names this dish, boost it
  //    strongly so a specific cooked dish ("boiled egg") beats the bare
  //    ingredient ("egg"). Multi-word names get a bigger boost than single words.
  const nameLower = (dish.dishNameLower || '').trim();
  const synonyms = (dish.synonyms || []).map(s => s.toLowerCase());
  if (lowerText && nameLower) {
    const nameHit = lowerText.includes(nameLower) || synonyms.some(s => s && lowerText.includes(s));
    if (nameHit) {
      const wordCount = nameLower.split(/\s+/).length;
      const boost = wordCount >= 2 ? 0.30 : 0.10; // "boiled egg" >> "egg"
      score += boost;
      explanation.push(`Direct name match in description (+${(boost * 100).toFixed(0)}%)`);
    }
  }

  const dishIngredients = (dish.ingredients || []).map(i => i.toLowerCase());
  const dishParent = (dish.parentFood || '').toLowerCase();
  let ingredientMatch = false;

  for (const ingredient of ingredients) {
    if (dishIngredients.includes(ingredient) || dishParent === ingredient || dish.dishNameLower?.includes(ingredient)) {
      ingredientMatch = true;
      score += 0.12;
      explanation.push(`Contains matching ingredient: ${ingredient}`);
      break;
    }
  }

  if (!ingredientMatch) return { score: 0, explanation };

  const dishVisualCues = (dish.visualCues || []).map(c => c.toLowerCase());
  const modifiers = dish.confidenceModifiers || {};
  let cueMatches = 0;

  for (const cue of visualCues) {
    if (dishVisualCues.includes(cue)) {
      const modifier = modifiers.get?.(cue) || modifiers[cue] || 0.04;
      score += modifier;
      cueMatches++;
      explanation.push(`Matched visual cue: ${cue}`);
    }
  }

  const dishCookingStyles = (dish.cookingStyles || []).map(c => c.toLowerCase());
  let cookingMatch = false;

  for (const indicator of cookingIndicators) {
    if (dishCookingStyles.some(style => style.includes(indicator) || indicator.includes(style))) {
      score += 0.08;
      cookingMatch = true;
      explanation.push(`Matched cooking style: ${indicator}`);
      break;
    }
  }

  if (foodState === 'raw') {
    explanation.push('Food state identified as Raw');
    if (dish.category === 'prepared' || dish.category === 'cooked') {
      if (cueMatches >= 3 && cookingMatch) {
        // Allowed but not boosted
      } else {
        score -= 0.25;
        explanation.push('Penalized: Prepared dish without sufficient cooking cues in a raw context');
      }
    }
    if (dish.category === 'ingredient') {
      score += 0.12;
      explanation.push('Boosted: Raw ingredient in a raw context');
    }
  } else if (foodState === 'cooked') {
    explanation.push('Food state identified as Cooked');
    if (dish.category === 'cooked') {
      score += 0.06;
      explanation.push('Boosted: Cooked food in a cooked context');
    } else if (dish.category === 'prepared' && (cueMatches >= 1 || cookingMatch)) {
      score += 0.04;
    } else if (dish.category === 'ingredient') {
      score -= 0.05;
      explanation.push('Penalized: Raw ingredient in a cooked context');
    }
  } else if (foodState === 'prepared') {
    explanation.push('Food state identified as Prepared');
    if (dish.category === 'prepared' && (cueMatches >= 1 || cookingMatch)) {
      score += 0.08;
      explanation.push('Boosted: Prepared dish in a prepared context');
    } else if (dish.category === 'ingredient') {
      score -= 0.10;
      explanation.push('Penalized: Raw ingredient in a prepared context');
    }
  }

  score += (dish.priority || 50) * 0.0005;
  return { score: Math.max(0, Math.min(1, score)), explanation };
}

function validatePredictions(predictions, foodState, ingredients) {
  if (predictions.length === 0) return { predictions, validationState: 'passed' };
  const top = predictions[0];
  let validationState = 'passed';

  if (foodState === 'raw' && (top.dish.category === 'prepared' || top.dish.category === 'cooked')) {
    validationState = 'demoted_to_ingredient';
    console.log(`[ReasoningEngine] VALIDATION: Rejecting "${top.dish.dishName}" (${top.dish.category}) — food state is RAW`);
    const parentName = (top.dish.parentFood || '').toLowerCase();
    const ingredientIdx = predictions.findIndex((p, i) => i > 0 && (p.dish.category === 'ingredient' || p.dish.dishNameLower === parentName));
    if (ingredientIdx > 0) {
      const ingredient = predictions.splice(ingredientIdx, 1)[0];
      ingredient.score = Math.max(ingredient.score, top.score);
      ingredient.explanation.push('Validation: Promoted from parent dish due to lack of cooking evidence');
      predictions.unshift(ingredient);
    } else {
      for (const ing of ingredients) {
        const cached = _ontologyCache.find(c => c.dishNameLower === ing && c.category === 'ingredient');
        if (cached) {
          predictions.unshift({ dish: cached, score: top.score, explanation: ['Validation: Injected raw ingredient due to lack of cooking evidence'] });
          break;
        }
      }
    }
  }
  return { predictions, validationState };
}

/**
 * Run the reasoning engine on vision model output + object detection.
 */
export async function reason(rawVisionText, detectedObjects = [], cookingMethods = [], userId = null) {
  await ensureCache();
  const startTime = Date.now();

  // Stage 17: Structured visual features (additive — also fed to gates below).
  const visualFeatures = extractVisualFeatures(rawVisionText, detectedObjects);

  const visionIngredients = extractIngredients(rawVisionText);
  
  // Object Detection Layer Synchronization
  const objectNames = detectedObjects.map(obj => obj.name?.toLowerCase()).filter(Boolean);
  const ingredients = [...new Set([...visionIngredients, ...objectNames])];
  
  const visualCues = extractVisualCues(rawVisionText);
  const cookingIndicators = [...extractCookingIndicators(rawVisionText), ...cookingMethods];
  const portionCues = extractPortionCues(rawVisionText);
  
  const visionCounts = extractCounts(rawVisionText);
  const counts = { ...visionCounts };
  for (const obj of detectedObjects) {
    if (obj.name && obj.count) counts[obj.name.toLowerCase()] = obj.count;
  }

  const foodState = classifyFoodState(rawVisionText, ingredients, visualCues, cookingIndicators);

  if (ingredients.length === 0) {
    const words = rawVisionText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    for (const entry of _ontologyCache) {
      for (const word of words) {
        if (entry.dishNameLower === word || (entry.synonyms || []).some(s => s.toLowerCase() === word)) {
          ingredients.push(entry.dishNameLower);
          break;
        }
      }
      if (ingredients.length > 0) break;
    }
  }

  // ── STAGE 1 + 5 + 17: Candidate Generation + Hard Negatives ──
  // Hard-negative gate uses ingredients + visual cues + cooking indicators +
  // structured visual feature tokens (Stage 17) for richer evidence.
  const evidenceTokens = [...visualCues, ...cookingIndicators, ...featuresToTokens(visualFeatures)];
  const candidatePool = generateCandidates(ingredients, detectedObjects, evidenceTokens);

  // STAGE 1 (Layers 1-3): expose the recognition hierarchy for observability.
  const hierarchy = deriveHierarchy(ingredients, foodState, cookingIndicators);

  const lowerText = rawVisionText.toLowerCase();

  // ── STAGE 13: Normalize counts (halves/slices of one item → one) ──
  const normalizedCounts = normalizeCounts(counts, lowerText, detectedObjects);

  const candidates = [];
  for (const dish of candidatePool) {
    const result = scoreDish(dish, ingredients, visualCues, cookingIndicators, foodState, lowerText);
    if (result.score > 0.05) {
      // STAGE 2 + 3: Candidate Filtering — central evidence matrix first,
      // then the engine's inline evidence rules (belt-and-suspenders).
      const matrix = evidenceMatrixCheck(dish.dishNameLower, lowerText, visualCues, cookingIndicators);
      if (!matrix.ok) continue;
      if (!passesEvidenceCheck(dish.dishNameLower, lowerText, visualCues, cookingIndicators)) {
        continue;
      }
      candidates.push({ dish, score: result.score, explanation: result.explanation });
    }
  }

  if (userId && dbReady()) {
    try {
      for (const candidate of candidates) {
        const corrections = await FoodCorrection.find({ userId, userCorrection: candidate.dish.dishNameLower }).countDocuments();
        if (corrections > 0) {
          candidate.score += Math.min(corrections * 0.03, 0.15);
          candidate.explanation.push('Boosted: Past user corrections');
        }
      }
    } catch (err) {}
  }

  if (dbReady()) {
   try {
    for (const ingredient of ingredients) {
      const globalCorrections = await FoodCorrection.getCorrectionMap(ingredient);
      for (const correction of globalCorrections) {
        const matching = candidates.find(c => c.dish.dishNameLower === correction._id?.toLowerCase());
        if (matching && correction.count >= 3) {
          matching.score += Math.min(correction.count * 0.01, 0.10);
          matching.explanation.push('Boosted: Global user corrections');
        }
      }
    }
   } catch (err) {}
  }

  candidates.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const top = [];
  for (const c of candidates) {
    const key = c.dish.dishNameLower;
    if (!seen.has(key) && top.length < 10) {
      seen.add(key);
      top.push(c);
    }
  }

  const { predictions: validatedTop, validationState } = validatePredictions(top, foodState, ingredients);

  // ── Helper: base ingredient of a dish (for grouping) ──
  const baseOf = (dish) => {
    const parent = (dish.parentFood || '').toLowerCase().trim();
    if (parent) return parent;
    for (const ing of ingredients) {
      if (dish.dishNameLower?.includes(ing)) return ing;
    }
    return dish.dishNameLower;
  };

  // ── STAGE 13/14: Group candidates by base ingredient, pick ONE winner each ──
  // Each base-ingredient group yields a single primary; its mutually-exclusive
  // siblings become alternatives. This prevents one egg → [boiled, poached, omelet].
  const groups = new Map(); // baseIngredient → [candidates sorted by score]
  for (const c of validatedTop) {
    const base = baseOf(c.dish);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(c);
  }

  let isMeal = false;
  let mealType = 'unknown';
  const finalFoods = [];
  const primaryAlternatives = []; // alternatives for the PRIMARY food

  // Detect a true meal/platter top prediction
  const topPred = validatedTop[0];
  const isMealTop = topPred && ['meal', 'bowl', 'salad', 'platter', 'thali', 'combo'].some(w => topPred.dish.dishNameLower.includes(w));

  if (isMealTop && (ingredients.length > 1 || detectedObjects.length > 1)) {
    // Meal: top is the dish, components are distinct ingredients
    isMeal = true;
    mealType = topPred.dish.dishNameLower;
    finalFoods.push(topPred);
    for (const [base, cands] of groups) {
      if (base === baseOf(topPred.dish)) continue;
      finalFoods.push(cands[0]); // one winner per other ingredient group
    }
  } else {
    // One winner per DISTINCT base ingredient group.
    // Sort groups by their best candidate score (best group first).
    const sortedGroups = [...groups.values()].sort((a, b) => b[0].score - a[0].score);
    for (const cands of sortedGroups) {
      finalFoods.push(cands[0]); // primary for this ingredient
    }

    // STAGE 7 + 9: Build alternatives for the PRIMARY food only.
    // Alternatives = mutually-exclusive siblings of the primary + raw base.
    if (finalFoods.length > 0) {
      const primary = finalFoods[0];
      const primaryBase = baseOf(primary.dish);
      const seenAlt = new Set([primary.dish.dishNameLower]);

      // siblings from the same base group
      for (const c of (groups.get(primaryBase) || [])) {
        if (seenAlt.has(c.dish.dishNameLower)) continue;
        primaryAlternatives.push(c);
        seenAlt.add(c.dish.dishNameLower);
      }
      // also surface other conflicting dishes anywhere in the candidate list
      for (const c of validatedTop) {
        if (seenAlt.has(c.dish.dishNameLower)) continue;
        if (conflictsWith(primary.dish.dishNameLower, c.dish.dishNameLower)) {
          primaryAlternatives.push(c);
          seenAlt.add(c.dish.dishNameLower);
        }
      }
    }
  }

  // ── STAGE 7: Mutual Exclusion — drop foods that conflict with the primary ──
  if (finalFoods.length > 1) {
    const primaryName = finalFoods[0].dish.dishNameLower;
    for (let i = finalFoods.length - 1; i >= 1; i--) {
      if (conflictsWith(primaryName, finalFoods[i].dish.dishNameLower)) {
        primaryAlternatives.push(finalFoods[i]);
        finalFoods.splice(i, 1);
      }
    }
  }

  // ── STAGE 8: Confidence Calibration (sharpened — primary dominates) ──
  const VISION_BASE_CONFIDENCE = 0.75;
  for (const c of finalFoods) {
    const reasoningAdjustment = (c.score - 0.5) * 0.3;
    let finalConfidence = VISION_BASE_CONFIDENCE + reasoningAdjustment;
    finalConfidence = Math.max(0.20, Math.min(0.99, finalConfidence));
    c.finalConfidence = finalConfidence;
    c.reasoningAdjustment = reasoningAdjustment;
    c.explanation.push(`Confidence Calibrated: Vision (${(VISION_BASE_CONFIDENCE*100).toFixed(0)}%) + Reasoning (${(reasoningAdjustment > 0 ? '+' : '')}${(reasoningAdjustment*100).toFixed(0)}%) = ${(finalConfidence*100).toFixed(0)}%`);
  }

  // Calibrate alternatives — significantly lower than primary so it doesn't compete.
  const primaryConf = finalFoods[0]?.finalConfidence || 0.75;
  const calibratedAlternatives = primaryAlternatives.slice(0, 4).map((c, idx) => {
    // Alternatives decay: each step down loses ~35% relative confidence.
    const altConf = Math.max(0.05, Math.min(primaryConf - 0.20 - idx * 0.10, c.score * 0.5));
    return {
      name: c.dish.dishName,
      normalized_name: c.dish.dishNameLower,
      confidence: Number(altConf.toFixed(2)),
      category: c.dish.category,
    };
  });

  const determineCookingStyle = (dish) => {
    const dishStyles = (dish.cookingStyles || []).map(s => s.toLowerCase());
    for (const indicator of cookingIndicators) if (dishStyles.some(s => s.includes(indicator) || indicator.includes(s))) return indicator;
    if (foodState === 'raw' || (dish.category === 'ingredient' && cookingIndicators.length === 0)) return 'raw';
    if (cookingIndicators.length > 0) return cookingIndicators[0];
    return 'unknown';
  };

  const elapsed = Date.now() - startTime;

  // ── STAGE 11: Unknown Food Handling ──
  // If the best prediction is below 60%, flag as unknown rather than guessing.
  const topConfidence = finalFoods[0]?.finalConfidence || 0;
  const isUnknown = finalFoods.length === 0 || topConfidence < 0.60;

  return {
    predictions: finalFoods.map(c => ({
      dishName: c.dish.dishName,
      dishNameLower: c.dish.dishNameLower,
      category: c.dish.category,
      confidence: Number(c.finalConfidence.toFixed(2)),
      reasoningAdjustment: Number(c.reasoningAdjustment.toFixed(2)),
      reasoningExplanation: c.explanation,
      cookingStyle: determineCookingStyle(c.dish),
      ingredients: c.dish.ingredients || [],
      defaultGrams: c.dish.defaultGrams || { small: 80, medium: 150, large: 250 },
      caloriesPer100g: c.dish.caloriesPer100g || 0,
      proteinPer100g: c.dish.proteinPer100g || 0,
      carbsPer100g: c.dish.carbsPer100g || 0,
      fatPer100g: c.dish.fatPer100g || 0,
      fiberPer100g: c.dish.fiberPer100g || 0,
      usdaKeyword: c.dish.usdaKeyword || c.dish.dishName,
      offKeyword: c.dish.offKeyword || c.dish.dishName,
      cuisines: c.dish.cuisines || [],
      tags: c.dish.tags || [],
    })),
    isMeal,
    mealType,
    validationState,
    hierarchy,
    isUnknown,
    visualFeatures,
    alternatives: calibratedAlternatives,
    extractedIngredients: ingredients,
    objectCount: detectedObjects.length,
    objectsDetected: detectedObjects,
    visualCues,
    cookingIndicators,
    portionCues,
    counts: normalizedCounts,
    foodState,
    ontologySize: _ontologyCache.length,
    reasoningTimeMs: elapsed,
  };
}

export function getOntologyCacheSize() {
  return _ontologyCache.length;
}

/**
 * TEST-ONLY: inject a mock ontology cache so reason() can run without MongoDB.
 * Not used in production paths.
 */
export function __setOntologyCacheForTest(mockCache) {
  _ontologyCache = mockCache || [];
  _cacheLoadedAt = Date.now();
}
