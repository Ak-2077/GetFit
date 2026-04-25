import Food from '../models/food.js';
import FoodLog from '../models/foodLog.js';

const LIQUID_KEYWORDS = /(drink|juice|soda|cola|water|beverage|milk|coffee|tea|energy|shake|smoothie)/i;

const normalizeBarcode = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/\s+/g, '').replace(/[^\d]/g, '');
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    const { name, brand, calories, protein, carbs, fat, servingSize, barcode, origin } = req.body;
    const userId = req.userId;
    const normalizedBarcode = normalizeBarcode(barcode);

    if (!name || !calories) {
      return res.status(400).json({ message: 'Name and calories are required' });
    }

    const unit = inferServingUnit({
      servingSize,
      name,
    });

    const food = new Food({
      name,
      brand,
      calories,
      protein,
      carbs,
      fat,
      servingSize,
      unit,
      barcode: normalizedBarcode || undefined,
      origin: resolveOrigin({ existingOrigin: origin, barcode: normalizedBarcode }),
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
      $or: [{ source: 'openfoodfacts' }, { userId }],
    }).select('name brand calories protein carbs fat servingSize barcode source origin');
    
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
    const { foodId, quantity, meal, servingText, servingUnit } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const food = await Food.findById(foodId);
    if (!food) {
      return res.status(404).json({ message: 'Food not found' });
    }

    const quantityValue = Number(quantity);
    if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
      return res.status(400).json({ message: 'Quantity must be a valid number greater than 0' });
    }

    const safeServingText = typeof servingText === 'string' ? servingText.trim() : '';
    const safeServingUnit = inferServingUnit({
      explicitUnit: servingUnit,
      servingText: safeServingText,
      servingSize: food.servingSize,
      name: food.name,
      fallbackUnit: food.unit,
    });

    const foodLog = new FoodLog({
      userId,
      foodId,
      quantity: quantityValue,
      meal,
      servingText: safeServingText,
      servingUnit: safeServingUnit,
      caloriesConsumed: food.calories * quantityValue,
      date: new Date().setHours(0, 0, 0, 0),
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

    res.status(200).json({
      logs,
      totalCalories,
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
    const userId = req.user?.id;

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
    const rawQuery = typeof req.query?.query === 'string' ? req.query.query.trim() : '';
    const query = rawQuery;
    const userId = req.userId;

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
    let foods = await Food.find({
      $and: [
        {
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { barcode: { $regex: query, $options: 'i' } },
            { brand: { $regex: query, $options: 'i' } },
          ],
        },
        {
          $or: [{ source: 'openfoodfacts' }, { userId }],
        },
      ],
    }).limit(20);

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
          const newFood = new Food({
            name: product.product_name || 'Unknown Product',
            brand: product.brands || 'Unknown Brand',
            barcode: normalizedBarcodeQuery,
            origin: resolveOrigin({ product, barcode: normalizedBarcodeQuery }),
            calories: product.nutriments?.['energy-kcal'] || 0,
            protein: product.nutriments?.proteins || 0,
            carbs: product.nutriments?.carbohydrates || 0,
            fat: product.nutriments?.fat || 0,
            servingSize,
            unit,
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
