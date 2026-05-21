/**
 * Food API Service
 * Primary: Open Food Facts (no API key required)
 * Fallback: USDA FoodData Central (API key required)
 *
 * All responses are normalized into a consistent structure.
 */

const OPEN_FOOD_FACTS_ENDPOINTS = [
  'https://world.openfoodfacts.org',
  'https://us.openfoodfacts.org',
  'https://in.openfoodfacts.org',
  'https://uk.openfoodfacts.org',
  'https://jp.openfoodfacts.org',
  'https://cn.openfoodfacts.org',
];

const USDA_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';
const REQUEST_TIMEOUT_MS = 8000;

const SUPPLEMENT_PATTERN = /(whey|protein powder|mass gainer|creatine|bcaa|multivitamin|supplement|amino acid|pre[\s-]?workout|glutamine|casein|vitamin|mineral tablet)/i;
const LIQUID_KEYWORDS = /(drink|juice|soda|cola|water|beverage|milk|coffee|tea|energy|shake|smoothie|beer|wine|spirit)/i;

// ─── Helpers ────────────────────────────────────────────────────

const toSafe = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const inferUnit = (servingSize, name) => {
  const s = `${servingSize || ''}`.toLowerCase();
  if (/(ml|milliliter|millilitre|\bl\b|liter|litre|fl\s?oz)/.test(s)) return 'ml';
  if (/(g|gram|kg|kilogram)/.test(s)) return 'g';
  if (typeof name === 'string' && LIQUID_KEYWORDS.test(name)) return 'ml';
  return 'g';
};

const toTitleCase = (v) =>
  v
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

const GS1_ORIGIN_RANGES = [
  { min: 0, max: 139, origin: 'USA/Canada' },
  { min: 300, max: 379, origin: 'France' },
  { min: 400, max: 440, origin: 'Germany' },
  { min: 450, max: 459, origin: 'Japan' },
  { min: 490, max: 499, origin: 'Japan' },
  { min: 500, max: 509, origin: 'UK' },
  { min: 690, max: 699, origin: 'China' },
  { min: 880, max: 880, origin: 'South Korea' },
  { min: 885, max: 885, origin: 'Thailand' },
  { min: 890, max: 890, origin: 'India' },
];

const originFromGs1 = (barcode) => {
  const norm = `${barcode || ''}`.replace(/\D/g, '');
  if (norm.length < 3) return '';
  const prefix = Number(norm.slice(0, 3));
  if (!Number.isFinite(prefix)) return '';
  const match = GS1_ORIGIN_RANGES.find((r) => prefix >= r.min && prefix <= r.max);
  return match ? match.origin : '';
};

const originFromOFF = (product) => {
  if (!product) return '';
  if (typeof product.countries === 'string' && product.countries.trim()) {
    return product.countries.split(',').map((i) => i.trim()).filter(Boolean)[0] || '';
  }
  const tag = Array.isArray(product.countries_tags) ? product.countries_tags[0] : '';
  if (typeof tag === 'string' && tag.trim()) {
    return toTitleCase(tag.replace(/^\w+:/, '').replace(/-/g, ' ').trim());
  }
  return '';
};

const resolveOrigin = (product, barcode) => {
  const fromApi = originFromOFF(product);
  if (fromApi) return fromApi;
  return originFromGs1(barcode);
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
};

// ─── Open Food Facts ────────────────────────────────────────────

/**
 * Look up a barcode on Open Food Facts (tries multiple regional servers).
 * Returns normalized food object or null.
 */
export const lookupOpenFoodFacts = async (barcode) => {
  const norm = `${barcode || ''}`.replace(/\D/g, '');
  if (norm.length < 8) return null;

  for (const base of OPEN_FOOD_FACTS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(`${base}/api/v0/product/${norm}.json`);
      if (!res.ok) continue;

      const data = await res.json();
      if (data.status !== 1 || !data.product) continue;

      const p = data.product;
      const n = p.nutriments || {};

      const productName = p.product_name || p.product_name_en || 'Unknown Product';
      const brand = p.brands || '';
      // Nutrition values are per 100g, so servingSize must be '100g' to match
      const servingSize = '100g';

      return {
        barcode: norm,
        productName: productName.trim(),
        brand: brand.trim(),
        calories: clamp(toSafe(n['energy-kcal_100g'] || n['energy-kcal'] || 0), 0, 5000),
        protein: clamp(toSafe(n.proteins_100g || n.proteins || 0), 0, 1000),
        carbs: clamp(toSafe(n.carbohydrates_100g || n.carbohydrates || 0), 0, 1000),
        fat: clamp(toSafe(n.fat_100g || n.fat || 0), 0, 1000),
        fiber: clamp(toSafe(n.fiber_100g || n.fiber || 0), 0, 500),
        sugar: clamp(toSafe(n.sugars_100g || n.sugars || 0), 0, 1000),
        sodium: clamp(toSafe(n.sodium_100g || n.sodium || 0), 0, 100),
        servingSize,
        servingUnit: inferUnit(servingSize, productName),
        ingredients: typeof p.ingredients_text === 'string' ? p.ingredients_text.trim() : '',
        image: p.image_front_url || p.image_url || '',
        origin: resolveOrigin(p, norm),
        category: (p.categories_tags?.[0] || 'general').replace(/^\w+:/, '').replace(/-/g, ' '),
        type: SUPPLEMENT_PATTERN.test(`${productName} ${brand}`) ? 'supplement' : 'food',
        source: 'openfoodfacts',
      };
    } catch (err) {
      // Try next endpoint
      continue;
    }
  }

  return null;
};

// ─── USDA FoodData Central ──────────────────────────────────────

const getUsdaApiKey = () => process.env.USDA_API_KEY || '';

/**
 * Look up a barcode (GTIN/UPC) on USDA FoodData Central.
 * Returns normalized food object or null.
 */
export const lookupUSDA = async (barcode) => {
  const apiKey = getUsdaApiKey();
  if (!apiKey) return null;

  const norm = `${barcode || ''}`.replace(/\D/g, '');
  if (norm.length < 8) return null;

  try {
    const res = await fetchWithTimeout(
      `${USDA_BASE_URL}/foods/search?query=${norm}&dataType=Branded&pageSize=1&api_key=${apiKey}`
    );
    if (!res.ok) return null;

    const data = await res.json();
    const food = data.foods?.[0];
    if (!food) return null;

    return normalizeUsdaFood(food, norm);
  } catch (err) {
    console.warn('[USDA barcode lookup] error:', err.message);
    return null;
  }
};

/**
 * Search USDA FoodData Central by text query (for manual food search).
 * Returns array of normalized food objects.
 */
export const searchUSDA = async (query, limit = 15, dataType = '') => {
  const apiKey = getUsdaApiKey();
  if (!apiKey) {
    console.warn('[USDA] No USDA_API_KEY in environment. Get one free at https://fdc.nal.usda.gov/api-key-signup.html');
    return [];
  }

  const q = `${query || ''}`.trim();
  if (q.length < 2) return [];

  try {
    let url = `${USDA_BASE_URL}/foods/search?query=${encodeURIComponent(q)}&pageSize=${limit}&api_key=${apiKey}`;
    if (dataType) {
      // Don't encodeURIComponent the whole thing — commas are valid separators for USDA
      // Only encode spaces within each type name
      const encodedTypes = dataType.split(',').map(t => encodeURIComponent(t.trim())).join(',');
      url += `&dataType=${encodedTypes}`;
    }
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data.foods)) return [];

    let results = data.foods.map((f) => normalizeUsdaFood(f)).filter(Boolean);

    // If dataType-filtered search returned nothing, retry without filter
    if (results.length === 0 && dataType) {
      const fallbackUrl = `${USDA_BASE_URL}/foods/search?query=${encodeURIComponent(q)}&pageSize=${limit}&api_key=${apiKey}`;
      const fallbackRes = await fetchWithTimeout(fallbackUrl);
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        if (Array.isArray(fallbackData.foods)) {
          results = fallbackData.foods.map((f) => normalizeUsdaFood(f)).filter(Boolean);
        }
      }
    }

    return results;
  } catch (err) {
    console.warn('[USDA search] error:', err.message);
    return [];
  }
};

const extractNutrient = (nutrients, nutrientId) => {
  if (!Array.isArray(nutrients)) return 0;
  const entry = nutrients.find((n) => n.nutrientId === nutrientId || n.nutrientNumber === String(nutrientId));
  return toSafe(entry?.value, 0);
};

const normalizeUsdaFood = (food, barcodeOverride) => {
  if (!food) return null;

  const nutrients = food.foodNutrients || [];
  const productName = food.description || food.lowercaseDescription || 'Unknown Product';
  const brand = food.brandOwner || food.brandName || '';
  const barcode = barcodeOverride || food.gtinUpc || '';
  const servingSize = food.servingSize
    ? `${food.servingSize}${food.servingSizeUnit || 'g'}`
    : food.householdServingFullText || '100g';

  // USDA nutrient IDs: 208=Energy(kcal), 203=Protein, 205=Carbs, 204=Fat, 291=Fiber, 269=Sugar, 307=Sodium
  return {
    barcode: `${barcode}`.replace(/\D/g, ''),
    productName: productName.trim(),
    brand: brand.trim(),
    calories: clamp(toSafe(extractNutrient(nutrients, 1008) || extractNutrient(nutrients, 208)), 0, 5000),
    protein: clamp(toSafe(extractNutrient(nutrients, 1003) || extractNutrient(nutrients, 203)), 0, 1000),
    carbs: clamp(toSafe(extractNutrient(nutrients, 1005) || extractNutrient(nutrients, 205)), 0, 1000),
    fat: clamp(toSafe(extractNutrient(nutrients, 1004) || extractNutrient(nutrients, 204)), 0, 1000),
    fiber: clamp(toSafe(extractNutrient(nutrients, 1079) || extractNutrient(nutrients, 291)), 0, 500),
    sugar: clamp(toSafe(extractNutrient(nutrients, 2000) || extractNutrient(nutrients, 269)), 0, 1000),
    sodium: clamp(toSafe(extractNutrient(nutrients, 1093) || extractNutrient(nutrients, 307)), 0, 100),
    servingSize,
    servingUnit: inferUnit(servingSize, productName),
    ingredients: typeof food.ingredients === 'string' ? food.ingredients.trim() : '',
    image: '',
    origin: originFromGs1(barcode),
    category: food.foodCategory || food.brandedFoodCategory || 'general',
    type: SUPPLEMENT_PATTERN.test(`${productName} ${brand}`) ? 'supplement' : 'food',
    source: 'usda',
    fdcId: food.fdcId || null,
  };
};
