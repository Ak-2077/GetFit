import mongoose from 'mongoose';
import FoodLog from '../models/foodLog.js';
import BurnLog from '../models/burnLog.js';
import User from '../models/user.js';

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const startOfDay = (input = new Date()) => {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (input = new Date()) => {
  const date = new Date(input);
  date.setHours(23, 59, 59, 999);
  return date;
};

const getDayRange = (daysBack = 6) => {
  const now = new Date();
  const days = [];

  for (let i = daysBack; i >= 0; i -= 1) {
    const d = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    days.push(d);
  }

  return {
    days,
    start: days[0],
    end: endOfDay(days[days.length - 1]),
  };
};

const normalizeMealType = (mealType) => {
  const normalized = String(mealType || '').toLowerCase();
  if (normalized === 'breakfast' || normalized === 'lunch' || normalized === 'dinner') return normalized;
  return 'snacks';
};

const estimateWalkingBurn = ({ weightKg, distanceKm, steps }) => {
  const safeWeight = Math.max(35, Math.min(220, toSafeNumber(weightKg, 70)));
  const distanceFromStepsKm = toSafeNumber(steps) > 0 ? (toSafeNumber(steps) * 0.78) / 1000 : 0;
  const safeDistanceKm = Math.max(0, toSafeNumber(distanceKm) || distanceFromStepsKm);
  // Walking cost approximation: ~0.75 kcal per kg per km.
  return safeWeight * safeDistanceKm * 0.75;
};

export const getCaloriesToday = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const [user, logs, burnLogs] = await Promise.all([
      User.findById(userId).select('maintenanceCalories goalCalories'),
      FoodLog.find({ userId, date: { $gte: startOfDay() } }).populate('foodId').sort({ createdAt: -1 }).lean(),
      BurnLog.find({ userId, date: { $gte: startOfDay() } }).lean(),
    ]);

    const consumed = logs.reduce((sum, log) => sum + toSafeNumber(log.caloriesConsumed || log.calories), 0);
    const macros = logs.reduce(
      (acc, log) => {
        acc.protein += toSafeNumber(log.protein);
        acc.carbs += toSafeNumber(log.carbs);
        acc.fat += toSafeNumber(log.fat);
        return acc;
      },
      { protein: 0, carbs: 0, fat: 0 }
    );

    const burned = burnLogs.reduce((sum, log) => sum + toSafeNumber(log.caloriesBurned), 0);
    const target = toSafeNumber(user?.maintenanceCalories) || toSafeNumber(user?.goalCalories) || 2000;
    const remaining = target - consumed;

    const meals = {
      breakfast: [],
      lunch: [],
      dinner: [],
      snacks: [],
    };

    for (const log of logs) {
      meals[normalizeMealType(log.mealType || log.meal)].push(log);
    }

    return res.status(200).json({
      targetCalories: target,
      consumedCalories: Math.round(consumed),
      remainingCalories: Math.round(remaining),
      caloriesBurned: Math.round(burned),
      macros: {
        protein: Number(macros.protein.toFixed(1)),
        carbs: Number(macros.carbs.toFixed(1)),
        fat: Number(macros.fat.toFixed(1)),
      },
      meals,
      logs,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch daily calories', error: error.message });
  }
};

export const getCaloriesWeekly = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { days, start, end } = getDayRange(6);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const [foodAgg, burnAgg] = await Promise.all([
      FoodLog.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            date: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
            calories: { $sum: { $ifNull: ['$caloriesConsumed', '$calories'] } },
          },
        },
      ]),
      BurnLog.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            date: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
            caloriesBurned: { $sum: '$caloriesBurned' },
          },
        },
      ]),
    ]);

    const intakeMap = {};
    const burnMap = {};

    for (const item of foodAgg) intakeMap[item._id] = Math.round(toSafeNumber(item.calories));
    for (const item of burnAgg) burnMap[item._id] = Math.round(toSafeNumber(item.caloriesBurned));

    const intakeTrend = [];
    const burnedTrend = [];

    for (const day of days) {
      const key = day.toISOString().split('T')[0];
      const label = dayNames[day.getDay()];
      intakeTrend.push({ day: label, calories: intakeMap[key] || 0 });
      burnedTrend.push({ day: label, calories: burnMap[key] || 0 });
    }

    return res.status(200).json({ intakeTrend, burnedTrend });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch weekly calories', error: error.message });
  }
};

export const getCaloriesMacros = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const logs = await FoodLog.find({ userId, date: { $gte: startOfDay() } }).lean();
    const totals = logs.reduce(
      (acc, log) => {
        acc.protein += toSafeNumber(log.protein);
        acc.carbs += toSafeNumber(log.carbs);
        acc.fat += toSafeNumber(log.fat);
        return acc;
      },
      { protein: 0, carbs: 0, fat: 0 }
    );

    return res.status(200).json({
      protein: Number(totals.protein.toFixed(1)),
      carbs: Number(totals.carbs.toFixed(1)),
      fat: Number(totals.fat.toFixed(1)),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch macros', error: error.message });
  }
};

export const getCaloriesBurn = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const [logs, user] = await Promise.all([
      BurnLog.find({ userId, date: { $gte: startOfDay() } }).sort({ createdAt: -1 }).lean(),
      User.findById(userId).select('weight steps stepDistanceKm').lean(),
    ]);
    const manualBurn = logs.reduce((sum, log) => sum + toSafeNumber(log.caloriesBurned), 0);
    const autoWalkingBurn = estimateWalkingBurn({
      weightKg: user?.weight,
      distanceKm: user?.stepDistanceKm,
      steps: user?.steps,
    });
    const total = manualBurn + autoWalkingBurn;

    return res.status(200).json({
      totalCaloriesBurned: Math.round(total),
      manualCaloriesBurned: Math.round(manualBurn),
      walkingCaloriesBurned: Math.round(autoWalkingBurn),
      source: 'manual-plus-auto-walking',
      logs,
      count: logs.length,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch burn data', error: error.message });
  }
};

export const getStepsToday = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await User.findById(userId).select('steps stepDistanceKm');
    if (!user) return res.status(404).json({ message: 'User not found' });

    return res.status(200).json({
      steps: toSafeNumber(user.steps),
      distanceKm: Number(toSafeNumber(user.stepDistanceKm).toFixed(2)),
      integration: {
        provider: 'mock',
        syncAvailable: false,
        next: 'google-fit-or-apple-health-adapter',
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch steps', error: error.message });
  }
};
