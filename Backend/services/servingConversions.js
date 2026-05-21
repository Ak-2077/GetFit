/**
 * Serving Conversion System
 * Maps common food units (bowl, cup, piece, scoop) to gram equivalents.
 * Used for dynamic nutrition recalculation in the hybrid food scanner.
 */

// Common serving → grams conversion map
const SERVING_MAP = {
  // Grains & Rice
  'rice': { bowl: 150, cup: 185, serving: 150 },
  'cooked rice': { bowl: 150, cup: 185, serving: 150 },
  'oats': { bowl: 40, cup: 80, serving: 40, scoop: 30 },
  'oatmeal': { bowl: 234, cup: 234, serving: 234 },
  'pasta': { bowl: 200, cup: 140, serving: 200 },
  'noodles': { bowl: 200, cup: 160, serving: 200 },
  'bread': { piece: 30, slice: 30, serving: 30 },
  'roti': { piece: 35, serving: 35 },
  'chapati': { piece: 35, serving: 35 },
  'paratha': { piece: 60, serving: 60 },
  'naan': { piece: 90, serving: 90 },
  'dosa': { piece: 55, serving: 55 },
  'idli': { piece: 40, serving: 80 },

  // Protein
  'egg': { piece: 50, serving: 50 },
  'boiled egg': { piece: 50, serving: 50 },
  'chicken breast': { piece: 150, serving: 100 },
  'chicken': { piece: 120, serving: 100 },
  'paneer': { piece: 25, cube: 15, serving: 100, bowl: 150 },
  'tofu': { piece: 30, serving: 100, bowl: 150 },
  'fish': { piece: 120, serving: 100, fillet: 150 },
  'salmon': { piece: 150, fillet: 150, serving: 100 },
  'shrimp': { piece: 8, serving: 85 },

  // Dairy
  'milk': { cup: 244, glass: 244, serving: 244 },
  'yogurt': { cup: 245, bowl: 200, serving: 150 },
  'curd': { cup: 245, bowl: 200, serving: 150 },
  'cheese': { slice: 20, piece: 20, serving: 30 },
  'butter': { tbsp: 14, tsp: 5, serving: 14 },
  'ghee': { tbsp: 14, tsp: 5, serving: 14 },

  // Fruits
  'banana': { piece: 120, medium: 120, serving: 120 },
  'apple': { piece: 180, medium: 180, serving: 180 },
  'orange': { piece: 130, medium: 130, serving: 130 },
  'mango': { piece: 200, cup: 165, serving: 165 },
  'grapes': { cup: 150, bowl: 150, serving: 150 },
  'watermelon': { cup: 150, slice: 280, serving: 150 },
  'papaya': { cup: 140, bowl: 200, serving: 140 },

  // Vegetables
  'broccoli': { cup: 91, bowl: 150, serving: 91 },
  'spinach': { cup: 30, bowl: 60, serving: 85 },
  'potato': { piece: 150, medium: 150, serving: 150 },
  'sweet potato': { piece: 130, medium: 130, serving: 130 },
  'tomato': { piece: 125, medium: 125, serving: 125 },
  'onion': { piece: 110, medium: 110, serving: 110 },
  'carrot': { piece: 70, medium: 70, serving: 70 },
  'cucumber': { piece: 200, cup: 120, serving: 120 },

  // Indian Foods
  'dal': { bowl: 200, cup: 200, serving: 200 },
  'rajma': { bowl: 200, cup: 200, serving: 200 },
  'chole': { bowl: 200, cup: 200, serving: 200 },
  'sambar': { bowl: 200, cup: 200, serving: 200 },
  'curry': { bowl: 200, cup: 200, serving: 200 },
  'biryani': { bowl: 250, plate: 300, serving: 250 },
  'khichdi': { bowl: 200, serving: 200 },
  'upma': { bowl: 200, serving: 200 },
  'poha': { bowl: 180, plate: 200, serving: 180 },

  // Supplements
  'whey protein': { scoop: 30, serving: 30 },
  'protein powder': { scoop: 30, serving: 30 },
  'creatine': { scoop: 5, tsp: 5, serving: 5 },
  'mass gainer': { scoop: 75, serving: 75 },
  'bcaa': { scoop: 7, serving: 7 },
  'pre workout': { scoop: 10, serving: 10 },

  // Nuts & Seeds
  'almonds': { piece: 1.2, handful: 28, serving: 28 },
  'peanuts': { handful: 28, cup: 146, serving: 28 },
  'cashews': { piece: 1.5, handful: 28, serving: 28 },
  'walnuts': { piece: 4, handful: 28, serving: 28 },
  'peanut butter': { tbsp: 32, serving: 32, scoop: 32 },

  // Beverages
  'coffee': { cup: 240, mug: 350, serving: 240 },
  'tea': { cup: 240, mug: 350, serving: 240 },
  'juice': { glass: 250, cup: 250, serving: 250 },
  'smoothie': { glass: 300, cup: 250, serving: 300 },
  'lassi': { glass: 250, serving: 250 },
  'buttermilk': { glass: 250, serving: 250 },
};

// Available unit options per food (for UI dropdown)
const UNIT_OPTIONS = ['g', 'ml', 'bowl', 'cup', 'piece', 'serving', 'scoop', 'slice', 'tbsp', 'tsp', 'handful', 'plate', 'glass', 'fillet'];

/**
 * Get gram equivalent for a food + unit combination.
 * @param {string} foodName - Food name (case-insensitive)
 * @param {string} unit - Unit type (bowl, cup, piece, etc.)
 * @returns {number|null} Grams per unit, or null if no conversion found
 */
export const getGramsPerUnit = (foodName, unit) => {
  if (!foodName || !unit) return null;
  if (unit === 'g' || unit === 'ml') return 1;

  const lower = foodName.toLowerCase().trim();
  const unitLower = unit.toLowerCase().trim();

  // Direct match
  if (SERVING_MAP[lower] && SERVING_MAP[lower][unitLower] !== undefined) {
    return SERVING_MAP[lower][unitLower];
  }

  // Partial match (e.g., "cooked basmati rice" matches "rice")
  for (const [key, conversions] of Object.entries(SERVING_MAP)) {
    if (lower.includes(key) && conversions[unitLower] !== undefined) {
      return conversions[unitLower];
    }
  }

  return null;
};

/**
 * Get available unit options for a food.
 * @param {string} foodName
 * @returns {string[]} Available units including g/ml + food-specific ones
 */
export const getUnitsForFood = (foodName) => {
  const base = ['g'];
  if (!foodName) return base;

  const lower = foodName.toLowerCase().trim();

  // Find matching food units
  let matched = null;
  if (SERVING_MAP[lower]) {
    matched = SERVING_MAP[lower];
  } else {
    for (const [key, conversions] of Object.entries(SERVING_MAP)) {
      if (lower.includes(key)) {
        matched = conversions;
        break;
      }
    }
  }

  if (matched) {
    const units = Object.keys(matched).filter(u => u !== 'serving');
    return [...base, 'serving', ...units];
  }

  // Default units
  return [...base, 'serving', 'bowl', 'cup', 'piece'];
};

/**
 * Detect food type from name.
 * @param {string} foodName
 * @returns {'raw'|'cooked'|'packaged'|'supplement'|'general'}
 */
export const detectFoodType = (foodName) => {
  if (!foodName) return 'general';
  const lower = foodName.toLowerCase();

  if (/(raw|uncooked|fresh)\s/.test(lower)) return 'raw';
  if (/(cooked|boiled|steamed|grilled|fried|baked|roasted|sautéed|braised|stewed)/.test(lower)) return 'cooked';
  if (/(whey|creatine|bcaa|pre[\s-]?workout|mass gainer|protein powder|supplement|vitamin|capsule|tablet)/.test(lower)) return 'supplement';
  if (/(bar|chips|biscuit|cookie|candy|chocolate bar|packaged|branded|snack pack)/.test(lower)) return 'packaged';

  return 'general';
};

/**
 * Calculate nutrition for a given quantity and unit.
 * @param {object} food - Food object with per-100g nutrition values
 * @param {number} quantity - Amount in selected unit
 * @param {string} unit - Unit (g, bowl, cup, piece, etc.)
 * @returns {object} Adjusted nutrition values
 */
export const calculateNutrition = (food, quantity, unit) => {
  if (!food || !quantity || quantity <= 0) {
    return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 };
  }

  let grams = quantity;
  if (unit !== 'g' && unit !== 'ml') {
    const gramsPerUnit = getGramsPerUnit(food.name || '', unit);
    grams = gramsPerUnit ? quantity * gramsPerUnit : quantity;
  }

  // Nutrition values are per 100g
  const multiplier = grams / 100;

  return {
    calories: Math.round((food.calories || 0) * multiplier),
    protein: Number(((food.protein || 0) * multiplier).toFixed(1)),
    carbs: Number(((food.carbs || 0) * multiplier).toFixed(1)),
    fat: Number(((food.fat || 0) * multiplier).toFixed(1)),
    fiber: Number(((food.fiber || 0) * multiplier).toFixed(1)),
    sugar: Number(((food.sugar || 0) * multiplier).toFixed(1)),
    grams: Math.round(grams),
  };
};

export default {
  getGramsPerUnit,
  getUnitsForFood,
  detectFoodType,
  calculateNutrition,
  UNIT_OPTIONS,
};
