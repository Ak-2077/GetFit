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
import { searchOpenFoodFacts } from '../services/openFoodFactsService.js';
import { reason, loadOntologyCache, getOntologyCacheSize } from '../services/reasoningEngine.js';
import { estimatePortion } from '../services/portionEstimator.js';
import FoodMemory from '../models/foodMemory.js';
import FoodOntology from '../models/foodOntology.js';
import FoodCorrection from '../models/foodCorrection.js';
import FoodAnalytics from '../models/foodAnalytics.js';

const router = express.Router();

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8100';

// ═══ BUILT-IN FALLBACK NUTRITION (per 100g, verified USDA data) ═══
const FALLBACK_NUTRITION = {
  // Eggs
  'egg': { name: 'Egg, whole, cooked', calories: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0, sugar: 1.1, servingSize: '100g', source: 'usda' },
  'brown egg': { name: 'Egg, whole, cooked', calories: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0, sugar: 1.1, servingSize: '100g', source: 'usda' },
  'white egg': { name: 'Egg, whole, cooked', calories: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0, sugar: 1.1, servingSize: '100g', source: 'usda' },
  'boiled egg': { name: 'Egg, whole, hard-boiled', calories: 155, protein: 12.6, carbs: 1.1, fat: 10.6, fiber: 0, sugar: 1.1, servingSize: '100g', source: 'usda' },
  'scrambled egg': { name: 'Egg, scrambled', calories: 149, protein: 10.2, carbs: 2.2, fat: 11, fiber: 0, sugar: 2, servingSize: '100g', source: 'usda' },
  'fried egg': { name: 'Egg, fried', calories: 196, protein: 13.6, carbs: 0.8, fat: 15, fiber: 0, sugar: 0.4, servingSize: '100g', source: 'usda' },
  'omelette': { name: 'Egg omelette', calories: 154, protein: 11, carbs: 1.6, fat: 12, fiber: 0, sugar: 1.4, servingSize: '100g', source: 'usda' },
  // Rice & Grains
  'rice': { name: 'Rice, white, cooked', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sugar: 0, servingSize: '100g', source: 'usda' },
  'cooked rice': { name: 'Rice, white, cooked', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sugar: 0, servingSize: '100g', source: 'usda' },
  'brown rice': { name: 'Rice, brown, cooked', calories: 123, protein: 2.7, carbs: 26, fat: 1, fiber: 1.8, sugar: 0.4, servingSize: '100g', source: 'usda' },
  'oats': { name: 'Oats, dry', calories: 389, protein: 17, carbs: 66, fat: 7, fiber: 11, sugar: 1, servingSize: '100g', source: 'usda' },
  // Pasta
  'pasta': { name: 'Pasta, cooked', calories: 131, protein: 5, carbs: 25, fat: 1.1, fiber: 1.8, sugar: 0.6, servingSize: '100g', source: 'usda' },
  'spaghetti': { name: 'Spaghetti, cooked', calories: 131, protein: 5, carbs: 25, fat: 1.1, fiber: 1.8, sugar: 0.6, servingSize: '100g', source: 'usda' },
  'penne': { name: 'Penne pasta, cooked', calories: 131, protein: 5, carbs: 25, fat: 1.1, fiber: 1.8, sugar: 0.6, servingSize: '100g', source: 'usda' },
  'macaroni': { name: 'Macaroni, cooked', calories: 131, protein: 5, carbs: 25, fat: 1.1, fiber: 1.8, sugar: 0.6, servingSize: '100g', source: 'usda' },
  'noodle': { name: 'Noodles, cooked', calories: 138, protein: 4.5, carbs: 25, fat: 2.1, fiber: 1.2, sugar: 0.5, servingSize: '100g', source: 'usda' },
  'lasagna': { name: 'Lasagna, cooked', calories: 135, protein: 7, carbs: 17, fat: 4.5, fiber: 1.5, sugar: 2, servingSize: '100g', source: 'usda' },
  // Meat & Protein
  'chicken': { name: 'Chicken breast, cooked', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sugar: 0, servingSize: '100g', source: 'usda' },
  'chicken breast': { name: 'Chicken breast, cooked', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sugar: 0, servingSize: '100g', source: 'usda' },
  'fish': { name: 'Fish, cooked', calories: 206, protein: 22, carbs: 0, fat: 12, fiber: 0, sugar: 0, servingSize: '100g', source: 'usda' },
  'salmon': { name: 'Salmon, cooked', calories: 208, protein: 20, carbs: 0, fat: 13, fiber: 0, sugar: 0, servingSize: '100g', source: 'usda' },
  'tuna': { name: 'Tuna, cooked', calories: 184, protein: 30, carbs: 0, fat: 6, fiber: 0, sugar: 0, servingSize: '100g', source: 'usda' },
  'mutton': { name: 'Mutton, cooked', calories: 294, protein: 25, carbs: 0, fat: 21, fiber: 0, sugar: 0, servingSize: '100g', source: 'usda' },
  'prawns': { name: 'Shrimp, cooked', calories: 99, protein: 24, carbs: 0.2, fat: 0.3, fiber: 0, sugar: 0, servingSize: '100g', source: 'usda' },
  // Indian Breads & Dishes
  'roti': { name: 'Roti, whole wheat', calories: 297, protein: 9.8, carbs: 50, fat: 7.5, fiber: 4, sugar: 1.3, servingSize: '100g', source: 'usda' },
  'chapati': { name: 'Chapati, whole wheat', calories: 297, protein: 9.8, carbs: 50, fat: 7.5, fiber: 4, sugar: 1.3, servingSize: '100g', source: 'usda' },
  'naan': { name: 'Naan bread', calories: 262, protein: 8.7, carbs: 45, fat: 5.1, fiber: 2, sugar: 3.6, servingSize: '100g', source: 'usda' },
  'paratha': { name: 'Paratha, plain', calories: 326, protein: 7.4, carbs: 45, fat: 13, fiber: 2.5, sugar: 1, servingSize: '100g', source: 'usda' },
  'dal': { name: 'Dal (lentil curry)', calories: 116, protein: 7.6, carbs: 15, fat: 2.8, fiber: 5, sugar: 1.8, servingSize: '100g', source: 'usda' },
  'paneer': { name: 'Paneer (Indian cottage cheese)', calories: 321, protein: 21, carbs: 3.6, fat: 25, fiber: 0, sugar: 2, servingSize: '100g', source: 'usda' },
  'biryani': { name: 'Biryani, chicken', calories: 175, protein: 8, carbs: 22, fat: 6, fiber: 0.8, sugar: 1, servingSize: '100g', source: 'usda' },
  'samosa': { name: 'Samosa, fried', calories: 262, protein: 4.2, carbs: 27, fat: 15, fiber: 2, sugar: 2, servingSize: '100g', source: 'usda' },
  'idli': { name: 'Idli, steamed', calories: 77, protein: 2, carbs: 16, fat: 0.4, fiber: 0.6, sugar: 0, servingSize: '100g', source: 'usda' },
  'dosa': { name: 'Dosa', calories: 168, protein: 3.9, carbs: 25, fat: 5.8, fiber: 0.8, sugar: 1, servingSize: '100g', source: 'usda' },
  'poha': { name: 'Poha (flattened rice, cooked)', calories: 130, protein: 2.5, carbs: 27, fat: 1.5, fiber: 1.2, sugar: 0.5, servingSize: '100g', source: 'usda' },
  'upma': { name: 'Upma (semolina porridge)', calories: 135, protein: 3.5, carbs: 18, fat: 5.5, fiber: 1.5, sugar: 0.5, servingSize: '100g', source: 'usda' },
  // Western
  'pizza': { name: 'Pizza, cheese', calories: 266, protein: 11, carbs: 33, fat: 10, fiber: 2.3, sugar: 3.6, servingSize: '100g', source: 'usda' },
  'burger': { name: 'Hamburger', calories: 295, protein: 17, carbs: 24, fat: 14, fiber: 1, sugar: 5, servingSize: '100g', source: 'usda' },
  'sandwich': { name: 'Sandwich', calories: 250, protein: 12, carbs: 28, fat: 10, fiber: 2, sugar: 3, servingSize: '100g', source: 'usda' },
  'french fries': { name: 'French fries', calories: 312, protein: 3.4, carbs: 41, fat: 15, fiber: 3.8, sugar: 0.3, servingSize: '100g', source: 'usda' },
  'fries': { name: 'French fries', calories: 312, protein: 3.4, carbs: 41, fat: 15, fiber: 3.8, sugar: 0.3, servingSize: '100g', source: 'usda' },
  // Dairy
  'milk': { name: 'Milk, whole', calories: 61, protein: 3.2, carbs: 4.8, fat: 3.3, fiber: 0, sugar: 5, servingSize: '100g', source: 'usda' },
  'yogurt': { name: 'Yogurt, plain', calories: 61, protein: 3.5, carbs: 4.7, fat: 3.3, fiber: 0, sugar: 4.7, servingSize: '100g', source: 'usda' },
  'curd': { name: 'Curd (Dahi)', calories: 61, protein: 3.5, carbs: 4.7, fat: 3.3, fiber: 0, sugar: 4.7, servingSize: '100g', source: 'usda' },
  'cheese': { name: 'Cheese, cheddar', calories: 403, protein: 25, carbs: 1.3, fat: 33, fiber: 0, sugar: 0.5, servingSize: '100g', source: 'usda' },
  // Fruits
  'banana': { name: 'Banana, raw', calories: 89, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6, sugar: 12, servingSize: '100g', source: 'usda' },
  'apple': { name: 'Apple, raw', calories: 52, protein: 0.3, carbs: 14, fat: 0.2, fiber: 2.4, sugar: 10, servingSize: '100g', source: 'usda' },
  'mango': { name: 'Mango, raw', calories: 60, protein: 0.8, carbs: 15, fat: 0.4, fiber: 1.6, sugar: 14, servingSize: '100g', source: 'usda' },
  'orange': { name: 'Orange, raw', calories: 47, protein: 0.9, carbs: 12, fat: 0.1, fiber: 2.4, sugar: 9, servingSize: '100g', source: 'usda' },
  // Bread
  'bread': { name: 'Bread, white', calories: 265, protein: 9, carbs: 49, fat: 3.2, fiber: 2.7, sugar: 5, servingSize: '100g', source: 'usda' },
  'toast': { name: 'Toast, white', calories: 313, protein: 10, carbs: 55, fat: 5, fiber: 3, sugar: 5, servingSize: '100g', source: 'usda' },
  'croissant': { name: 'Croissant', calories: 406, protein: 8.2, carbs: 45, fat: 21, fiber: 2.3, sugar: 11, servingSize: '100g', source: 'usda' },
  // Other
  'potato': { name: 'Potato, cooked', calories: 87, protein: 1.9, carbs: 20, fat: 0.1, fiber: 1.8, sugar: 0.9, servingSize: '100g', source: 'usda' },
  'salad': { name: 'Mixed salad', calories: 20, protein: 1.5, carbs: 3.5, fat: 0.3, fiber: 2, sugar: 2, servingSize: '100g', source: 'usda' },
  'soup': { name: 'Vegetable soup', calories: 36, protein: 1.2, carbs: 6, fat: 0.8, fiber: 1.5, sugar: 2.5, servingSize: '100g', source: 'usda' },
  'peanut butter': { name: 'Peanut butter', calories: 588, protein: 25, carbs: 20, fat: 50, fiber: 6, sugar: 9, servingSize: '100g', source: 'usda' },
  'almonds': { name: 'Almonds, raw', calories: 579, protein: 21, carbs: 22, fat: 50, fiber: 12, sugar: 4, servingSize: '100g', source: 'usda' },
};

// ═══ FOOD VISION v2 — Multi-Stage Pipeline ═══
// Camera → Vision → Reasoning → Ontology → Confidence → Nutrition → Response
// Load ontology cache on first request
let _ontologyLoaded = false;

router.post('/recognize', auth, async (req, res) => {
  const startTime = Date.now();
  try {
    const { image_base64, mime_type, food_type, cooking_methods } = req.body;
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'image_base64 is required' });
    }

    // ── Load ontology cache (once) ──
    if (!_ontologyLoaded) {
      await loadOntologyCache();
      _ontologyLoaded = true;
    }

    const userId = req.user?._id || null;
    console.log(`[Pipeline] Starting multi-stage recognition (${Math.round(image_base64.length / 1024)}KB)`);

    // ═══ STAGE 0: Image Quality Check ═══
    console.log('[Pipeline] Stage 0: Quality Check...');
    try {
      const qualityRes = await fetch(`${AI_SERVICE_URL}/food-vision/analyze-quality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64 }),
        signal: AbortSignal.timeout(10000),
      });
      const qualityData = await qualityRes.json();
      if (qualityData && qualityData.acceptable === false) {
        return res.status(200).json({
          success: false,
          error: qualityData.suggestion || 'Image quality too poor',
          quality_issue: true
        });
      }
    } catch (e) {
      console.warn('[Pipeline] Quality check failed, continuing anyway:', e.message);
    }

    // ═══ STAGE 1: AI Vision (Moondream) ═══
    console.log('[Pipeline] Stage 1: Vision...');
    const aiResponse = await fetch(`${AI_SERVICE_URL}/food-vision/recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64, mime_type: mime_type || 'image/jpeg', food_type: food_type || 'homemade', cooking_methods: cooking_methods || [] }),
      signal: AbortSignal.timeout(120000),
    });

    const aiData = await aiResponse.json();
    const visionMs = Date.now() - startTime;
    console.log(`[Pipeline] Vision done in ${visionMs}ms — success: ${aiData.success}`);

    if (!aiData.success || !aiData.raw_description) {
      return res.status(200).json({
        success: false,
        error: aiData.error || 'Vision model could not process image',
        processing_time_ms: Date.now() - startTime,
      });
    }

    const rawDescription = aiData.raw_description;
    console.log(`[Pipeline] Raw vision: "${rawDescription.substring(0, 150)}..."`);

    // ═══ STAGE 2: Reasoning Engine ═══
    console.log('[Pipeline] Stage 2: Reasoning...');
    const detectedObjects = aiData.objects || [];
    const reasoningResult = await reason(rawDescription, detectedObjects, cooking_methods || [], userId);
    const reasoningMs = Date.now() - startTime - visionMs;
    console.log(`[Pipeline] Reasoning done in ${reasoningMs}ms — ${reasoningResult.predictions.length} predictions`);

    if (reasoningResult.predictions.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'Could not identify food items. Try a clearer photo or manual search.',
        raw_ai_response: rawDescription.substring(0, 300),
        processing_time_ms: Date.now() - startTime,
      });
    }

    // ═══ STAGE 3 & 4: Portion Estimation & Nutrition for all detected foods ═══
    const resolvedFoods = [];
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;

    for (const pred of reasoningResult.predictions) {
      const counts = reasoningResult.counts || {};
      // ── Resolve detected count for this prediction ──
      // Counts/objects are keyed by BASE ingredient (e.g. "egg"), while the
      // prediction name is the dish (e.g. "boiled egg"). Match by:
      //   1. exact dish name, 2. base ingredient token, 3. any object whose
      //   name is contained in the dish name. Falls back to 1.
      const dishLower = pred.dishNameLower;
      const objectsDetected = reasoningResult.objectsDetected || [];
      const matchObj = objectsDetected.find(o => {
        const n = (o.name || '').toLowerCase();
        return n && (n === dishLower || dishLower.includes(n) || n.includes(dishLower));
      });
      let primaryCount = matchObj?.count;
      if (!primaryCount) {
        // Try counts map by dish name, then by any base ingredient token in the name
        primaryCount = counts[dishLower];
        if (!primaryCount) {
          for (const [k, v] of Object.entries(counts)) {
            if (k && (dishLower.includes(k) || k.includes(dishLower))) { primaryCount = v; break; }
          }
        }
      }
      primaryCount = Math.max(1, Math.round(Number(primaryCount) || 1));

      const portion = await estimatePortion(
        pred.dishName,
        reasoningResult.portionCues,
        primaryCount,
        pred.category,
        pred.defaultGrams,
        userId
      );

      const nutrition = await lookupNutrition(
        pred.dishName,
        pred.dishNameLower,
        pred.usdaKeyword || pred.dishName,
        pred.offKeyword || pred.dishName,
        portion.grams,
        pred.caloriesPer100g > 0 ? {
          calories: pred.caloriesPer100g,
          protein: pred.proteinPer100g,
          carbs: pred.carbsPer100g,
          fat: pred.fatPer100g,
          fiber: pred.fiberPer100g,
        } : null
      );

      resolvedFoods.push({
        name: pred.dishName,
        normalized_name: pred.dishNameLower,
        state: pred.cookingStyle || 'general',
        portion: `${portion.count > 1 ? portion.count + ' × ' : '~'}${portion.perUnit}g`,
        grams: portion.grams,
        count: portion.count,
        confidence: pred.confidence,
        reasoning_adjustment: pred.reasoningAdjustment,
        reasoning_explanation: pred.reasoningExplanation,
        calories: nutrition.calories,
        protein: nutrition.protein,
        carbs: nutrition.carbs,
        fat: nutrition.fat,
        fiber: nutrition.fiber,
        sugar: nutrition.sugar || 0,
        sodium: nutrition.sodium || 0,
        source: nutrition.source,
        dish_type: pred.category,
        cooking_style: pred.cookingStyle || '',
        visible_ingredients: pred.ingredients || [],
        portion_confidence: portion.portionConfidence,
        portion_source: portion.portionSource,
        estimated_weight: portion.estimatedWeight ?? portion.grams,
        final_weight: portion.grams,
        needs_confirmation: portion.needsConfirmation ?? false,
        portion_options: portion.portionOptions || [],
        is_user_modified: false,
      });

      totalCalories += nutrition.calories;
      totalProtein += nutrition.protein;
      totalCarbs += nutrition.carbs;
      totalFat += nutrition.fat;
    }

    // ═══ STAGE 5: Build Response ═══
    const topPrediction = resolvedFoods[0];
    const topRawConf = topPrediction.confidence;

    // ═══ STAGE 7 + 11: Confidence Gate / Unknown Handling ═══
    const usdaVerified = (topPrediction.source || '').toLowerCase().includes('usda');
    const hasAlternatives = (reasoningResult.alternatives || []).length > 0;
    let confidenceTier;
    if (reasoningResult.isUnknown || topRawConf < 0.60) {
      confidenceTier = 'unknown';            // STAGE 11: too low — ask user, never guess
    } else if (topRawConf >= 0.85 && usdaVerified && !hasAlternatives) {
      confidenceTier = 'auto';               // strong food + strong nutrition, no rival
    } else {
      confidenceTier = 'confirm';            // show confirmation screen
    }

    try {
      await FoodAnalytics.logScan({
        confidence: topRawConf,
        isCorrected: false,
        aiPrediction: topPrediction.normalized_name,
        userCorrection: ''
      });
    } catch (e) { console.error('[Analytics] log error:', e.message); }

    const elapsed = Date.now() - startTime;
    console.log(`[Pipeline] ✓ Complete in ${elapsed}ms — "${topPrediction.name}" (${(topRawConf * 100).toFixed(0)}%) | ${totalCalories.toFixed(0)} kcal | ${confidenceTier}`);

    let mealDesc = topPrediction.name;
    if (reasoningResult.isMeal) {
      mealDesc = topPrediction.name; 
    } else if (resolvedFoods.length > 1) {
      mealDesc = resolvedFoods.map(f => f.name).join(' & ');
    } else if (topPrediction.count > 1) {
      mealDesc = `${topPrediction.name} × ${topPrediction.count}`;
    }

    res.status(200).json({
      success: true,
      foods: resolvedFoods, // All detected components
      confidence_tier: confidenceTier,
      alternatives: reasoningResult.alternatives || [],
      reasoning: {
        extracted_ingredients: reasoningResult.extractedIngredients,
        visual_cues: reasoningResult.visualCues,
        cooking_indicators: reasoningResult.cookingIndicators,
        portion_cues: reasoningResult.portionCues,
        counts: reasoningResult.counts,
        food_state: reasoningResult.foodState || 'unknown',
        hierarchy: reasoningResult.hierarchy || null,
        is_unknown: reasoningResult.isUnknown || false,
        ontology_size: reasoningResult.ontologySize,
        validation_state: reasoningResult.validationState,
        object_count: reasoningResult.objectCount,
        objects_detected: reasoningResult.objectsDetected,
        is_meal: reasoningResult.isMeal,
        meal_type: reasoningResult.mealType,
      },
      meal_description: mealDesc,
      total_calories: Number(totalCalories.toFixed(1)),
      total_protein: Number(totalProtein.toFixed(1)),
      total_carbs: Number(totalCarbs.toFixed(1)),
      total_fat: Number(totalFat.toFixed(1)),
      raw_ai_response: rawDescription.substring(0, 300),
      processing_time_ms: elapsed,
      pipeline_version: 'v3',
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[Pipeline] error after ${elapsed}ms:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══ NUTRITION CASCADE: GetFit DB → USDA → Open Food Facts ═══
async function lookupNutrition(displayName, lowerName, usdaKw, offKw, grams, ontologyNutrition) {
  let nutritionPer100g = null;
  let source = 'unknown';

  // ── Tier 1: GetFit Internal Database (ontology nutrition) ──
  if (ontologyNutrition && ontologyNutrition.calories > 0) {
    nutritionPer100g = ontologyNutrition;
    source = 'getfit';
    console.log(`[Nutrition] GetFit DB match: "${displayName}" (${ontologyNutrition.calories} cal/100g)`);
  }

  // ── Tier 1b: FALLBACK_NUTRITION table (verified USDA data) ──
  if (!nutritionPer100g) {
    let fallback = FALLBACK_NUTRITION[lowerName];
    if (!fallback) {
      for (const [key, val] of Object.entries(FALLBACK_NUTRITION)) {
        if (lowerName.includes(key) || key.includes(lowerName)) {
          fallback = val;
          break;
        }
      }
    }
    if (fallback) {
      nutritionPer100g = { calories: fallback.calories, protein: fallback.protein, carbs: fallback.carbs, fat: fallback.fat, fiber: fallback.fiber || 0 };
      source = 'getfit';
      console.log(`[Nutrition] Fallback match: "${displayName}" → "${fallback.name}" (${fallback.calories} cal/100g)`);
    }
  }

  // ── Tier 2: USDA FoodData Central ──
  if (!nutritionPer100g) {
    try {
      const terms = [usdaKw, lowerName].filter(Boolean);
      for (const term of [...new Set(terms)]) {
        if (term.length < 2) continue;
        const results = await searchUSDA(term, 5, 'Foundation,SR Legacy');
        if (results?.length > 0) {
          const best = results.find(r => r.productName?.toLowerCase().includes(lowerName)) || results[0];
          if (best?.calories > 0) {
            nutritionPer100g = { calories: best.calories, protein: best.protein, carbs: best.carbs, fat: best.fat, fiber: best.fiber || 0 };
            source = 'usda';
            console.log(`[Nutrition] USDA match: "${displayName}" → "${best.productName}" (${best.calories} cal/100g)`);
            break;
          }
        }
      }
    } catch (err) {
      console.warn(`[Nutrition] USDA error for "${displayName}":`, err.message);
    }
  }

  // ── Tier 3: Open Food Facts ──
  if (!nutritionPer100g) {
    try {
      const offResults = await searchOpenFoodFacts(offKw, 3);
      if (offResults?.length > 0) {
        const best = offResults[0];
        nutritionPer100g = { calories: best.calories, protein: best.protein, carbs: best.carbs, fat: best.fat, fiber: best.fiber || 0 };
        source = 'openfoodfacts';
        console.log(`[Nutrition] OFF match: "${displayName}" → "${best.productName}" (${best.calories} cal/100g)`);
      }
    } catch (err) {
      console.warn(`[Nutrition] OFF error for "${displayName}":`, err.message);
    }
  }

  // Scale to portion
  if (nutritionPer100g) {
    const scale = grams / 100;
    return {
      calories: Math.round(nutritionPer100g.calories * scale),
      protein: Number((nutritionPer100g.protein * scale).toFixed(1)),
      carbs: Number((nutritionPer100g.carbs * scale).toFixed(1)),
      fat: Number((nutritionPer100g.fat * scale).toFixed(1)),
      fiber: Number((nutritionPer100g.fiber * scale).toFixed(1)),
      source,
    };
  }

  return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, source: 'unknown' };
}

// ═══ PORTION LEARNING (Stage 5/14) ═══
// NOTE: There is intentionally NO dedicated /portion-correction endpoint.
// Portion learning is persisted automatically inside POST /api/food/log
// (controllers/foodController.js → addFoodToLog) when the user's selected
// weight differs from the AI estimate. This avoids API spam during editing.

// ═══ FOOD FEEDBACK — Learning System ═══
router.post('/feedback', auth, async (req, res) => {
  try {
    const { aiPrediction, userCorrection, imageHash, confidence, rawVisionText, detectedIngredients, visualCues, wasAlternativeSelected } = req.body;
    const userId = req.user._id;

    if (!aiPrediction || !userCorrection) {
      return res.status(400).json({ error: 'aiPrediction and userCorrection are required' });
    }

    // Save correction
    await FoodCorrection.create({
      userId,
      imageHash: imageHash || '',
      aiPrediction: aiPrediction.toLowerCase(),
      aiConfidence: confidence || 0,
      userCorrection: userCorrection.toLowerCase(),
      rawVisionText: rawVisionText || '',
      detectedIngredients: detectedIngredients || [],
      visualCues: visualCues || [],
      wasAlternativeSelected: wasAlternativeSelected || false,
      wasManualEntry: !wasAlternativeSelected,
    });

    // Also update FoodMemory
    try {
      await FoodMemory.findOneAndUpdate(
        { userId, foodName: userCorrection.toLowerCase() },
        {
          $set: { aiDetectedName: aiPrediction.toLowerCase(), userCorrectedName: userCorrection.toLowerCase(), lastLoggedAt: new Date(), source: 'scan' },
          $inc: { correctionCount: 1, logCount: 1 },
        },
        { upsert: true }
      );
    } catch (e) { /* non-critical */ }

    // Update Analytics for correction
    try {
      await FoodAnalytics.logScan({
        confidence: confidence || 0,
        isCorrected: true,
        aiPrediction: aiPrediction.toLowerCase(),
        userCorrection: userCorrection.toLowerCase()
      });
    } catch (e) { console.error('[Analytics] correction log error:', e.message); }

    console.log(`[Feedback] "${aiPrediction}" → "${userCorrection}" (user: ${userId})`);
    res.json({ success: true });
  } catch (err) {
    console.error('[Feedback] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══ SMART SEARCH — Direct DB + USDA with match engine scoring ═══
router.post('/smart-search', auth, async (req, res) => {
  try {
    const { foods, cooking_methods = [] } = req.body;
    if (!Array.isArray(foods) || foods.length === 0) {
      return res.status(400).json({ message: 'foods array is required' });
    }

    console.log(`[SmartSearch] Processing ${foods.length} foods in parallel:`, foods.map(f => f.name));

    // ── PARALLEL: Process all foods at once ──
    const results = await Promise.all(foods.map(async (food) => {
      const searchTerms = buildSearchTerms({ ...food, cooking_methods });
      const detectedName = food.name || '';
      const category = classifyFood(detectedName);
      let allRawResults = [];

      // ── STEP 0: If AI provided nutrition estimates, include them as a result ──
      if (food.calories && food.calories > 0) {
        allRawResults.push({
          _id: `ai_${detectedName.toLowerCase().replace(/\s+/g, '_')}`,
          name: food.name,
          brand: '',
          calories: food.calories || 0,
          protein: food.protein || 0,
          carbs: food.carbs || 0,
          fat: food.fat || 0,
          fiber: food.fiber || 0,
          sugar: 0,
          sodium: 0,
          servingSize: food.grams ? `${Math.round(food.grams)}g` : (food.portion || '100g'),
          servingUnit: 'g',
          source: 'ai-vision',
          type: 'food',
          category: category,
          origin: '',
        });
      }

      // ── STEP 1: USDA search (primary data source) ──
      for (const term of searchTerms) {
        if (!term || term.length < 2) continue;
        try {
          const isNatural = category !== 'supplement' && category !== 'packaged_food';
          const dataTypes = isNatural ? 'Foundation,SR Legacy' : '';
          const usdaResults = await searchUSDA(term, 10, dataTypes);
          if (usdaResults && usdaResults.length > 0) {
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
          console.warn(`[SmartSearch] USDA error for "${term}":`, usdaErr.message);
        }
        if (allRawResults.length >= 10) break;
      }

      // ── STEP 2: Fallback nutrition for common foods ──
      if (allRawResults.length === 0) {
        const lowerName = detectedName.toLowerCase().trim();
        let fallback = FALLBACK_NUTRITION[lowerName];
        if (!fallback) {
          for (const [key, val] of Object.entries(FALLBACK_NUTRITION)) {
            if (lowerName.includes(key) || key.includes(lowerName)) {
              fallback = val;
              break;
            }
          }
        }
        if (fallback) {
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

      // ── STEP 3: Deduplicate ──
      const seen = new Set();
      allRawResults = allRawResults.filter(r => {
        const key = `${(r.name || '').toLowerCase().trim()}_${r.calories || 0}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // ── STEP 4: Match engine scoring ──
      const ranked = rankAndFilterResults(detectedName, allRawResults, {
        category,
        cookingState: food.state || '',
      });

      const validatedMatches = ranked.slice(0, 5).map(r => {
        const macroCheck = validateMacros(detectedName, r);
        return { ...r, _macroValid: macroCheck.valid, _macroIssues: macroCheck.issues };
      });

      const bestMatch = validatedMatches.length > 0 ? validatedMatches[0] : null;

      console.log(`[SmartSearch] "${detectedName}" → ${validatedMatches.length} matches, best: "${bestMatch?.name || 'none'}"`);

      return {
        detected: food,
        category,
        searchTerms,
        matches: validatedMatches,
        bestMatch,
      };
    }));

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
