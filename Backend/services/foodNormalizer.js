/**
 * Food Normalization Engine
 * Maps regional/Indian food names to USDA-searchable terms.
 * Validates nutrition data for unrealistic values.
 */

// ═══ INDIAN FOOD → USDA SEARCH MAPPING ═══
const FOOD_NORMALIZATION_MAP = {
  // Indian staples
  'roti': 'whole wheat flatbread',
  'chapati': 'whole wheat flatbread',
  'phulka': 'whole wheat flatbread',
  'naan': 'naan bread',
  'paratha': 'whole wheat paratha fried',
  'puri': 'poori deep fried bread',
  'kulcha': 'naan bread',
  'bhatura': 'deep fried leavened bread',
  'dosa': 'dosa rice crepe',
  'masala dosa': 'dosa rice crepe with potato',
  'idli': 'idli steamed rice cake',
  'uttapam': 'rice pancake thick',
  'vada': 'lentil fritter fried',
  'appam': 'rice pancake fermented',

  // Rice dishes
  'biryani': 'biryani rice',
  'chicken biryani': 'chicken biryani rice',
  'veg biryani': 'vegetable biryani rice',
  'pulao': 'rice pilaf',
  'khichdi': 'khichdi rice lentil',
  'jeera rice': 'cumin rice cooked',
  'lemon rice': 'lemon rice cooked',
  'curd rice': 'yogurt rice',
  'fried rice': 'fried rice',

  // Dals & lentils
  'dal': 'lentil cooked',
  'dal fry': 'lentil cooked fried',
  'dal tadka': 'lentil cooked tempered',
  'dal makhani': 'black lentil cooked butter',
  'moong dal': 'mung bean cooked',
  'toor dal': 'pigeon pea cooked',
  'chana dal': 'bengal gram cooked',
  'masoor dal': 'red lentil cooked',
  'urad dal': 'black gram cooked',
  'rajma': 'kidney beans cooked',
  'chole': 'chickpeas cooked',
  'chana masala': 'chickpeas curry cooked',
  'kadhi': 'yogurt gram flour curry',
  'sambar': 'sambar lentil vegetable',
  'rasam': 'rasam tamarind soup',

  // Paneer dishes
  'paneer': 'paneer cottage cheese',
  'paneer butter masala': 'paneer butter masala curry',
  'paneer bhurji': 'cottage cheese scrambled',
  'palak paneer': 'spinach paneer curry',
  'shahi paneer': 'paneer cream curry',
  'paneer tikka': 'paneer grilled',
  'kadai paneer': 'paneer bell pepper curry',
  'matar paneer': 'paneer peas curry',

  // Vegetable dishes
  'sabzi': 'mixed vegetable curry',
  'aloo gobi': 'potato cauliflower curry',
  'aloo matar': 'potato peas curry',
  'aloo palak': 'potato spinach curry',
  'aloo paratha': 'potato stuffed flatbread',
  'bhindi masala': 'okra stir fried',
  'baingan bharta': 'eggplant roasted mashed',
  'lauki': 'bottle gourd cooked',
  'tinda': 'round gourd cooked',
  'karela': 'bitter gourd cooked',
  'methi': 'fenugreek leaves cooked',
  'palak': 'spinach cooked',
  'sarson ka saag': 'mustard greens cooked',
  'mixed veg': 'mixed vegetables curry',

  // Non-veg
  'butter chicken': 'butter chicken curry',
  'chicken tikka': 'chicken tikka grilled',
  'tandoori chicken': 'tandoori chicken roasted',
  'chicken curry': 'chicken curry cooked',
  'fish curry': 'fish curry cooked',
  'egg curry': 'egg curry cooked',
  'keema': 'ground meat curry',
  'mutton curry': 'lamb curry cooked',
  'chicken biryani': 'chicken biryani',
  'seekh kebab': 'ground meat kebab grilled',

  // Snacks & street food
  'samosa': 'samosa fried pastry',
  'pakora': 'pakora vegetable fritter',
  'bhel puri': 'bhel puri puffed rice',
  'pav bhaji': 'pav bhaji mashed vegetables',
  'chaat': 'chaat snack',
  'kachori': 'kachori fried stuffed',
  'aloo tikki': 'potato patty fried',
  'pani puri': 'pani puri',
  'sev puri': 'sev puri snack',
  'dabeli': 'dabeli spiced potato bun',
  'vada pav': 'vada pav potato fritter bun',
  'poha': 'flattened rice cooked',
  'upma': 'semolina porridge savory',

  // Sweets
  'gulab jamun': 'gulab jamun',
  'rasgulla': 'rasgulla',
  'jalebi': 'jalebi fried sweet',
  'kheer': 'rice pudding kheer',
  'halwa': 'halwa semolina pudding',
  'ladoo': 'ladoo sweet ball',
  'barfi': 'barfi milk sweet',
  'gajar halwa': 'carrot halwa pudding',
  'rasmalai': 'rasmalai cottage cheese sweet',

  // Drinks
  'lassi': 'lassi yogurt drink',
  'chaas': 'buttermilk',
  'chai': 'tea with milk',
  'masala chai': 'spiced tea with milk',
  'nimbu pani': 'lemonade',
  'jaljeera': 'cumin drink',

  // Gym / supplements
  'whey protein': 'whey protein powder',
  'whey': 'whey protein powder',
  'protein shake': 'protein shake whey',
  'bcaa': 'bcaa supplement',
  'creatine': 'creatine monohydrate',
  'pre workout': 'pre workout supplement',
  'mass gainer': 'mass gainer powder',
  'oats': 'oatmeal cooked',
  'peanut butter': 'peanut butter',
  'almonds': 'almonds raw',
  'banana shake': 'banana milkshake',

  // Common foods
  'boiled egg': 'egg boiled',
  'omelette': 'egg omelette',
  'scrambled eggs': 'egg scrambled',
  'toast': 'bread toasted',
  'sandwich': 'sandwich',
  'pasta': 'pasta cooked',
  'maggi': 'instant noodles',
  'noodles': 'noodles cooked',
};

// ═══ NUTRITION VALIDATION LIMITS ═══
const NUTRITION_LIMITS = {
  calories: { min: 0, max: 900, per100g: true },   // max 900 kcal per 100g (pure fat = 884)
  protein: { min: 0, max: 90, per100g: true },     // max 90g per 100g
  carbs: { min: 0, max: 100, per100g: true },      // max 100g per 100g
  fat: { min: 0, max: 100, per100g: true },        // max 100g per 100g
  fiber: { min: 0, max: 80, per100g: true },
  sugar: { min: 0, max: 100, per100g: true },
  sodium: { min: 0, max: 7000, per100g: true },    // mg
};

// ═══ PORTION CONVERSION MAP (unit → grams) ═══
const PORTION_MAP = {
  // General
  piece: 50,
  serving: 100,
  cup: 240,
  bowl: 200,
  plate: 300,
  glass: 250,
  tablespoon: 15,
  teaspoon: 5,
  scoop: 30,
  handful: 30,
  slice: 30,

  // Indian specific
  roti: 40,
  chapati: 40,
  paratha: 60,
  naan: 90,
  puri: 25,
  dosa: 80,
  idli: 30,
  vada: 50,
  samosa: 80,
  pakora: 30,
  ladoo: 40,
};

/**
 * Normalize a food name to USDA-searchable format
 */
function normalizeFoodName(name) {
  if (!name) return name;
  const lower = name.toLowerCase().trim();

  // Direct match (exact key)
  if (FOOD_NORMALIZATION_MAP[lower]) {
    return FOOD_NORMALIZATION_MAP[lower];
  }

  // Partial match — ONLY if the input CONTAINS a known key
  // (e.g., "chicken tikka masala" contains "chicken tikka" → maps correctly)
  // NEVER do key.includes(lower) as it causes "egg" → "egg curry cooked"
  let bestMatch = null;
  let bestMatchLen = 0;
  for (const [key, value] of Object.entries(FOOD_NORMALIZATION_MAP)) {
    if (lower.includes(key) && key.length > bestMatchLen) {
      bestMatch = value;
      bestMatchLen = key.length;
    }
  }
  if (bestMatch && bestMatchLen >= lower.length * 0.5) {
    return bestMatch;
  }

  // Strip common prefixes that confuse USDA search
  let cleaned = lower
    .replace(/^(raw|cooked|boiled|fried|grilled|roasted|baked|steamed)\s+/, '')
    .trim();

  return cleaned || name;
}

/**
 * Build optimal search terms for a detected food
 * Returns array of search terms to try in order
 */
function buildSearchTerms(food) {
  const terms = [];
  const { name, normalized_name, state, cooking_methods = [] } = food;

  // 1. Normalized name (best for Indian foods)
  if (normalized_name && normalized_name !== name) {
    terms.push(normalized_name);
  }

  // 2. Clean name with cooking context
  const cleanName = normalizeFoodName(name);
  if (cooking_methods.length > 0) {
    const method = cooking_methods[0];
    terms.push(`${cleanName} ${method}`);
  }

  // 3. Clean name alone
  terms.push(cleanName);

  // 4. Original name (as-is)
  if (!terms.includes(name.toLowerCase())) {
    terms.push(name);
  }

  // 5. USDA format: "food, state"
  if (state && state !== 'general') {
    terms.push(`${cleanName}, ${state}`);
  }

  // Deduplicate
  return [...new Set(terms.filter(t => t && t.length >= 2))];
}

/**
 * Validate nutrition data for unrealistic values
 * Returns { valid, issues[] }
 */
function validateNutrition(food) {
  const issues = [];

  if (!food) return { valid: false, issues: ['No food data'] };

  // Check macro totals
  const { calories = 0, protein = 0, carbs = 0, fat = 0 } = food;

  // Macros can't exceed 100g per 100g
  if (protein + carbs + fat > 105) {
    issues.push('Macros exceed 100% of serving');
  }

  // Calorie cross-check: cal ≈ protein*4 + carbs*4 + fat*9
  const expectedCal = (protein * 4) + (carbs * 4) + (fat * 9);
  if (calories > 0 && Math.abs(calories - expectedCal) > expectedCal * 0.4) {
    issues.push(`Calorie mismatch: reported ${calories}, expected ~${Math.round(expectedCal)}`);
  }

  // Per-field limits
  for (const [field, limits] of Object.entries(NUTRITION_LIMITS)) {
    const val = food[field];
    if (val != null) {
      if (val < limits.min) issues.push(`${field} below minimum (${val})`);
      if (val > limits.max) issues.push(`${field} exceeds maximum (${val} > ${limits.max})`);
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Convert portion to grams for nutrition scaling
 */
function portionToGrams(quantity, unit) {
  const q = Number(quantity) || 1;
  const u = (unit || 'serving').toLowerCase().trim();
  const gramsPerUnit = PORTION_MAP[u] || 100;
  return q * gramsPerUnit;
}

/**
 * Scale nutrition from per-100g to actual portion
 */
function scaleNutrition(food, quantity, unit) {
  if (!food) return food;
  const grams = portionToGrams(quantity, unit);
  const factor = grams / 100;

  return {
    ...food,
    calories: Math.round((food.calories || 0) * factor),
    protein: Math.round((food.protein || 0) * factor * 10) / 10,
    carbs: Math.round((food.carbs || 0) * factor * 10) / 10,
    fat: Math.round((food.fat || 0) * factor * 10) / 10,
    fiber: food.fiber != null ? Math.round((food.fiber || 0) * factor * 10) / 10 : undefined,
    sugar: food.sugar != null ? Math.round((food.sugar || 0) * factor * 10) / 10 : undefined,
    sodium: food.sodium != null ? Math.round((food.sodium || 0) * factor) : undefined,
    _scaledGrams: grams,
    _scaleFactor: factor,
  };
}

export {
  FOOD_NORMALIZATION_MAP,
  PORTION_MAP,
  normalizeFoodName,
  buildSearchTerms,
  validateNutrition,
  portionToGrams,
  scaleNutrition,
};
