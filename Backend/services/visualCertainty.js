/**
 * Stage 30 — Visual Certainty & Recipe Confidence Layer
 * ──────────────────────────────────────────────────────────────
 * Separates VISUAL FACTS (what the image proves) from RECIPE INFERENCE
 * (what we guess). The engine must never hallucinate a recipe name it
 * cannot visually confirm — "penne + red sauce" is "Penne Pasta", not
 * "Arrabbiata".
 *
 *   visualConfidence  — certainty of the directly-visible food/base/sauce
 *   recipeConfidence  — certainty of a SPECIFIC named recipe (independent)
 *
 * If recipeConfidence < RECIPE_CONFIDENCE_THRESHOLD, the recipe is NOT
 * surfaced as primary; the generic food is used and the candidate recipes
 * become "possible recipes" (alternatives).
 *
 * Pure, dependency-light, unit-testable without a DB.
 * ──────────────────────────────────────────────────────────────
 */

import { SPECIFIC_DISH_SIGNATURES } from './primaryDishRecognition.js';

// Recipe is only surfaced as primary when its confidence meets this bar.
export const RECIPE_CONFIDENCE_THRESHOLD =
  Number(process.env.RECIPE_CONFIDENCE_THRESHOLD) > 0
    ? Number(process.env.RECIPE_CONFIDENCE_THRESHOLD)
    : 0.75;

// ═══ RECIPE NAME DETECTION ═══
// A "recipe" is a specific named composite that can't be confirmed from the
// base food alone (sauce origin, spice level, hidden ingredients).
const RECIPE_NAME_PATTERN =
  /\b(arrabbiata|marinara|pomodoro|alfredo|carbonara|pesto|primavera|puttanesca|aglio e olio|napolitana|bolognese|ragu|peri ?peri|schezwan|szechuan|manchurian|biryani|jambalaya)\b/;

export function isSpecificRecipe(dishNameLower) {
  const n = (dishNameLower || '').toLowerCase();
  if (SPECIFIC_DISH_SIGNATURES.some((s) => s.match.test(n))) return true;
  return RECIPE_NAME_PATTERN.test(n);
}

// ═══ VISIBLE SAUCE DETECTOR ═══
// Sauce is a VISUAL FACT, not the recipe. Returns the most likely visible
// sauce + a confidence; falls back to { name: 'Unknown', confidence: 0 }.
export const VISIBLE_SAUCES = [
  { name: 'Tomato Sauce',      match: /\b(tomato sauce|red sauce|marinara|pomodoro|arrabbiata|tomato based|red gravy|tomato gravy)\b/, confidence: 0.96 },
  { name: 'White/Cream Sauce', match: /\b(white sauce|cream sauce|creamy|alfredo|bechamel|b[eé]chamel)\b/, confidence: 0.94 },
  { name: 'Pesto',             match: /\b(pesto|basil sauce|green sauce)\b/, confidence: 0.93 },
  { name: 'Cheese Sauce',      match: /\b(cheese sauce|queso|mac and cheese|nacho cheese)\b/, confidence: 0.92 },
  { name: 'Curry',             match: /\b(curry|masala|korma|tikka|makhani)\b/, confidence: 0.90 },
  { name: 'Brown Gravy',       match: /\b(brown gravy|gravy)\b/, confidence: 0.88 },
  { name: 'Soy Sauce',         match: /\b(soy sauce|teriyaki|hoisin|dark soy)\b/, confidence: 0.85 },
  { name: 'Green Chutney',     match: /\b(green chutney|mint chutney|coriander chutney)\b/, confidence: 0.85 },
  { name: 'Oil Based',         match: /\b(olive oil|oil based|aglio|garlic oil|tossed in oil|drizzled with oil)\b/, confidence: 0.80 },
];

export function detectVisibleSauce(lowerText) {
  const t = (lowerText || '').toLowerCase();
  for (const s of VISIBLE_SAUCES) {
    if (s.match.test(t)) return { name: s.name, confidence: s.confidence };
  }
  return { name: 'Unknown', confidence: 0 };
}

// ═══ VISIBLE INGREDIENT DETECTOR ═══
// Only ingredients literally described or object-detected. NEVER infer hidden
// ingredients / spices.
const VISIBLE_INGREDIENT_TOKENS = [
  'cheese', 'parsley', 'cilantro', 'coriander', 'basil', 'tomato', 'onion',
  'garlic', 'rice', 'egg', 'beans', 'corn', 'mushroom', 'broccoli', 'chicken',
  'beef', 'pork', 'peas', 'spinach', 'capsicum', 'bell pepper', 'olives',
  'lettuce', 'cucumber', 'carrot', 'potato', 'paneer', 'herbs', 'chili',
  'chilli', 'lemon', 'avocado', 'bacon', 'sausage', 'shrimp', 'prawn',
];

export function extractVisibleIngredients(lowerText, detectedObjects = []) {
  const t = (lowerText || '').toLowerCase();
  const found = new Set();
  for (const tok of VISIBLE_INGREDIENT_TOKENS) {
    if (new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) {
      found.add(tok);
    }
  }
  for (const o of detectedObjects || []) {
    if (o?.name) found.add(String(o.name).toLowerCase());
  }
  return [...found];
}

/**
 * Visual certainty for the chosen primary — how directly the food itself is
 * visible (independent of any recipe guess). High when the base ingredient is
 * detected and the family is confirmed.
 */
export function computeVisualCertainty({ dishNameLower, ingredients = [], detectedObjects = [], familyInferred = false, cueMatches = 0 }) {
  const n = (dishNameLower || '').toLowerCase();
  let c = 0.82;
  if (ingredients.some((i) => n.includes(i))) c += 0.08;     // base ingredient visible
  if ((detectedObjects || []).length > 0) c += 0.05;          // object detection backed
  if (familyInferred) c += 0.04;                              // family confirmed
  c += Math.min(0.04, cueMatches * 0.01);                     // visual cues
  return Math.min(0.99, Number(c.toFixed(2)));
}
