/**
 * Food Match Engine — Production-Grade Search Scoring & Validation
 * 
 * Solves: egg → MuscleBlaze Whey, natural food → supplement mismatch
 * 
 * Pipeline:
 * 1. Token-match scoring (exact, partial, boundary)
 * 2. Category filtering (natural_food NEVER matches supplement)
 * 3. Macro sanity validation
 * 4. Source quality weighting (USDA SR > USDA Branded > OFF natural > OFF packaged)
 * 5. Confidence-aware result ranking
 */

// ═══ FOOD CATEGORY CLASSIFIER ═══
const CATEGORY_RULES = {
  natural_food: {
    keywords: ['egg', 'rice', 'chicken', 'fish', 'milk', 'bread', 'potato', 'tomato', 'onion', 'carrot', 'apple', 'banana', 'orange', 'mango', 'wheat', 'corn', 'beans', 'lentil', 'dal', 'paneer', 'curd', 'yogurt', 'butter', 'ghee', 'oil', 'honey', 'salt', 'sugar', 'flour', 'cream'],
    reject: ['supplement', 'whey', 'protein powder', 'mass gainer', 'bcaa', 'creatine', 'pre workout', 'isolate', 'casein', 'amino'],
  },
  meat: {
    keywords: ['chicken', 'mutton', 'lamb', 'beef', 'pork', 'fish', 'prawns', 'shrimp', 'turkey', 'duck', 'goat', 'salmon', 'tuna', 'cod'],
    reject: ['supplement', 'protein powder', 'flavor', 'chip'],
  },
  dairy: {
    keywords: ['milk', 'curd', 'yogurt', 'paneer', 'cheese', 'butter', 'ghee', 'cream', 'lassi', 'buttermilk', 'kheer'],
    reject: ['supplement', 'protein powder', 'plant based'],
  },
  grain: {
    keywords: ['rice', 'wheat', 'roti', 'bread', 'oats', 'corn', 'barley', 'millet', 'bajra', 'jowar', 'quinoa', 'pasta', 'noodle'],
    reject: ['protein powder', 'supplement', 'protein bar'],
  },
  vegetable: {
    keywords: ['spinach', 'potato', 'tomato', 'onion', 'carrot', 'broccoli', 'cauliflower', 'cabbage', 'beans', 'peas', 'okra', 'eggplant', 'gourd', 'radish', 'cucumber', 'capsicum', 'mushroom'],
    reject: ['supplement', 'chip', 'protein'],
  },
  fruit: {
    keywords: ['apple', 'banana', 'mango', 'orange', 'grapes', 'watermelon', 'papaya', 'guava', 'pineapple', 'pomegranate', 'kiwi', 'strawberry', 'blueberry'],
    reject: ['juice brand', 'supplement', 'flavored'],
  },
  supplement: {
    keywords: ['whey', 'protein powder', 'mass gainer', 'bcaa', 'creatine', 'pre workout', 'isolate', 'casein', 'amino', 'multivitamin', 'glutamine', 'supplement'],
    reject: [],
  },
  packaged_food: {
    keywords: ['chips', 'biscuit', 'cookie', 'chocolate', 'candy', 'soda', 'juice', 'energy drink', 'bar', 'cereal'],
    reject: [],
  },
};

// ═══ MACRO EXPECTATIONS (per 100g) ═══
const MACRO_EXPECTATIONS = {
  egg: { calories: [130, 200], protein: [10, 15], carbs: [0, 3], fat: [8, 15] },
  'boiled egg': { calories: [130, 170], protein: [11, 14], carbs: [0, 2], fat: [9, 12] },
  rice: { calories: [100, 180], protein: [2, 5], carbs: [20, 45], fat: [0, 3] },
  'cooked rice': { calories: [100, 150], protein: [2, 4], carbs: [25, 40], fat: [0, 2] },
  chicken: { calories: [150, 280], protein: [20, 35], carbs: [0, 5], fat: [3, 20] },
  roti: { calories: [250, 350], protein: [8, 12], carbs: [45, 65], fat: [3, 10] },
  dal: { calories: [60, 150], protein: [4, 10], carbs: [8, 22], fat: [1, 7] },
  paneer: { calories: [250, 350], protein: [18, 28], carbs: [1, 5], fat: [18, 28] },
  milk: { calories: [40, 70], protein: [3, 5], carbs: [4, 6], fat: [1, 5] },
  banana: { calories: [80, 110], protein: [1, 2], carbs: [20, 30], fat: [0, 1] },
  apple: { calories: [45, 65], protein: [0, 1], carbs: [10, 16], fat: [0, 1] },
  bread: { calories: [240, 300], protein: [7, 12], carbs: [40, 55], fat: [2, 6] },
  potato: { calories: [70, 110], protein: [1, 3], carbs: [15, 25], fat: [0, 2] },
  oats: { calories: [350, 420], protein: [10, 17], carbs: [55, 70], fat: [5, 10] },
};

// ═══ CONFUSED PAIRS — prevent common mismatches ═══
const CONFUSED_PAIRS = {
  'egg': ['eggplant', 'egg noodle', 'egg roll wrapper', 'eggnog'],
  'rice': ['rice protein', 'rice milk', 'rice vinegar', 'rice paper'],
  'chicken': ['chicken flavor', 'chicken broth cube', 'chicken bouillon'],
  'milk': ['milk chocolate', 'milk protein', 'coconut milk powder'],
  'fish': ['fish sauce', 'fish oil capsule', 'fish cake'],
  'corn': ['corn syrup', 'corn starch', 'corn flour'],
  'butter': ['peanut butter', 'butter flavor', 'cocoa butter'],
};

/**
 * Classify food into a category based on its detected name
 */
function classifyFood(foodName) {
  const lower = (foodName || '').toLowerCase().trim();
  
  // Check supplement first (high priority)
  for (const kw of CATEGORY_RULES.supplement.keywords) {
    if (lower.includes(kw)) return 'supplement';
  }
  
  // Check other categories
  for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
    if (category === 'supplement' || category === 'packaged_food') continue;
    for (const kw of rules.keywords) {
      if (lower.includes(kw) || kw.includes(lower)) return category;
    }
  }
  
  return 'natural_food'; // Default assumption for camera-scanned foods
}

/**
 * Check if a result should be REJECTED based on category mismatch
 */
function shouldRejectResult(detectedCategory, resultName, resultBrand, resultType) {
  const combined = `${resultName} ${resultBrand}`.toLowerCase();
  
  // Natural food category should NEVER match supplements
  if (detectedCategory !== 'supplement') {
    const suppressPattern = /(whey|protein powder|mass gainer|bcaa|creatine|pre[\s-]?workout|isolate|casein|amino acid|multivitamin|supplement|glutamine)/i;
    if (suppressPattern.test(combined)) return true;
    if (resultType === 'supplement') return true;
  }
  
  // Get reject list for the category
  const rules = CATEGORY_RULES[detectedCategory];
  if (rules?.reject) {
    for (const rejectTerm of rules.reject) {
      if (combined.includes(rejectTerm.toLowerCase())) return true;
    }
  }
  
  return false;
}

/**
 * Score how well a search result matches the detected food
 * Higher score = better match
 */
function scoreResult(detectedName, result) {
  const detected = (detectedName || '').toLowerCase().trim();
  const resultName = (result.name || result.productName || '').toLowerCase().trim();
  const resultBrand = (result.brand || '').toLowerCase().trim();
  let score = 0;

  // ── TOKEN MATCH (most important) ──
  const detectedTokens = detected.split(/\s+/).filter(t => t.length >= 2);
  const resultTokens = resultName.split(/[\s,.\-_()]+/).filter(t => t.length >= 2);

  // Exact full match
  if (resultName === detected || resultName.startsWith(detected + ',') || resultName.startsWith(detected + ' ')) {
    score += 100;
  }

  // Token-level matching with word boundaries
  let matchedTokens = 0;
  for (const dt of detectedTokens) {
    // Exact token match (with word boundary)
    if (resultTokens.includes(dt)) {
      score += 30;
      matchedTokens++;
    }
    // Token starts with detected word
    else if (resultTokens.some(rt => rt.startsWith(dt) && rt.length <= dt.length + 3)) {
      score += 15;
      matchedTokens++;
    }
  }

  // Bonus if ALL detected tokens matched
  if (detectedTokens.length > 0 && matchedTokens === detectedTokens.length) {
    score += 40;
  }

  // ── CONFUSED PAIR PENALTY ──
  const confusedList = CONFUSED_PAIRS[detected] || [];
  for (const confused of confusedList) {
    if (resultName.includes(confused.toLowerCase())) {
      score -= 80; // Heavy penalty
    }
  }

  // Specific: "egg" should not match "eggplant"
  if (detected === 'egg' && resultName.includes('eggplant')) score -= 100;
  if (detected === 'egg' && resultName.includes('egg') && !resultName.includes('eggplant') && !resultName.includes('eggnog')) score += 20;

  // ── CATEGORY SAFETY ──
  const detectedCategory = classifyFood(detected);
  const resultType = result.type || (/(whey|protein|supplement|bcaa|creatine)/i.test(`${resultName} ${resultBrand}`) ? 'supplement' : 'food');
  
  if (shouldRejectResult(detectedCategory, resultName, resultBrand, resultType)) {
    score -= 200; // Massive rejection penalty
  }

  // ── SOURCE QUALITY ──
  const source = (result.source || result.origin || '').toLowerCase();
  if (source === 'usda' || source === 'usda-fallback') score += 20;
  if (source === 'openfoodfacts') {
    // OFF is only good for packaged/branded items
    if (detectedCategory === 'natural_food' || detectedCategory === 'meat' || detectedCategory === 'dairy' || detectedCategory === 'grain' || detectedCategory === 'vegetable' || detectedCategory === 'fruit') {
      score -= 20; // Penalize OFF for natural foods
    }
  }

  // ── BRAND PENALTY for natural foods ──
  if (detectedCategory !== 'supplement' && detectedCategory !== 'packaged_food' && resultBrand) {
    // Having a brand for natural food is suspicious
    if (/(muscleblaze|myprotein|optimum|gnc|herbalife|amway|garden of life)/i.test(resultBrand)) {
      score -= 150; // Definitely wrong
    }
  }

  // ── RESULT NAME LENGTH PENALTY ──
  // Very long names usually indicate packaged products
  if (resultName.length > 60 && detectedCategory === 'natural_food') {
    score -= 15;
  }

  // ── USDA dataType preference ──
  // SR Legacy and Foundation are for natural/raw foods
  if (result.fdcId && result.category && detectedCategory !== 'supplement') {
    const cat = (result.category || '').toLowerCase();
    if (cat.includes('survey') || cat.includes('foundation') || cat.includes('sr legacy')) {
      score += 20;
    }
  }

  return score;
}

/**
 * Validate nutrition macros against expectations
 * Returns { valid: boolean, score: number (0-100), issues: string[] }
 */
function validateMacros(detectedName, food) {
  const lower = (detectedName || '').toLowerCase().trim();
  const issues = [];
  let penaltyScore = 0;

  // Check against known expectations
  const expectations = MACRO_EXPECTATIONS[lower];
  if (expectations) {
    const cal = food.calories || 0;
    const pro = food.protein || 0;
    const carb = food.carbs || 0;
    const fat = food.fat || 0;

    if (cal < expectations.calories[0] || cal > expectations.calories[1]) {
      issues.push(`Calories ${cal} outside expected range ${expectations.calories.join('-')}`);
      penaltyScore += 30;
    }
    if (pro < expectations.protein[0] || pro > expectations.protein[1]) {
      issues.push(`Protein ${pro}g outside expected ${expectations.protein.join('-')}g`);
      penaltyScore += 30;
    }
    if (carb < expectations.carbs[0] || carb > expectations.carbs[1]) {
      issues.push(`Carbs ${carb}g outside expected ${expectations.carbs.join('-')}g`);
      penaltyScore += 20;
    }
    if (fat < expectations.fat[0] || fat > expectations.fat[1]) {
      issues.push(`Fat ${fat}g outside expected ${expectations.fat.join('-')}g`);
      penaltyScore += 20;
    }
  }

  // General sanity: macros can't exceed 100g total per 100g serving
  const macroTotal = (food.protein || 0) + (food.carbs || 0) + (food.fat || 0);
  if (macroTotal > 105) {
    issues.push(`Total macros ${macroTotal}g exceed 100g per serving`);
    penaltyScore += 40;
  }

  // Calorie cross-check
  const expectedCal = ((food.protein || 0) * 4) + ((food.carbs || 0) * 4) + ((food.fat || 0) * 9);
  if (food.calories > 0 && Math.abs(food.calories - expectedCal) > expectedCal * 0.5) {
    issues.push(`Calorie mismatch: ${food.calories} vs calculated ~${Math.round(expectedCal)}`);
    penaltyScore += 20;
  }

  return {
    valid: penaltyScore < 30,
    score: Math.max(0, 100 - penaltyScore),
    issues,
  };
}

/**
 * MAIN: Score, filter, and rank search results for a detected food
 * 
 * @param {string} detectedName - The AI-detected food name
 * @param {Array} results - Raw search results from DB/USDA/OFF
 * @param {object} options - { category, confidence, cookingState }
 * @returns {Array} Sorted, filtered results with scores
 */
function rankAndFilterResults(detectedName, results, options = {}) {
  if (!Array.isArray(results) || results.length === 0) return [];

  const detected = (detectedName || '').toLowerCase().trim();
  const detectedCategory = options.category || classifyFood(detected);

  const scored = results.map(r => {
    const name = r.name || r.productName || '';
    const brand = r.brand || '';
    const type = r.type || 'food';

    // Step 1: Category rejection
    if (shouldRejectResult(detectedCategory, name, brand, type)) {
      return { ...r, _matchScore: -999, _rejected: true, _reason: 'category_mismatch' };
    }

    // Step 2: Scoring
    let matchScore = scoreResult(detectedName, r);

    // Step 3: Macro validation bonus/penalty
    const macroCheck = validateMacros(detected, r);
    if (!macroCheck.valid) {
      matchScore -= 30;
    } else {
      matchScore += 10;
    }

    // Step 4: Cooking state match bonus
    if (options.cookingState && options.cookingState !== 'general') {
      const rName = name.toLowerCase();
      if (rName.includes(options.cookingState)) {
        matchScore += 15;
      }
    }

    return {
      ...r,
      _matchScore: matchScore,
      _rejected: matchScore < -50,
      _macroValidation: macroCheck,
      _reason: matchScore < -50 ? 'low_score' : null,
    };
  });

  // Filter out rejected results
  const accepted = scored.filter(r => !r._rejected);

  // Sort by score descending
  accepted.sort((a, b) => b._matchScore - a._matchScore);

  // Log for debugging
  if (accepted.length > 0) {
    console.log(`[FoodMatch] "${detectedName}" → top: "${accepted[0].name}" (score: ${accepted[0]._matchScore})`);
  }
  const rejected = scored.filter(r => r._rejected);
  if (rejected.length > 0) {
    console.log(`[FoodMatch] "${detectedName}" rejected ${rejected.length}: ${rejected.slice(0, 3).map(r => `"${r.name}" (${r._reason})`).join(', ')}`);
  }

  return accepted;
}

export {
  classifyFood,
  shouldRejectResult,
  scoreResult,
  validateMacros,
  rankAndFilterResults,
  MACRO_EXPECTATIONS,
  CONFUSED_PAIRS,
};
