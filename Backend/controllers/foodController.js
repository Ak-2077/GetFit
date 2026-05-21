import Food from '../models/food.js';
import FoodLog from '../models/foodLog.js';
import FoodCache from '../models/foodCache.js';
import { lookupOpenFoodFacts, lookupUSDA, searchUSDA } from '../services/foodApiService.js';
import { rankAndFilterResults, classifyFood } from '../services/foodMatchEngine.js';

const LIQUID_KEYWORDS = /(drink|juice|soda|cola|water|beverage|milk|coffee|tea|energy|shake|smoothie)/i;

const normalizeBarcode = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/\s+/g, '').replace(/[^\d]/g, '');
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeMealType = (mealType) => {
  const normalized = String(mealType || '').trim().toLowerCase();
  if (normalized === 'breakfast' || normalized === 'lunch' || normalized === 'dinner') return normalized;
  if (normalized === 'snacks') return 'snack';
  return 'snack';
};

const extractSearchKeywords = ({ name, brand, category, type }) => {
  const raw = `${name || ''} ${brand || ''} ${category || ''} ${type || ''}`.toLowerCase();
  return Array.from(new Set(raw.split(/[^a-z0-9]+/).filter((token) => token.length >= 2))).slice(0, 50);
};

const GS1_ORIGIN_RANGES = [
  { min: 0, max: 139, origin: 'USA/Canada' },
  { min: 450, max: 459, origin: 'Japan' },
  { min: 490, max: 499, origin: 'Japan' },
  { min: 690, max: 699, origin: 'China' },
  { min: 890, max: 890, origin: 'India' },
];

const toTitleCase = (value) =>
  value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const originFromOpenFoodFacts = (product) => {
  if (!product) return '';

  if (typeof product.countries === 'string' && product.countries.trim()) {
    return product.countries
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)[0] || '';
  }

  const firstTag = Array.isArray(product.countries_tags) ? product.countries_tags[0] : '';
  if (typeof firstTag === 'string' && firstTag.trim()) {
    const cleaned = firstTag.replace(/^\w+:/, '').replace(/-/g, ' ').trim();
    return cleaned ? toTitleCase(cleaned) : '';
  }

  return '';
};

const originFromGs1Prefix = (barcode) => {
  const normalized = normalizeBarcode(barcode);
  if (normalized.length < 3) return '';

  const prefix = Number(normalized.slice(0, 3));
  if (!Number.isFinite(prefix)) return '';

  const matched = GS1_ORIGIN_RANGES.find((range) => prefix >= range.min && prefix <= range.max);
  return matched ? `${matched.origin} (GS1 prefix)` : '';
};

const resolveOrigin = ({ existingOrigin, product, barcode }) => {
  const fromExisting = typeof existingOrigin === 'string' ? existingOrigin.trim() : '';
  if (fromExisting) return fromExisting;

  const fromApi = originFromOpenFoodFacts(product);
  if (fromApi) return fromApi;

  return originFromGs1Prefix(barcode);
};

const toFoodResponse = (food) => {
  if (!food) return food;
  const plain = typeof food.toObject === 'function' ? food.toObject() : food;
  return {
    ...plain,
    servingUnit: plain.servingUnit || plain.unit || 'g',
    origin: resolveOrigin({ existingOrigin: plain.origin, barcode: plain.barcode }),
  };
};

const inferServingUnit = ({ explicitUnit, servingText, servingSize, name, fallbackUnit }) => {
  const normalizedExplicit = typeof explicitUnit === 'string' ? explicitUnit.trim().toLowerCase() : '';
  if (normalizedExplicit === 'ml' || normalizedExplicit === 'g') {
    return normalizedExplicit;
  }

  const textSignals = [servingText, servingSize]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ');

  if (/(\bml\b|milliliter|millilitre|\bl\b|liter|litre|fl\s?oz|ounce)/i.test(textSignals)) {
    return 'ml';
  }

  if (/(\bg\b|gram|grams|kg|kilogram|kilograms)/i.test(textSignals)) {
    return 'g';
  }

  if (typeof fallbackUnit === 'string') {
    const normalizedFallback = fallbackUnit.trim().toLowerCase();
    if (normalizedFallback === 'ml' || normalizedFallback === 'g') {
      return normalizedFallback;
    }
  }

  if (typeof name === 'string' && LIQUID_KEYWORDS.test(name)) {
    return 'ml';
  }

  return 'g';
};

// Add brand food item (user adds custom food)
export const addBrandFood = async (req, res) => {
  try {
    const {
      name,
      brand,
      calories,
      protein,
      carbs,
      fat,
      fiber,
      sugar,
      servingSize,
      servingUnit,
      barcode,
      origin,
      category,
      type,
    } = req.body;
    const userId = req.userId;
    const normalizedBarcode = normalizeBarcode(barcode);

    if (!name || calories === undefined || calories === null) {
      return res.status(400).json({ message: 'Name and calories are required' });
    }

    const unit = inferServingUnit({
      explicitUnit: servingUnit,
      servingSize,
      name,
    });

    const safeName = String(name).trim();
    const safeBrand = String(brand || '').trim();
    const safeCategory = String(category || 'general').trim().toLowerCase();
    const safeType = String(type || '').trim().toLowerCase() === 'supplement' ? 'supplement' : 'food';

    const food = new Food({
      name: safeName,
      brand: safeBrand,
      category: safeCategory,
      type: safeType,
      calories: clamp(toSafeNumber(calories, 0), 0, 5000),
      protein: clamp(toSafeNumber(protein, 0), 0, 1000),
      carbs: clamp(toSafeNumber(carbs, 0), 0, 1000),
      fat: clamp(toSafeNumber(fat, 0), 0, 1000),
      fiber: clamp(toSafeNumber(fiber, 0), 0, 1000),
      sugar: clamp(toSafeNumber(sugar, 0), 0, 1000),
      servingSize: String(servingSize || '').trim(),
      servingUnit: unit,
      unit,
      barcode: normalizedBarcode || undefined,
      origin: resolveOrigin({ existingOrigin: origin, barcode: normalizedBarcode }),
      searchKeywords: extractSearchKeywords({ name: safeName, brand: safeBrand, category: safeCategory, type: safeType }),
      source: 'user',
      userId,
    });

    await food.save();
    res.status(201).json({ message: 'Food item added successfully', food: toFoodResponse(food) });
  } catch (err) {
    res.status(500).json({ message: 'Error adding food', error: err.message });
  }
};

// Get all brand foods (public + user's custom foods)
export const getBrandFoods = async (req, res) => {
  try {
    const userId = req.userId;
    const foods = await Food.find({
      $or: [{ source: { $in: ['openfoodfacts', 'custom'] } }, { userId }],
    })
      .select('name brand category type calories protein carbs fat fiber sugar servingSize servingUnit unit barcode source origin')
      .limit(100)
      .lean();
    
    res.status(200).json(foods.map(toFoodResponse));
  } catch (err) {
    res.status(500).json({ message: 'Error fetching foods', error: err.message });
  }
};

// Convert normalized API/cache data into a saved Food document for logging
const persistToFoodCollection = async (normalized) => {
  if (!normalized || !normalized.barcode) return null;

  const noLead = normalized.barcode.replace(/^0+/, '') || normalized.barcode;
  const pattern = new RegExp(`^0*${escapeRegex(noLead)}$`);
  const existing = await Food.findOne({ barcode: { $regex: pattern } });
  if (existing) return existing;

  const unit = inferServingUnit({ servingSize: normalized.servingSize, name: normalized.productName });
  const food = new Food({
    name: normalized.productName,
    brand: normalized.brand,
    category: normalized.category || 'general',
    type: normalized.type || 'food',
    barcode: normalized.barcode,
    origin: normalized.origin || '',
    calories: normalized.calories || 0,
    protein: normalized.protein || 0,
    carbs: normalized.carbs || 0,
    fat: normalized.fat || 0,
    fiber: normalized.fiber || 0,
    sugar: normalized.sugar || 0,
    servingSize: normalized.servingSize || '100g',
    servingUnit: unit,
    unit,
    searchKeywords: extractSearchKeywords({
      name: normalized.productName,
      brand: normalized.brand,
      category: normalized.category,
      type: normalized.type,
    }),
    source: normalized.source === 'usda' ? 'custom' : 'openfoodfacts',
  });

  await food.save();
  return food;
};

// Upsert normalized data into FoodCache and return the cached doc
const upsertCache = async (normalized) => {
  if (!normalized || !normalized.barcode) return null;

  const cached = await FoodCache.findOneAndUpdate(
    { barcode: normalized.barcode },
    {
      $set: {
        productName: normalized.productName,
        brand: normalized.brand,
        calories: normalized.calories,
        protein: normalized.protein,
        carbs: normalized.carbs,
        fat: normalized.fat,
        fiber: normalized.fiber,
        sugar: normalized.sugar,
        sodium: normalized.sodium || 0,
        servingSize: normalized.servingSize,
        servingUnit: normalized.servingUnit,
        ingredients: normalized.ingredients || '',
        image: normalized.image || '',
        origin: normalized.origin || '',
        category: normalized.category || 'general',
        type: normalized.type || 'food',
        source: normalized.source,
        lastSearchedAt: new Date(),
      },
      $inc: { searchCount: 1 },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return cached;
};

// Convert a FoodCache doc to the response shape the frontend expects
const cacheToResponse = (cached, foodDoc) => {
  if (!cached) return null;
  const plain = typeof cached.toObject === 'function' ? cached.toObject() : cached;
  return {
    _id: foodDoc?._id || plain._id,
    name: plain.productName,
    brand: plain.brand,
    category: plain.category,
    type: plain.type,
    calories: plain.calories,
    protein: plain.protein,
    carbs: plain.carbs,
    fat: plain.fat,
    fiber: plain.fiber,
    sugar: plain.sugar,
    sodium: plain.sodium,
    servingSize: plain.servingSize,
    servingUnit: plain.servingUnit,
    unit: plain.servingUnit,
    barcode: plain.barcode,
    origin: plain.origin,
    ingredients: plain.ingredients,
    image: plain.image,
    source: plain.source,
  };
};

// Get food by barcode — cache-first with Open Food Facts + USDA fallback
export const getFoodByBarcode = async (req, res) => {
  try {
    const rawBarcode = req.params.barcode;
    const normalizedBarcode = normalizeBarcode(rawBarcode);

    if (!normalizedBarcode || normalizedBarcode.length < 8) {
      return res.status(400).json({ message: 'Invalid barcode (must be 8-14 digits)' });
    }

    // ── 1. Check FoodCache ──
    const cached = await FoodCache.findOneAndUpdate(
      { barcode: normalizedBarcode },
      { $inc: { searchCount: 1 }, $set: { lastSearchedAt: new Date() } },
      { returnDocument: 'after' }
    );

    let needsRefresh = false;

    if (cached) {
      // Auto-fix stale cache: OFF values are per 100g, servingSize must be '100g'
      needsRefresh = cached.source === 'openfoodfacts' && cached.servingSize !== '100g';
      if (!needsRefresh) {
        const foodDoc = await persistToFoodCollection(cached.toObject ? cached.toObject() : cached);
        return res.status(200).json({ food: cacheToResponse(cached, foodDoc), source: 'cache' });
      }
      // Stale entry — skip cache, go to API refresh
    }

    // ── 2. Check Food collection (skip if stale refresh needed) ──
    const noLeadingZeroBarcode = normalizedBarcode.replace(/^0+/, '') || normalizedBarcode;
    const leadingZeroTolerantPattern = new RegExp(`^0*${escapeRegex(noLeadingZeroBarcode)}$`);

    if (!needsRefresh) {
      const existingFood = await Food.findOne({ barcode: { $regex: leadingZeroTolerantPattern } });

      if (existingFood) {
        // Backfill cache
        const normalized = {
          barcode: normalizedBarcode,
          productName: existingFood.name,
          brand: existingFood.brand || '',
          calories: existingFood.calories || 0,
          protein: existingFood.protein || 0,
          carbs: existingFood.carbs || 0,
          fat: existingFood.fat || 0,
          fiber: existingFood.fiber || 0,
          sugar: existingFood.sugar || 0,
          sodium: 0,
          servingSize: existingFood.servingSize || '100g',
          servingUnit: existingFood.servingUnit || existingFood.unit || 'g',
          ingredients: '',
          image: '',
          origin: existingFood.origin || '',
          category: existingFood.category || 'general',
          type: existingFood.type || 'food',
          source: existingFood.source || 'openfoodfacts',
        };
        await upsertCache(normalized);
        return res.status(200).json({ food: toFoodResponse(existingFood), source: 'database' });
      }
    }

    // ── 3. Open Food Facts API ──
    let apiResult = await lookupOpenFoodFacts(normalizedBarcode);

    // ── 4. USDA fallback ──
    if (!apiResult) {
      apiResult = await lookupUSDA(normalizedBarcode);
    }

    if (!apiResult) {
      return res.status(404).json({ message: 'Product not found in any food database' });
    }

    // ── 5. Cache + persist + fix stale Food doc ──
    await upsertCache(apiResult);

    // Update existing Food doc if it has stale servingSize, otherwise create new
    const existingFoodDoc = await Food.findOne({ barcode: { $regex: leadingZeroTolerantPattern } });
    let foodDoc;
    if (existingFoodDoc) {
      existingFoodDoc.servingSize = apiResult.servingSize || '100g';
      existingFoodDoc.servingUnit = inferServingUnit({ servingSize: apiResult.servingSize, name: apiResult.productName });
      existingFoodDoc.unit = existingFoodDoc.servingUnit;
      existingFoodDoc.calories = apiResult.calories || 0;
      existingFoodDoc.protein = apiResult.protein || 0;
      existingFoodDoc.carbs = apiResult.carbs || 0;
      existingFoodDoc.fat = apiResult.fat || 0;
      existingFoodDoc.fiber = apiResult.fiber || 0;
      existingFoodDoc.sugar = apiResult.sugar || 0;
      await existingFoodDoc.save();
      foodDoc = existingFoodDoc;
    } else {
      foodDoc = await persistToFoodCollection(apiResult);
    }

    const freshCache = await FoodCache.findOne({ barcode: normalizedBarcode });
    return res.status(200).json({ food: cacheToResponse(freshCache, foodDoc), source: apiResult.source });
  } catch (err) {
    console.error('[getFoodByBarcode] error:', err);
    res.status(500).json({ message: 'Error fetching food', error: err.message });
  }
};

// Add food to log (record what user ate)
export const addFoodToLog = async (req, res) => {
  try {
    const { foodId, quantity, servings, meal, mealType, servingText, servingUnit, date } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const food = await Food.findById(foodId);
    if (!food) {
      return res.status(404).json({ message: 'Food not found' });
    }

    const quantityValue = Number.isFinite(Number(servings)) ? Number(servings) : Number(quantity);
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      return res.status(400).json({ message: 'Quantity must be a valid number greater than 0' });
    }

    const safeServingText = typeof servingText === 'string' ? servingText.trim() : '';
    const safeServingUnit = inferServingUnit({
      explicitUnit: servingUnit,
      servingText: safeServingText,
      servingSize: food.servingSize,
      name: food.name,
      fallbackUnit: food.servingUnit || food.unit,
    });

    const normalizedMealType = normalizeMealType(mealType || meal);
    const logDate = date ? new Date(date) : new Date();
    logDate.setHours(0, 0, 0, 0);

    const caloriesValue = clamp(toSafeNumber(food.calories, 0) * quantityValue, 0, 50000);
    const proteinValue = clamp(toSafeNumber(food.protein, 0) * quantityValue, 0, 10000);
    const carbsValue = clamp(toSafeNumber(food.carbs, 0) * quantityValue, 0, 10000);
    const fatValue = clamp(toSafeNumber(food.fat, 0) * quantityValue, 0, 10000);

    const foodLog = new FoodLog({
      userId,
      foodId,
      quantity: quantityValue,
      servings: quantityValue,
      meal: normalizedMealType,
      mealType: normalizedMealType,
      servingText: safeServingText,
      servingUnit: safeServingUnit,
      caloriesConsumed: caloriesValue,
      calories: caloriesValue,
      protein: proteinValue,
      carbs: carbsValue,
      fat: fatValue,
      date: logDate,
    });

    await foodLog.save();
    res.status(201).json({ message: 'Food added to log', foodLog });
  } catch (err) {
    res.status(500).json({ message: 'Error adding food to log', error: err.message });
  }
};

// Get today's food log
export const getTodaysFoodLog = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const logs = await FoodLog.find({ userId, date: { $gte: today } })
      .populate('foodId')
      .sort({ createdAt: -1 });

    const totalCalories = logs.reduce((sum, log) => sum + (log.caloriesConsumed || 0), 0);
    const totals = logs.reduce(
      (acc, log) => {
        acc.protein += toSafeNumber(log.protein, 0);
        acc.carbs += toSafeNumber(log.carbs, 0);
        acc.fat += toSafeNumber(log.fat, 0);
        return acc;
      },
      { protein: 0, carbs: 0, fat: 0 }
    );

    const mealBuckets = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snacks: [],
    };

    for (const log of logs) {
      const normalizedMeal = normalizeMealType(log.mealType || log.meal);
      const key = normalizedMeal === 'snack' ? 'snacks' : normalizedMeal;
      mealBuckets[key].push(log);
    }

    res.status(200).json({
      logs,
      totalCalories,
      totalProtein: Number(totals.protein.toFixed(1)),
      totalCarbs: Number(totals.carbs.toFixed(1)),
      totalFat: Number(totals.fat.toFixed(1)),
      meals: mealBuckets,
      count: logs.length,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching food log', error: err.message });
  }
};

// Delete food from log
export const removeFoodFromLog = async (req, res) => {
  try {
    const { logId } = req.params;
    const userId = req.userId;

    const log = await FoodLog.findById(logId);
    if (!log) {
      return res.status(404).json({ message: 'Food log entry not found' });
    }

    if (log.userId.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await FoodLog.findByIdAndDelete(logId);
    res.status(200).json({ message: 'Food removed from log' });
  } catch (err) {
    res.status(500).json({ message: 'Error removing food', error: err.message });
  }
};

// Search foods by name or barcode — USDA is primary data source
export const searchFoods = async (req, res) => {
  try {
    const queryFromQ = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
    const queryFromQuery = typeof req.query?.query === 'string' ? req.query.query.trim() : '';
    const query = queryFromQ || queryFromQuery;
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? clamp(Math.round(limitRaw), 1, 30) : 15;

    if (!query || query.length < 2) {
      return res.status(400).json({ message: 'Query must be at least 2 characters' });
    }

    // Barcode lookup via APIs
    const normalizedBarcodeQuery = normalizeBarcode(query);
    if (/^\d{8,14}$/.test(normalizedBarcodeQuery)) {
      try {
        let apiResult = await lookupOpenFoodFacts(normalizedBarcodeQuery);
        if (!apiResult) apiResult = await lookupUSDA(normalizedBarcodeQuery);
        if (apiResult) {
          return res.status(200).json([{
            _id: apiResult.barcode || `usda_${Date.now()}`,
            name: apiResult.name || query,
            brand: apiResult.brand || '',
            calories: apiResult.calories || 0,
            protein: apiResult.protein || 0,
            carbs: apiResult.carbs || 0,
            fat: apiResult.fat || 0,
            fiber: apiResult.fiber || 0,
            sugar: apiResult.sugar || 0,
            sodium: apiResult.sodium || 0,
            servingSize: apiResult.servingSize || '100g',
            source: apiResult.source || 'usda',
            barcode: apiResult.barcode || '',
          }]);
        }
      } catch (apiError) {
        console.warn('[SearchFoods] Barcode API error:', apiError.message);
      }
    }

    // USDA text search (primary source)
    let foods = [];
    try {
      const category = classifyFood(query);
      const isNatural = category !== 'supplement' && category !== 'packaged_food';
      const dataTypes = isNatural ? 'Foundation,SR Legacy' : '';
      const usdaResults = await searchUSDA(query, limit, dataTypes);
      if (usdaResults && usdaResults.length > 0) {
        foods = usdaResults.map(u => ({
          _id: u.fdcId || `usda_${u.productName || query}_${Date.now()}`,
          name: u.productName || query,
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
      }
    } catch (usdaErr) {
      console.warn('[SearchFoods] USDA search error:', usdaErr.message);
    }

    // If USDA returns nothing, try broader search (no dataType filter)
    if (foods.length === 0) {
      try {
        const usdaResults = await searchUSDA(query, limit, '');
        if (usdaResults && usdaResults.length > 0) {
          foods = usdaResults.map(u => ({
            _id: u.fdcId || `usda_${u.productName || query}_${Date.now()}`,
            name: u.productName || query,
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
        }
      } catch (e) {
        console.warn('[SearchFoods] USDA broad search error:', e.message);
      }
    }

    res.status(200).json(foods);
  } catch (err) {
    res.status(500).json({ message: 'Error searching foods', error: err.message });
  }
};

export const getFoodById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const food = await Food.findOne({
      _id: id,
      $or: [{ source: { $in: ['openfoodfacts', 'custom'] } }, { userId }],
    }).lean();

    if (!food) {
      return res.status(404).json({ message: 'Food not found' });
    }

    return res.status(200).json(toFoodResponse(food));
  } catch (err) {
    return res.status(500).json({ message: 'Error fetching food details', error: err.message });
  }
};

// Manual food search by name — USDA is primary data source
export const searchFoodsByName = async (req, res) => {
  try {
    const rawQuery = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? clamp(Math.round(limitRaw), 1, 30) : 15;

    if (!rawQuery || rawQuery.length < 2) {
      return res.status(400).json({ message: 'Query must be at least 2 characters' });
    }

    // USDA search (primary source)
    let foods = [];
    try {
      const detectedCategory = classifyFood(rawQuery);
      const isNatural = detectedCategory !== 'supplement' && detectedCategory !== 'packaged_food';
      const usdaDataTypes = isNatural ? 'Foundation,SR Legacy' : '';
      const usdaResults = await searchUSDA(rawQuery, limit, usdaDataTypes);
      if (usdaResults && usdaResults.length > 0) {
        foods = usdaResults.map(u => ({
          _id: u.fdcId || `usda_${u.productName || rawQuery}_${Date.now()}`,
          name: u.productName || rawQuery,
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
      }
    } catch (usdaErr) {
      console.warn('[SearchFoodsByName] USDA search error:', usdaErr.message);
    }

    // Broader USDA search if Foundation/SR Legacy returned nothing
    if (foods.length === 0) {
      try {
        const usdaResults = await searchUSDA(rawQuery, limit, '');
        if (usdaResults && usdaResults.length > 0) {
          foods = usdaResults.map(u => ({
            _id: u.fdcId || `usda_${u.productName || rawQuery}_${Date.now()}`,
            name: u.productName || rawQuery,
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
        }
      } catch (e) {
        console.warn('[SearchFoodsByName] USDA broad search error:', e.message);
      }
    }

    res.status(200).json(foods.slice(0, limit));
  } catch (err) {
    res.status(500).json({ message: 'Error searching foods by name', error: err.message });
  }
};
