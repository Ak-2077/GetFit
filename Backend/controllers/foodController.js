import Food from '../models/food.js';
import FoodLog from '../models/foodLog.js';

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

// Get food by barcode
export const getFoodByBarcode = async (req, res) => {
  try {
    const rawBarcode = req.params.barcode;
    const normalizedBarcode = normalizeBarcode(rawBarcode);

    if (!normalizedBarcode) {
      return res.status(400).json({ message: 'Invalid barcode' });
    }

    const noLeadingZeroBarcode = normalizedBarcode.replace(/^0+/, '') || normalizedBarcode;
    const leadingZeroTolerantPattern = new RegExp(`^0*${escapeRegex(noLeadingZeroBarcode)}$`);

    const food = await Food.findOne({ barcode: { $regex: leadingZeroTolerantPattern } });
    if (!food) {
      return res.status(404).json({ message: 'Food not found' });
    }

    res.status(200).json(toFoodResponse(food));
  } catch (err) {
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

// Search foods by name or barcode
export const searchFoods = async (req, res) => {
  try {
    const queryFromQ = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
    const queryFromQuery = typeof req.query?.query === 'string' ? req.query.query.trim() : '';
    const rawQuery = queryFromQ || queryFromQuery;
    const query = rawQuery;
    const userId = req.userId;
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? clamp(Math.round(limitRaw), 1, 30) : 15;

    if (!query || query.length < 2) {
      return res.status(400).json({ message: 'Query must be at least 2 characters' });
    }

    // Barcode scans should be global and tolerant to leading-zero variations.
    const normalizedBarcodeQuery = normalizeBarcode(query);
    if (normalizedBarcodeQuery.length >= 8) {
      const noLeadingZeroBarcode = normalizedBarcodeQuery.replace(/^0+/, '') || normalizedBarcodeQuery;
      const leadingZeroTolerantPattern = new RegExp(`^0*${escapeRegex(noLeadingZeroBarcode)}$`);
      const barcodeMatch = await Food.findOne({ barcode: { $regex: leadingZeroTolerantPattern } });
      if (barcodeMatch) {
        return res.status(200).json([toFoodResponse(barcodeMatch)]);
      }
    }

    // First, search in our database
    const visibilityFilter = {
      $or: [{ source: { $in: ['openfoodfacts', 'custom'] } }, { userId }],
    };

    let foods = [];

    try {
      foods = await Food.find({
        $and: [{ $text: { $search: query } }, visibilityFilter],
      })
        .select('name brand category type calories protein carbs fat fiber sugar servingSize servingUnit unit barcode source origin')
        .sort({ score: { $meta: 'textScore' }, updatedAt: -1 })
        .limit(limit)
        .lean();
    } catch (textSearchError) {
      foods = [];
    }

    if (foods.length === 0) {
      foods = await Food.find({
        $and: [
          {
            $or: [
              { searchKeywords: { $in: [query.toLowerCase()] } },
              { name: { $regex: query, $options: 'i' } },
              { barcode: { $regex: query, $options: 'i' } },
              { brand: { $regex: query, $options: 'i' } },
            ],
          },
          visibilityFilter,
        ],
      })
        .select('name brand category type calories protein carbs fat fiber sugar servingSize servingUnit unit barcode source origin')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
    }

    // If no results and query looks like a barcode, try OpenFoodFacts API
    if (foods.length === 0 && /^\d{8,14}$/.test(normalizedBarcodeQuery)) {
      try {
        const endpoints = [
          'https://world.openfoodfacts.org',
          'https://us.openfoodfacts.org',
          'https://in.openfoodfacts.org',
          'https://uk.openfoodfacts.org',
          'https://jp.openfoodfacts.org',
          'https://cn.openfoodfacts.org',
        ];

        for (const baseUrl of endpoints) {
          const response = await fetch(`${baseUrl}/api/v0/product/${normalizedBarcodeQuery}.json`);
          if (!response.ok) continue;

          const data = await response.json();
          if (!data.product) continue;

          const product = data.product;
          const servingSize = product.serving_size || '100g';
          const unit = inferServingUnit({
            servingSize,
            name: product.product_name,
          });
          const productName = product.product_name || 'Unknown Product';
          const productBrand = product.brands || 'Unknown Brand';
          const category = product.categories_tags?.[0]
            ? String(product.categories_tags[0]).replace(/^\w+:/, '').replace(/-/g, ' ')
            : 'general';
          const type = /(whey|protein|mass gainer|creatine|bcaa|multivitamin|supplement)/i.test(`${productName} ${productBrand}`)
            ? 'supplement'
            : 'food';

          const newFood = new Food({
            name: productName,
            brand: productBrand,
            category,
            type,
            barcode: normalizedBarcodeQuery,
            origin: resolveOrigin({ product, barcode: normalizedBarcodeQuery }),
            calories: product.nutriments?.['energy-kcal'] || 0,
            protein: product.nutriments?.proteins || 0,
            carbs: product.nutriments?.carbohydrates || 0,
            fat: product.nutriments?.fat || 0,
            fiber: product.nutriments?.fiber || 0,
            sugar: product.nutriments?.sugars || 0,
            servingSize,
            servingUnit: unit,
            unit,
            searchKeywords: extractSearchKeywords({ name: productName, brand: productBrand, category, type }),
            source: 'openfoodfacts',
          });

          await newFood.save();
          foods = [newFood];
          break;
        }
      } catch (apiError) {
        console.warn('OpenFoodFacts API error:', apiError.message);
      }
    }

    res.status(200).json(foods.map(toFoodResponse));
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
