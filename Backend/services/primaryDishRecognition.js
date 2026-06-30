/**
 * Stage 29 — Primary Dish Recognition & Compound Dish Reasoning
 * ──────────────────────────────────────────────────────────────
 * Runs BEFORE candidate scoring. Infers ONE primary dish FAMILY from the
 * structural evidence (objects > ingredients > sauce), then lets the
 * reasoning engine restrict scoring to dishes inside that family
 * (family mutual exclusion).
 *
 * Why: the engine used to reason ingredient → many dishes, so "penne + tomato"
 * could surface "Tomato Soup" and "Bolognese" together. Hierarchical reasoning
 * fixes this:  Image → Food Family → Primary Dish → Sauce → Ingredients.
 *
 * SAFETY / BACKWARD COMPAT:
 *   • A family is only inferred when the vision text/objects contain a clear
 *     PRIMARY-DISH keyword (pasta, pizza, burger, fried rice, biryani, …).
 *     Plain ingredient plates ("grilled chicken and white rice") infer NO
 *     family → no restriction → existing multi-food behavior is preserved.
 *   • If TWO+ distinct families are detected (physically separate foods),
 *     no restriction is applied.
 *   • Pure functions, dependency-free, unit-testable without a DB.
 * ──────────────────────────────────────────────────────────────
 */

// ═══ PRIMARY DISH FAMILY HIERARCHY ═══
// `detect`  — keywords in the vision text/objects that SELECT this family as
//             the primary (compound / structural dish names only).
// `member`  — classifies an ontology dish into this family (for restriction).
// Order matters: more specific families are listed first.
export const PRIMARY_DISH_FAMILIES = [
  {
    family: 'Pizza', group: 'Italian',
    detect: /\b(pizza|margherita|pepperoni|calzone)\b/,
    member: /\b(pizza|margherita|pepperoni|calzone)\b/,
  },
  {
    family: 'Burger', group: 'Bread',
    detect: /\b(burger|cheeseburger|hamburger|patty)\b/,
    member: /\b(burger|cheeseburger|hamburger|slider)\b/,
  },
  {
    family: 'Wrap', group: 'Bread',
    detect: /\b(wrap|burrito|taco|tortilla|quesadilla|nachos|kathi|frankie)\b/,
    member: /\b(wrap|burrito|taco|tortilla|quesadilla|nachos|kathi|frankie)\b/,
  },
  {
    family: 'Pasta', group: 'Italian',
    detect: /\b(pasta|penne|spaghetti|macaroni|fusilli|rigatoni|fettuccine|lasagna|alfredo|arrabbiata|marinara|carbonara|bolognese)\b/,
    member: /\b(pasta|penne|spaghetti|macaroni|fusilli|rigatoni|fettuccine|lasagna|alfredo|arrabbiata|marinara|carbonara|bolognese|pesto)\b/,
  },
  {
    family: 'Noodles', group: 'Asian',
    detect: /\b(noodle|noodles|ramen|chow ?mein|hakka|pho|udon|pad thai)\b/,
    member: /\b(noodle|noodles|ramen|chow ?mein|hakka|pho|udon|pad thai|maggi|spaghetti)\b/,
  },
  {
    family: 'Rice', group: 'Rice',
    // Compound rice dishes only — plain "rice" must NOT trigger a family so
    // "chicken and rice" stays a multi-food plate.
    detect: /\b(fried rice|biryani|pulao|pilaf|risotto|jeera rice|curd rice|lemon rice|pilau)\b/,
    member: /\b(rice|biryani|pulao|pilaf|risotto|pilau)\b/,
  },
  {
    family: 'Sandwich', group: 'Bread',
    detect: /\b(sandwich|panini|sub|bruschetta)\b/,
    member: /\b(sandwich|panini|sub|bruschetta|toast)\b/,
  },
  {
    family: 'Salad', group: 'Salad',
    detect: /\b(salad)\b/,
    member: /\b(salad)\b/,
  },
  {
    family: 'Soup', group: 'Soup',
    detect: /\b(soup|broth|bisque|chowder)\b/,
    member: /\b(soup|broth|bisque|chowder)\b/,
  },
];

// ═══ SAUCE RECOGNITION ═══
// Detected sauces boost dishes that require them (compound dish reasoning).
export const SAUCE_PATTERNS = [
  { sauce: 'tomato sauce', match: /\b(tomato sauce|marinara|red sauce|arrabbiata|pomodoro)\b/, boosts: /\b(marinara|arrabbiata|bolognese|pomodoro|tomato)\b/ },
  { sauce: 'cream sauce', match: /\b(cream sauce|alfredo|white sauce|bechamel|creamy)\b/, boosts: /\b(alfredo|carbonara|white sauce|creamy)\b/ },
  { sauce: 'pesto', match: /\b(pesto|basil sauce)\b/, boosts: /\b(pesto)\b/ },
  { sauce: 'cheese sauce', match: /\b(cheese sauce|mac and cheese|queso)\b/, boosts: /\b(cheese|alfredo|mac)\b/ },
  { sauce: 'brown gravy', match: /\b(brown gravy|gravy)\b/, boosts: /\b(gravy|roast|stew)\b/ },
  { sauce: 'curry', match: /\b(curry|masala|korma|tikka)\b/, boosts: /\b(curry|masala|korma|tikka)\b/ },
  { sauce: 'soy sauce', match: /\b(soy sauce|teriyaki|hoisin)\b/, boosts: /\b(fried rice|noodle|stir|teriyaki|hakka)\b/ },
  { sauce: 'green chutney', match: /\b(green chutney|mint chutney|coriander chutney)\b/, boosts: /\b(chutney|sandwich|chaat)\b/ },
];

/**
 * Detect sauces present in the description.
 * @returns {string[]} list of sauce identifiers
 */
export function detectSauces(lowerText) {
  const out = [];
  for (const s of SAUCE_PATTERNS) {
    if (s.match.test(lowerText)) out.push(s.sauce);
  }
  return out;
}

// ═══ SPECIFIC-DISH SIGNATURE GATE ═══
// Specific named recipes must NOT be chosen over a generic family dish unless
// their distinguishing signal is present. A plain red-sauce penne is "Penne
// Pasta", not "Arrabbiata" (spicy) or "Marinara" — those need their own cue.
// Visually-distinct sauces (white/cream → alfredo, green/basil → pesto) are
// allowed on that visual cue alone.
export const SPECIFIC_DISH_SIGNATURES = [
  { match: /\barrabbiata\b/,            requires: /\barrabbiata\b/ },
  { match: /\bmarinara\b/,              requires: /\bmarinara\b/ },
  { match: /\bpomodoro\b/,              requires: /\bpomodoro\b/ },
  { match: /\balfredo\b/,               requires: /\b(alfredo|cream|creamy|white sauce)\b/ },
  { match: /\bcarbonara\b/,             requires: /\b(carbonara|bacon|pancetta|egg)\b/ },
  { match: /\bpesto\b/,                 requires: /\b(pesto|basil|green sauce)\b/ },
  { match: /\bprimavera\b/,             requires: /\b(primavera|vegetable|veggies)\b/ },
];

/**
 * Score delta for a specific named recipe based on its distinguishing signal:
 *   • +0.22 when the signature IS present  → beats the generic family dish
 *   • -0.35 when the signature is ABSENT   → generic family dish wins
 *   •  0    when the dish is not a specific named recipe
 */
export function specificDishScoreDelta(dishNameLower, evidenceText) {
  const name = (dishNameLower || '').toLowerCase();
  const text = (evidenceText || '').toLowerCase();
  for (const s of SPECIFIC_DISH_SIGNATURES) {
    if (s.match.test(name)) {
      return s.requires.test(text) ? 0.22 : -0.35;
    }
  }
  return 0;
}

/**
 * Returns true when `dishNameLower` is a SPECIFIC named recipe whose
 * distinguishing signal is NOT present in the evidence text — meaning a
 * generic family dish should be preferred instead.
 */
export function specificDishLacksSignature(dishNameLower, evidenceText) {
  const name = (dishNameLower || '').toLowerCase();
  const text = (evidenceText || '').toLowerCase();
  for (const s of SPECIFIC_DISH_SIGNATURES) {
    if (s.match.test(name)) return !s.requires.test(text);
  }
  return false;
}

/**
 * Map an ontology dish name to its primary family (or null if unclassified).
 */
export function dishFamily(dishNameLower) {
  const n = (dishNameLower || '').toLowerCase();
  for (const f of PRIMARY_DISH_FAMILIES) {
    if (f.member.test(n)) return f.family;
  }
  return null;
}

/**
 * Stage 29 — infer the ONE primary dish family from structural evidence.
 *
 * @param {string} lowerText        vision description (lowercased)
 * @param {string[]} ingredients    detected ingredients (canonicalized)
 * @param {Array<{name:string}>} detectedObjects  object-detection results
 * @returns {{ family, group, confidence, sauces, evidence, multiFamily }|null}
 *          null → no single family inferred (skip restriction; preserve legacy).
 */
export function inferPrimaryFamily(lowerText, ingredients = [], detectedObjects = []) {
  // Structural priority: objects first, then text. Build a combined evidence
  // string so a detected object ("penne pasta", "bun", "patty") drives family.
  const objText = (detectedObjects || []).map(o => (o?.name || '').toLowerCase()).join(' ');
  const evidenceText = `${objText} ${lowerText || ''}`.toLowerCase();

  // "bun" + "patty" → Burger (structural object combo with no explicit name)
  const hasBun = /\bbun\b/.test(evidenceText);
  const hasPatty = /\b(patty|cutlet)\b/.test(evidenceText);

  const matched = [];
  for (const f of PRIMARY_DISH_FAMILIES) {
    if (f.detect.test(evidenceText)) matched.push(f);
  }
  if (hasBun && hasPatty && !matched.find(m => m.family === 'Burger')) {
    matched.push(PRIMARY_DISH_FAMILIES.find(f => f.family === 'Burger'));
  }

  // 0 families → no restriction (plain ingredient plate). Preserves legacy.
  if (matched.length === 0) return null;

  // 2+ DISTINCT families → multiple physically separate foods → no restriction.
  const distinct = [...new Set(matched.map(m => m.family))];
  if (distinct.length > 1) {
    return { family: null, group: null, confidence: 0, sauces: detectSauces(evidenceText), evidence: distinct, multiFamily: true };
  }

  const top = matched[0];
  const sauces = detectSauces(evidenceText);
  return {
    family: top.family,
    group: top.group,
    confidence: 0.95,
    sauces,
    evidence: [top.family],
    multiFamily: false,
  };
}

/**
 * Restrict a candidate pool to dishes inside the inferred family.
 * Fail-safe: if restriction removes everything, returns the original pool.
 *
 * @param {Array} candidatePool  ontology dishes ({ dishNameLower, ... })
 * @param {string} family        the inferred primary family
 * @returns {{ pool: Array, rejected: string[] }}
 */
export function restrictToFamily(candidatePool, family) {
  if (!family) return { pool: candidatePool, rejected: [] };
  const kept = [];
  const rejected = [];
  for (const dish of candidatePool) {
    const fam = dishFamily(dish.dishNameLower || '');
    if (fam === family) kept.push(dish);
    else rejected.push(dish.dishNameLower);
  }
  if (kept.length === 0) {
    // Nothing in this family exists in the ontology shortlist — don't blank the
    // result; fall back to the unrestricted pool.
    return { pool: candidatePool, rejected: [] };
  }
  return { pool: kept, rejected };
}
