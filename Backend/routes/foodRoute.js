import express from 'express';
import { 
  addBrandFood, 
  getBrandFoods, 
  getFoodByBarcode, 
  getFoodById,
  addFoodToLog, 
  getTodaysFoodLog, 
  removeFoodFromLog,
  searchFoods,
  searchFoodsByName
} from '../controllers/foodController.js';
import auth from '../middleware/authMiddleware.js';
import { buildSearchTerms, validateNutrition, scaleNutrition, normalizeFoodName } from '../services/foodNormalizer.js';
import { rankAndFilterResults, classifyFood, validateMacros } from '../services/foodMatchEngine.js';
import { searchUSDA } from '../services/foodApiService.js';
import FoodMemory from '../models/foodMemory.js';

const router = express.Router();

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8100';

// ═══ BUILT-IN FALLBACK NUTRITION (per 100g, verified USDA data) ═══
const FALLBACK_NUTRITION = {
  'egg': { name: 'Egg, whole, cooked', calories: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0, sugar: 1.1, servingSize: '100g', source: 'usda-fallback' },
  'boiled egg': { name: 'Egg, whole, hard-boiled', calories: 155, protein: 12.6, carbs: 1.1, fat: 10.6, fiber: 0, sugar: 1.1, servingSize: '100g', source: 'usda-fallback' },
  'scrambled egg': { name: 'Egg, scrambled', calories: 149, protein: 10.2, carbs: 2.2, fat: 11, fiber: 0, sugar: 2, servingSize: '100g', source: 'usda-fallback' },
  'omelette': { name: 'Egg omelette', calories: 154, protein: 11, carbs: 1.6, fat: 12, fiber: 0, sugar: 1.4, servingSize: '100g', source: 'usda-fallback' },
  'rice': { name: 'Rice, white, cooked', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sugar: 0, servingSize: '100g', source: 'usda-fallback' },
  'cooked rice': { name: 'Rice, white, cooked', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sugar: 0, servingSize: '100g', source: 'usda-fallback' },
  'brown rice': { name: 'Rice, brown, cooked', calories: 123, protein: 2.7, carbs: 26, fat: 1, fiber: 1.8, sugar: 0.4, servingSize: '100g', source: 'usda-fallback' },
  'chicken': { name: 'Chicken breast, cooked', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sugar: 0, servingSize: '100g', source: 'usda-fallback' },
  'chicken breast': { name: 'Chicken breast, cooked', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sugar: 0, servingSize: '100g', source: 'usda-fallback' },
  'roti': { name: 'Roti, whole wheat', calories: 297, protein: 9.8, carbs: 50, fat: 7.5, fiber: 4, sugar: 1.3, servingSize: '100g', source: 'usda-fallback' },
  'chapati': { name: 'Chapati, whole wheat', calories: 297, protein: 9.8, carbs: 50, fat: 7.5, fiber: 4, sugar: 1.3, servingSize: '100g', source: 'usda-fallback' },
  'dal': { name: 'Dal (lentil curry)', calories: 116, protein: 7.6, carbs: 15, fat: 2.8, fiber: 5, sugar: 1.8, servingSize: '100g', source: 'usda-fallback' },
  'paneer': { name: 'Paneer (Indian cottage cheese)', calories: 321, protein: 21, carbs: 3.6, fat: 25, fiber: 0, sugar: 2, servingSize: '100g', source: 'usda-fallback' },
  'milk': { name: 'Milk, whole', calories: 61, protein: 3.2, carbs: 4.8, fat: 3.3, fiber: 0, sugar: 5, servingSize: '100g', source: 'usda-fallback' },
  'banana': { name: 'Banana, raw', calories: 89, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6, sugar: 12, servingSize: '100g', source: 'usda-fallback' },
  'apple': { name: 'Apple, raw', calories: 52, protein: 0.3, carbs: 14, fat: 0.2, fiber: 2.4, sugar: 10, servingSize: '100g', source: 'usda-fallback' },
  'bread': { name: 'Bread, white', calories: 265, protein: 9, carbs: 49, fat: 3.2, fiber: 2.7, sugar: 5, servingSize: '100g', source: 'usda-fallback' },
  'potato': { name: 'Potato, cooked', calories: 87, protein: 1.9, carbs: 20, fat: 0.1, fiber: 1.8, sugar: 0.9, servingSize: '100g', source: 'usda-fallback' },
  'oats': { name: 'Oats, dry', calories: 389, protein: 17, carbs: 66, fat: 7, fiber: 11, sugar: 1, servingSize: '100g', source: 'usda-fallback' },
  'fish': { name: 'Fish, cooked', calories: 206, protein: 22, carbs: 0, fat: 12, fiber: 0, sugar: 0, servingSize: '100g', source: 'usda-fallback' },
  'yogurt': { name: 'Yogurt, plain', calories: 61, protein: 3.5, carbs: 4.7, fat: 3.3, fiber: 0, sugar: 4.7, servingSize: '100g', source: 'usda-fallback' },
  'curd': { name: 'Curd (Dahi)', calories: 61, protein: 3.5, carbs: 4.7, fat: 3.3, fiber: 0, sugar: 4.7, servingSize: '100g', source: 'usda-fallback' },
  'idli': { name: 'Idli, steamed', calories: 77, protein: 2, carbs: 16, fat: 0.4, fiber: 0.6, sugar: 0, servingSize: '100g', source: 'usda-fallback' },
  'dosa': { name: 'Dosa', calories: 168, protein: 3.9, carbs: 25, fat: 5.8, fiber: 0.8, sugar: 1, servingSize: '100g', source: 'usda-fallback' },
  'poha': { name: 'Poha (flattened rice, cooked)', calories: 130, protein: 2.5, carbs: 27, fat: 1.5, fiber: 1.2, sugar: 0.5, servingSize: '100g', source: 'usda-fallback' },
  'upma': { name: 'Upma (semolina porridge)', calories: 135, protein: 3.5, carbs: 18, fat: 5.5, fiber: 1.5, sugar: 0.5, servingSize: '100g', source: 'usda-fallback' },
  'samosa': { name: 'Samosa, fried', calories: 262, protein: 4.2, carbs: 27, fat: 15, fiber: 2, sugar: 2, servingSize: '100g', source: 'usda-fallback' },
  'biryani': { name: 'Biryani, chicken', calories: 175, protein: 8, carbs: 22, fat: 6, fiber: 0.8, sugar: 1, servingSize: '100g', source: 'usda-fallback' },
  'paratha': { name: 'Paratha, plain', calories: 326, protein: 7.4, carbs: 45, fat: 13, fiber: 2.5, sugar: 1, servingSize: '100g', source: 'usda-fallback' },
  'naan': { name: 'Naan bread', calories: 262, protein: 8.7, carbs: 45, fat: 5.1, fiber: 2, sugar: 3.6, servingSize: '100g', source: 'usda-fallback' },
  'pasta': { name: 'Pasta, cooked', calories: 131, protein: 5, carbs: 25, fat: 1.1, fiber: 1.8, sugar: 0.6, servingSize: '100g', source: 'usda-fallback' },
  'mango': { name: 'Mango, raw', calories: 60, protein: 0.8, carbs: 15, fat: 0.4, fiber: 1.6, sugar: 14, servingSize: '100g', source: 'usda-fallback' },
  'peanut butter': { name: 'Peanut butter', calories: 588, protein: 25, carbs: 20, fat: 50, fiber: 6, sugar: 9, servingSize: '100g', source: 'usda-fallback' },
  'almonds': { name: 'Almonds, raw', calories: 579, protein: 21, carbs: 22, fat: 50, fiber: 12, sugar: 4, servingSize: '100g', source: 'usda-fallback' },
};

// ═══ FOOD VISION — Multi-food recognition proxy ═══
router.post('/recognize', auth, async (req, res) => {
  try {
    const { image_base64, mime_type, food_type, cooking_methods } = req.body;
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'image_base64 is required' });
    }

    const response = await fetch(`${AI_SERVICE_URL}/food-vision/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64,
        mime_type: mime_type || 'image/jpeg',
        food_type: food_type || 'homemade',
        cooking_methods: cooking_methods || [],
      }),
      signal: AbortSignal.timeout(50000),
    });

    const data = await response.json();
    res.status(response.ok ? 200 : 500).json(data);
  } catch (err) {
    console.error('[food/recognize] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ SMART SEARCH — Direct DB + USDA with match engine scoring ═══
router.post('/smart-search', auth, async (req, res) => {
  try {
    const { foods, cooking_methods = [] } = req.body;
    if (!Array.isArray(foods) || foods.length === 0) {
      return res.status(400).json({ message: 'foods array is required' });
    }

    console.log(`[SmartSearch] Processing ${foods.length} foods:`, foods.map(f => f.name));

    const results = [];

    for (const food of foods) {
      const searchTerms = buildSearchTerms({ ...food, cooking_methods });
      const detectedName = food.name || '';
      const category = classifyFood(detectedName);
      let allRawResults = [];

      console.log(`[SmartSearch] "${detectedName}" → category: ${category}, terms: [${searchTerms.join(', ')}]`);

      // ── STEP 1: USDA search (primary data source) ──
      for (const term of searchTerms) {
        if (!term || term.length < 2) continue;
        try {
          const isNatural = category !== 'supplement' && category !== 'packaged_food';
          const dataTypes = isNatural ? 'Foundation,SR Legacy' : '';
          const usdaResults = await searchUSDA(term, 10, dataTypes);
          if (usdaResults && usdaResults.length > 0) {
            console.log(`[SmartSearch] USDA "${term}" → ${usdaResults.length} results`);
            const mapped = usdaResults.map(u => ({
              _id: u.fdcId || `usda_${u.productName || term}`,
              name: u.productName || term,
              brand: u.brand || '',
              calories: u.calories || 0,
              protein: u.protein || 0,
              carbs: u.carbs || 0,
              fat: u.fat || 0,
              fiber: u.fiber || 0,
              sugar: u.sugar || 0,
              sodium: u.sodium || 0,
              servingSize: u.servingSize || '100g',
              servingUnit: u.servingUnit || 'g',
              source: 'usda',
              type: u.type || 'food',
              category: u.category || 'general',
              origin: u.origin || '',
            }));
            allRawResults.push(...mapped);
          }
        } catch (usdaErr) {
          console.warn(`[SmartSearch] USDA search error for "${term}":`, usdaErr.message);
        }
        // Stop if we already have enough results
        if (allRawResults.length >= 10) break;
      }

      // ── STEP 2: Fallback nutrition for common foods (guaranteed results) ──
      if (allRawResults.length === 0) {
        const lowerName = detectedName.toLowerCase().trim();
        // Try exact match, then partial match
        let fallback = FALLBACK_NUTRITION[lowerName];
        if (!fallback) {
          // Try partial: "boiled egg" → try "egg"
          for (const [key, val] of Object.entries(FALLBACK_NUTRITION)) {
            if (lowerName.includes(key) || key.includes(lowerName)) {
              fallback = val;
              break;
            }
          }
        }
        if (fallback) {
          console.log(`[SmartSearch] Using fallback nutrition for "${detectedName}"`);
          allRawResults.push({
            _id: `fallback_${lowerName}`,
            ...fallback,
            servingUnit: 'g',
            type: 'food',
            category: 'natural_food',
            origin: '',
          });
        }
      }

      console.log(`[SmartSearch] "${detectedName}" total raw results: ${allRawResults.length}`);

      // ── STEP 3: Deduplicate by name+calories ──
      const seen = new Set();
      allRawResults = allRawResults.filter(r => {
        const key = `${(r.name || '').toLowerCase().trim()}_${r.calories || 0}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // ── STEP 4: Match engine scoring + filtering ──
      const ranked = rankAndFilterResults(detectedName, allRawResults, {
        category,
        cookingState: food.state || '',
      });

      // Add macro validation to top matches
      const validatedMatches = ranked.slice(0, 5).map(r => {
        const macroCheck = validateMacros(detectedName, r);
        return { ...r, _macroValid: macroCheck.valid, _macroIssues: macroCheck.issues };
      });

      const bestMatch = validatedMatches.length > 0 ? validatedMatches[0] : null;

      console.log(`[SmartSearch] "${detectedName}" → ${validatedMatches.length} matches after scoring, best: "${bestMatch?.name || 'none'}" (score: ${bestMatch?._matchScore || 0})`);

      results.push({
        detected: food,
        category,
        searchTerms,
        matches: validatedMatches,
        bestMatch,
      });
    }

    res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('[food/smart-search] error:', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ NUTRITION VALIDATION ═══
router.post('/validate-nutrition', auth, (req, res) => {
  const { food } = req.body;
  if (!food) return res.status(400).json({ message: 'food object required' });
  const result = validateNutrition(food);
  res.json(result);
});

// ═══ SCALE NUTRITION ═══
router.post('/scale-nutrition', auth, (req, res) => {
  const { food, quantity, unit } = req.body;
  if (!food) return res.status(400).json({ message: 'food object required' });
  const scaled = scaleNutrition(food, quantity || 1, unit || 'serving');
  res.json(scaled);
});

// ═══ FOOD MEMORY — Frequent/recent foods ═══
router.get('/memory/frequent', auth, async (req, res) => {
  try {
    const memories = await FoodMemory.find({ userId: req.userId })
      .sort({ logCount: -1 })
      .limit(20)
      .lean();
    res.json(memories);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/memory/recent', auth, async (req, res) => {
  try {
    const memories = await FoodMemory.find({ userId: req.userId })
      .sort({ lastLoggedAt: -1 })
      .limit(15)
      .lean();
    res.json(memories);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Track food in memory (called when user logs food)
router.post('/memory/track', auth, async (req, res) => {
  try {
    const { foodName, foodId, quantity, unit, mealType, calories, protein, carbs, fat, source, aiDetectedName, userCorrectedName } = req.body;
    if (!foodName) return res.status(400).json({ message: 'foodName required' });

    const normalized = normalizeFoodName(foodName);
    const update = {
      $inc: { logCount: 1 },
      $set: {
        lastLoggedAt: new Date(),
        normalizedName: normalized,
        typicalQuantity: quantity || 1,
        typicalUnit: unit || 'serving',
        typicalMealType: mealType || 'lunch',
        calories, protein, carbs, fat,
        source: source || 'scan',
      },
    };

    if (foodId) update.$set.foodId = foodId;
    if (aiDetectedName) update.$set.aiDetectedName = aiDetectedName;
    if (userCorrectedName) {
      update.$set.userCorrectedName = userCorrectedName;
      update.$inc.correctionCount = 1;
    }

    await FoodMemory.findOneAndUpdate(
      { userId: req.userId, foodName: foodName.toLowerCase().trim() },
      update,
      { upsert: true, new: true }
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ═══ EXISTING ROUTES ═══
router.post('/add-food', auth, addBrandFood);
router.get('/brand-foods', auth, getBrandFoods);
router.get('/search', auth, searchFoods);
router.get('/search-name', auth, searchFoodsByName);
router.get('/barcode/:barcode', auth, getFoodByBarcode);
router.get('/:id', auth, getFoodById);

// Food logging
router.post('/log', auth, addFoodToLog);
router.get('/log/today', auth, getTodaysFoodLog);
router.delete('/log/:logId', auth, removeFoodFromLog);

export default router;
