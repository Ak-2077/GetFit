import mongoose from 'mongoose';
import Food from '../models/food.js';
import FoodLog from '../models/foodLog.js';
import BurnLog from '../models/burnLog.js';
import Exercise from '../models/exercise.js';
import User from '../models/user.js';
import ReasoningCache from '../models/reasoningCache.js';
import UserState from '../models/userState.js';

// ═══════════════════════════════════════════════════════════════
// TOOL EXECUTOR — Runs tools locally (no LLM needed)
// Each tool returns structured data for the AI to reason over.
// ═══════════════════════════════════════════════════════════════

const TOOL_REGISTRY = {
  bmr_tdee_calculator: executeBmrTdee,
  macro_calculator: executeMacroCalc,
  food_search: executeFoodSearch,
  exercise_lookup: executeExerciseLookup,
  calorie_summary: executeCalorieSummary,
  progress_analytics: executeProgressAnalytics,
  workout_generator: executeWorkoutGenerator,
  meal_planner: executeMealPlanner,
};

// Tool dependency graph — tools that produce inputs for other tools
const TOOL_DEPENDENCIES = {
  macro_calculator: ['bmr_tdee_calculator'], // needs TDEE first
  meal_planner: ['macro_calculator'],        // needs macros first
  workout_generator: ['progress_analytics'], // benefits from progress context
};

// Fallback tools when primary fails
const TOOL_FALLBACKS = {
  food_search: 'calorie_summary',
  progress_analytics: 'calorie_summary',
};

// Cache TTLs per tool (hours)
const TOOL_TTL = {
  bmr_tdee_calculator: 168, // 7 days
  macro_calculator: 72,     // 3 days
  food_search: 24,          // 1 day
  exercise_lookup: 168,     // 7 days
  calorie_summary: 1,       // 1 hour
  progress_analytics: 12,   // 12 hours
  workout_generator: 168,   // 7 days
  meal_planner: 48,         // 2 days
};

const MAX_RETRIES = 1;

/**
 * Execute a tool with retry + cache + fallback.
 */
async function executeSingleTool(userId, tool, priorResults) {
  const executor = TOOL_REGISTRY[tool.name];
  if (!executor) return { tool: tool.name, error: 'unknown_tool', data: null };

  // Merge params from dependencies
  const enrichedParams = { ...tool.params };
  const deps = TOOL_DEPENDENCIES[tool.name] || [];
  for (const dep of deps) {
    const depResult = priorResults.find(r => r.tool === dep && r.data);
    if (depResult) enrichedParams._dep = { ...(enrichedParams._dep || {}), [dep]: depResult.data };
  }

  // Check cache
  const cacheKey = ReasoningCache.buildKey(tool.name, { userId: userId.toString(), ...tool.params });
  const cached = await ReasoningCache.getCache(userId, cacheKey);
  if (cached) return { tool: tool.name, data: cached, cached: true };

  // Execute with retry
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const data = await executor(userId, enrichedParams);
      await ReasoningCache.setCache(userId, cacheKey, 'tool_result', tool.params, data, TOOL_TTL[tool.name] || 24);
      return { tool: tool.name, data, cached: false };
    } catch (err) {
      lastErr = err;
    }
  }

  // Try fallback tool
  const fallback = TOOL_FALLBACKS[tool.name];
  if (fallback && TOOL_REGISTRY[fallback]) {
    try {
      const data = await TOOL_REGISTRY[fallback](userId, tool.params);
      return { tool: tool.name, data, cached: false, fallback: fallback };
    } catch (_) {}
  }

  return { tool: tool.name, error: lastErr?.message || 'execution_failed', data: null };
}

/**
 * Advanced tool execution graph.
 * Resolves dependencies, chains tools, retries failures, uses fallbacks.
 */
export const executeTools = async (userId, toolCalls) => {
  // Topological sort: run dependencies first
  const sorted = topologicalSort(toolCalls);
  const results = [];

  for (const tool of sorted) {
    const result = await executeSingleTool(userId, tool, results);
    results.push(result);
  }

  return results;
};

/**
 * Topological sort — ensures dependencies run before dependents.
 */
function topologicalSort(tools) {
  const toolMap = new Map(tools.map(t => [t.name, t]));
  const sorted = [];
  const visited = new Set();

  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const deps = TOOL_DEPENDENCIES[name] || [];
    for (const dep of deps) {
      if (toolMap.has(dep)) visit(dep);
      else if (TOOL_REGISTRY[dep]) {
        // Auto-add missing dependency
        toolMap.set(dep, { name: dep, params: {} });
        visit(dep);
      }
    }
    if (toolMap.has(name)) sorted.push(toolMap.get(name));
  }

  for (const tool of tools) visit(tool.name);
  return sorted;
}

// ═══════════════════════════════════════════════════════════════
// INDIVIDUAL TOOL IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * BMR & TDEE Calculator (Mifflin-St Jeor)
 */
async function executeBmrTdee(userId, params) {
  const user = await User.findById(userId).select('weight height age gender activityLevel').lean();
  const weight = parseFloat(params.weight_kg || user?.weight) || 70;
  const height = parseFloat(params.height_cm || user?.height) || 170;
  const age = parseInt(params.age || user?.age) || 25;
  const gender = (params.gender || user?.gender || 'male').toLowerCase();
  const activity = params.activity_level || user?.activityLevel || 'moderate';

  let bmr;
  if (gender === 'female') {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  }

  const multipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9,
  };
  const mult = multipliers[activity] || 1.55;
  const tdee = Math.round(bmr * mult);

  return {
    bmr: Math.round(bmr),
    tdee,
    weight_kg: weight,
    height_cm: height,
    age,
    gender,
    activity_level: activity,
    deficit_calories: tdee - 500,
    surplus_calories: tdee + 300,
  };
}

/**
 * Macro Calculator
 */
async function executeMacroCalc(userId, params) {
  const calories = parseInt(params.calories) || 2000;
  const goal = (params.goal || 'maintain').toLowerCase();
  const diet = (params.diet_preference || 'non_veg').toLowerCase();

  let proteinPct, carbsPct, fatPct;
  switch (goal) {
    case 'lose_fat':
    case 'lose':
      proteinPct = 0.35; carbsPct = 0.35; fatPct = 0.30; break;
    case 'gain_muscle':
    case 'gain':
      proteinPct = 0.30; carbsPct = 0.45; fatPct = 0.25; break;
    default:
      proteinPct = 0.30; carbsPct = 0.40; fatPct = 0.30;
  }

  const protein_g = Math.round((calories * proteinPct) / 4);
  const carbs_g = Math.round((calories * carbsPct) / 4);
  const fat_g = Math.round((calories * fatPct) / 9);

  return {
    target_calories: calories,
    goal,
    protein_g, protein_pct: Math.round(proteinPct * 100),
    carbs_g, carbs_pct: Math.round(carbsPct * 100),
    fat_g, fat_pct: Math.round(fatPct * 100),
    protein_calories: protein_g * 4,
    carbs_calories: carbs_g * 4,
    fat_calories: fat_g * 9,
    diet_preference: diet,
  };
}

/**
 * Food Search — query local DB
 */
async function executeFoodSearch(userId, params) {
  const query = params.query || '';
  if (!query || query.length < 2) return { results: [], query };

  let foods = [];
  try {
    foods = await Food.find({ $text: { $search: query } })
      .select('name brand calories protein carbs fat fiber servingSize servingUnit')
      .sort({ score: { $meta: 'textScore' } })
      .limit(5)
      .lean();
  } catch (_) {}

  if (foods.length === 0) {
    foods = await Food.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { brand: { $regex: query, $options: 'i' } },
      ],
    })
      .select('name brand calories protein carbs fat fiber servingSize servingUnit')
      .limit(5)
      .lean();
  }

  return {
    query,
    results: foods.map(f => ({
      name: f.name,
      brand: f.brand || '',
      calories: f.calories,
      protein: f.protein,
      carbs: f.carbs,
      fat: f.fat,
      serving: f.servingSize || '100g',
    })),
    count: foods.length,
  };
}

/**
 * Exercise Lookup
 */
async function executeExerciseLookup(userId, params) {
  const muscle = (params.muscle_group || '').toLowerCase();
  if (!muscle) return { exercises: [], muscle_group: muscle };

  const FALLBACK = {
    biceps: 'arms', triceps: 'arms', forearms: 'arms',
    quadriceps: 'legs', hamstrings: 'legs', calves: 'legs', glutes: 'legs',
    obliques: 'abs', upper_back: 'back', lower_back: 'back', traps: 'shoulders',
  };

  let exercises = await Exercise.find({ muscleGroup: muscle }).sort({ difficulty: 1 }).limit(8).lean();
  if (exercises.length === 0 && FALLBACK[muscle]) {
    exercises = await Exercise.find({ muscleGroup: FALLBACK[muscle] }).sort({ difficulty: 1 }).limit(8).lean();
  }

  return {
    muscle_group: muscle,
    exercises: exercises.map(e => ({
      name: e.name,
      difficulty: e.difficulty,
      equipment: e.equipment,
      muscleGroup: e.muscleGroup,
    })),
    count: exercises.length,
  };
}

/**
 * Today's Calorie Summary
 */
async function executeCalorieSummary(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [user, foodLogs, burnLogs] = await Promise.all([
    User.findById(userId).select('maintenanceCalories goalCalories').lean(),
    FoodLog.find({ userId, date: { $gte: today } }).lean(),
    BurnLog.find({ userId, date: { $gte: today } }).lean(),
  ]);

  const consumed = foodLogs.reduce((s, l) => s + (l.caloriesConsumed || l.calories || 0), 0);
  const protein = foodLogs.reduce((s, l) => s + (l.protein || 0), 0);
  const carbs = foodLogs.reduce((s, l) => s + (l.carbs || 0), 0);
  const fat = foodLogs.reduce((s, l) => s + (l.fat || 0), 0);
  const burned = burnLogs.reduce((s, l) => s + (l.caloriesBurned || 0), 0);
  const target = user?.maintenanceCalories || user?.goalCalories || 2000;

  return {
    target_calories: target,
    consumed_calories: Math.round(consumed),
    remaining_calories: Math.round(target - consumed),
    burned_calories: Math.round(burned),
    macros: {
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat),
    },
    meals_logged: foodLogs.length,
  };
}

/**
 * Progress Analytics (7-day trends)
 */
async function executeProgressAnalytics(userId) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  weekAgo.setHours(0, 0, 0, 0);

  const [foodAgg, burnAgg] = await Promise.all([
    FoodLog.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), date: { $gte: weekAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, calories: { $sum: { $ifNull: ['$caloriesConsumed', '$calories'] } }, protein: { $sum: '$protein' } } },
      { $sort: { _id: 1 } },
    ]),
    BurnLog.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), date: { $gte: weekAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, burned: { $sum: '$caloriesBurned' } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const daysLogged = foodAgg.length;
  const avgCalories = daysLogged > 0 ? Math.round(foodAgg.reduce((s, d) => s + d.calories, 0) / daysLogged) : 0;
  const avgProtein = daysLogged > 0 ? Math.round(foodAgg.reduce((s, d) => s + (d.protein || 0), 0) / daysLogged) : 0;

  return {
    days_tracked: daysLogged,
    avg_daily_calories: avgCalories,
    avg_daily_protein: avgProtein,
    total_burned: burnAgg.reduce((s, d) => s + d.burned, 0),
    daily_intake: foodAgg.map(d => ({ date: d._id, calories: Math.round(d.calories) })),
    consistency_score: Math.min(1, daysLogged / 7),
  };
}

/**
 * Workout Generator (static plans by level)
 */
async function executeWorkoutGenerator(userId, params) {
  const user = await User.findById(userId).select('level goal').lean();
  const level = params.level || user?.level || 'beginner';
  const goal = params.goal || user?.goal || 'maintain';

  // Fetch exercises grouped by muscle
  const exercises = await Exercise.find().sort({ muscleGroup: 1, difficulty: 1 }).limit(50).lean();
  const grouped = {};
  exercises.forEach(e => {
    if (!grouped[e.muscleGroup]) grouped[e.muscleGroup] = [];
    grouped[e.muscleGroup].push(e.name);
  });

  return {
    level,
    goal,
    available_muscle_groups: Object.keys(grouped),
    exercises_by_group: Object.fromEntries(
      Object.entries(grouped).map(([k, v]) => [k, v.slice(0, 5)])
    ),
    suggestion: level === 'beginner' ? '3 days/week full body' :
                level === 'intermediate' ? '4 days/week upper/lower split' :
                '5-6 days/week push/pull/legs',
  };
}

/**
 * Meal Planner (structured macro-based)
 */
async function executeMealPlanner(userId, params) {
  const calories = parseInt(params.calories) || 2000;
  const diet = (params.diet_preference || 'non_veg').toLowerCase();
  const meals = parseInt(params.meals_per_day) || 3;

  const perMeal = Math.round(calories / meals);
  const snackCal = meals >= 4 ? Math.round(calories * 0.15) : 0;
  const mainMealCal = meals >= 4 ? Math.round((calories - snackCal) / (meals - 1)) : perMeal;

  return {
    total_calories: calories,
    diet_preference: diet,
    meals_per_day: meals,
    meal_breakdown: Array.from({ length: meals }, (_, i) => ({
      meal: i === 0 ? 'breakfast' : i === meals - 1 && meals >= 4 ? 'snack' : i === 1 ? 'lunch' : 'dinner',
      target_calories: i === meals - 1 && meals >= 4 ? snackCal : mainMealCal,
    })),
    guidelines: diet === 'veg' ?
      'Focus on dal, paneer, tofu, legumes, quinoa for protein' :
      'Include chicken, fish, eggs, dairy for protein variety',
  };
}

// ═══════════════════════════════════════════════════════════════
// USER STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Get or create user state.
 */
export const getOrCreateUserState = async (userId) => {
  let state = await UserState.findOne({ userId });
  if (!state) {
    state = new UserState({ userId });
    await state.save();
  }
  return state;
};

/**
 * Add signal to user state and recompute.
 */
export const addUserSignal = async (userId, signalType, value = {}) => {
  const state = await getOrCreateUserState(userId);
  await state.addSignal(signalType, value);
  return state;
};
