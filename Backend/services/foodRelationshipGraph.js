/**
 * Stage 22 — Food Relationship Graph
 * ──────────────────────────────────────────────────────────────
 * Hierarchical graph: base ingredient → preparations. Reasoning traverses
 * this graph (parent → children) instead of flat-matching the whole ontology.
 *
 * Pure & dependency-free. Additive — used to scope candidates and to derive
 * mutually-exclusive sibling sets for a given base.
 * ──────────────────────────────────────────────────────────────
 */

export const FOOD_GRAPH = {
  egg: {
    base: 'egg',
    category: 'egg',
    children: [
      'raw egg', 'boiled egg', 'hard-boiled egg', 'soft-boiled egg',
      'fried egg', 'sunny side up', 'omelet', 'scrambled egg',
      'poached egg', 'egg curry', 'egg bhurji', 'egg sandwich',
      'egg fried rice', 'egg biryani',
    ],
    // children that cannot coexist for ONE egg object
    exclusive: [
      'boiled egg', 'hard-boiled egg', 'soft-boiled egg', 'fried egg',
      'sunny side up', 'omelet', 'scrambled egg', 'poached egg',
    ],
  },
  chicken: {
    base: 'chicken',
    category: 'chicken',
    children: ['raw chicken', 'grilled chicken', 'fried chicken', 'roasted chicken', 'tandoori chicken', 'chicken curry', 'butter chicken', 'chicken wings', 'chicken sandwich', 'chicken biryani'],
    exclusive: ['grilled chicken', 'fried chicken', 'roasted chicken', 'tandoori chicken'],
  },
  rice: {
    base: 'rice',
    category: 'grain',
    children: ['white rice', 'brown rice', 'fried rice', 'biryani', 'pulao', 'jeera rice', 'curd rice'],
    exclusive: ['white rice', 'brown rice', 'fried rice', 'biryani', 'pulao'],
  },
  potato: {
    base: 'potato',
    category: 'vegetable',
    children: ['boiled potato', 'fried potato', 'mashed potato', 'baked potato', 'french fries'],
    exclusive: ['boiled potato', 'fried potato', 'mashed potato', 'baked potato', 'french fries'],
  },
  paneer: {
    base: 'paneer',
    category: 'dairy',
    children: ['raw paneer', 'paneer tikka', 'paneer curry', 'palak paneer', 'paneer bhurji'],
    exclusive: ['paneer tikka', 'paneer curry', 'palak paneer', 'paneer bhurji'],
  },
  fish: {
    base: 'fish',
    category: 'seafood',
    children: ['grilled fish', 'fried fish', 'fish curry', 'steamed fish'],
    exclusive: ['grilled fish', 'fried fish', 'fish curry', 'steamed fish'],
  },
};

/** Build a reverse index: any dish/child name → its base. */
const _childToBase = (() => {
  const idx = {};
  for (const [base, node] of Object.entries(FOOD_GRAPH)) {
    idx[base] = base;
    for (const child of node.children) idx[child] = base;
  }
  return idx;
})();

/** Return the base ingredient for a dish name (or null). */
export function baseOfDish(dishNameLower) {
  const n = (dishNameLower || '').toLowerCase().trim();
  if (_childToBase[n]) return _childToBase[n];
  // partial: longest base token contained in the name
  let best = null, bestLen = 0;
  for (const base of Object.keys(FOOD_GRAPH)) {
    if (n.includes(base) && base.length > bestLen) { best = base; bestLen = base.length; }
  }
  return best;
}

/** Return the children (preparations) for a detected base ingredient. */
export function childrenOf(base) {
  const node = FOOD_GRAPH[(base || '').toLowerCase()];
  return node ? node.children.slice() : [];
}

/** Are two dishes mutually-exclusive preparations of the same base? */
export function areExclusiveSiblings(aLower, bLower) {
  const baseA = baseOfDish(aLower);
  const baseB = baseOfDish(bLower);
  if (!baseA || baseA !== baseB) return false;
  const ex = FOOD_GRAPH[baseA].exclusive;
  return ex.includes(aLower) && ex.includes(bLower) && aLower !== bLower;
}

/**
 * Stage 22/23 — Graph-scoped candidate names for the detected bases.
 * Given detected ingredients, return the union of graph children so the
 * reasoner only traverses relevant preparations (not the whole ontology).
 */
export function graphCandidateNames(ingredients = []) {
  const names = new Set();
  for (const ing of ingredients) {
    const base = (ing || '').toLowerCase().replace(/s$/, '');
    if (FOOD_GRAPH[base]) {
      names.add(base);
      for (const c of FOOD_GRAPH[base].children) names.add(c);
    }
  }
  return [...names];
}
