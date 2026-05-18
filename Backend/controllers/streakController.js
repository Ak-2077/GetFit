import NutritionStreak from '../models/nutritionStreak.js';
import FoodLog from '../models/foodLog.js';
import User from '../models/user.js';

// ─── HELPERS ────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function calcCompletion(consumed, target) {
  if (!target || target <= 0) return 0;
  return Math.round((consumed / target) * 100);
}

function calcOverallScore(cal, pro, water, fat) {
  const calPct = Math.min(calcCompletion(cal.consumed, cal.target), 100);
  const proPct = Math.min(calcCompletion(pro.consumed, pro.target), 100);
  const waterPct = Math.min(calcCompletion(water.consumed, water.target), 100);
  const fatPct = Math.min(calcCompletion(fat.consumed, fat.target), 100);
  return Math.round((calPct + proPct + waterPct + fatPct) / 4);
}

// Raw score (can exceed 100) for display purposes
function calcRawScore(cal, pro, water, fat) {
  const calPct = calcCompletion(cal.consumed, cal.target);
  const proPct = calcCompletion(pro.consumed, pro.target);
  const waterPct = calcCompletion(water.consumed, water.target);
  const fatPct = calcCompletion(fat.consumed, fat.target);
  return Math.round((calPct + proPct + waterPct + fatPct) / 4);
}

async function computeStreaks(userId) {
  // Get all streak docs sorted by date descending
  const allDocs = await NutritionStreak.find({ userId })
    .sort({ date: -1 })
    .select('date streakQualified')
    .lean();

  if (!allDocs.length) return { currentStreak: 0, longestStreak: 0 };

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  // Build a set of qualified dates
  const qualifiedSet = new Set();
  for (const doc of allDocs) {
    if (doc.streakQualified) qualifiedSet.add(doc.date);
  }

  // Walk backward from today
  const today = new Date();
  let checkDate = new Date(today);
  let foundFirst = false;

  for (let i = 0; i < 365; i++) {
    const ds = checkDate.toISOString().slice(0, 10);
    if (qualifiedSet.has(ds)) {
      if (!foundFirst) foundFirst = true;
      currentStreak = foundFirst ? currentStreak + 1 : 0;
      tempStreak++;
    } else {
      if (foundFirst) break; // streak broken
    }
    checkDate.setDate(checkDate.getDate() - 1);
  }

  // Longest streak: scan all dates
  const sortedDates = allDocs
    .filter(d => d.streakQualified)
    .map(d => d.date)
    .sort();

  let runLength = 0;
  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) {
      runLength = 1;
    } else {
      const prev = new Date(sortedDates[i - 1]);
      const curr = new Date(sortedDates[i]);
      const diffMs = curr.getTime() - prev.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      runLength = diffDays === 1 ? runLength + 1 : 1;
    }
    longestStreak = Math.max(longestStreak, runLength);
  }

  return { currentStreak, longestStreak };
}

// ─── GET MONTHLY STREAK ─────────────────────────────────

/**
 * GET /api/streaks/monthly?month=2026-05
 * Returns all streak entries for the given month + stats.
 */
export async function getMonthlyStreak(req, res) {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const month = req.query.month || todayStr().slice(0, 7); // YYYY-MM
    const startDate = `${month}-01`;
    // End of month
    const [year, mon] = month.split('-').map(Number);
    const lastDay = new Date(year, mon, 0).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    const streaks = await NutritionStreak.find({
      userId,
      date: { $gte: startDate, $lte: endDate },
    })
      .sort({ date: 1 })
      .lean();

    // Compute streak stats
    const { currentStreak, longestStreak } = await computeStreaks(userId);

    // Monthly completion average
    const qualified = streaks.filter(s => s.streakQualified).length;
    const totalDays = streaks.length || 1;
    const monthlyCompletion = Math.round((qualified / totalDays) * 100);

    return res.json({
      month,
      days: streaks,
      currentStreak,
      longestStreak,
      monthlyCompletion,
      totalDaysLogged: streaks.length,
      totalDaysQualified: qualified,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch streaks' });
  }
}

// ─── UPDATE STREAK ──────────────────────────────────────

/**
 * POST /api/streaks/update
 * Recalculates today's streak from food logs + user profile targets.
 * Body: { water?: number } — optional water intake in liters.
 */
export async function updateStreak(req, res) {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const date = todayStr();
    const { water: waterConsumed } = req.body || {};

    // Fetch user profile for targets
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const calTarget = Number(user.goalCalories || user.maintenanceCalories || 2000);
    const proTarget = Number(user.dailyProteinTarget || 120);
    const userWeight = Number(user.weight || 70);
    const waterTarget = Math.round(userWeight * 0.033 * 10) / 10 || 2.5;
    // Fat target: ~25% of calorie target / 9 kcal per gram
    const fatTarget = Math.round((calTarget * 0.25) / 9);

    // Fetch today's food logs to compute consumed macros
    const todayStart = new Date(`${date}T00:00:00.000Z`);
    const todayEnd = new Date(`${date}T23:59:59.999Z`);

    const foodLogs = await FoodLog.find({
      userId,
      date: { $gte: todayStart, $lte: todayEnd },
    }).lean();

    let totalCal = 0;
    let totalPro = 0;
    let totalFat = 0;

    for (const log of foodLogs) {
      totalCal += Number(log.caloriesConsumed || log.calories || 0);
      totalPro += Number(log.protein || 0);
      totalFat += Number(log.fat || 0);
    }

    const cal = { consumed: totalCal, target: calTarget };
    const pro = { consumed: totalPro, target: proTarget };
    const fatData = { consumed: totalFat, target: fatTarget };

    // Water: use provided value or try to load from existing streak doc
    let waterVal = 0;
    if (waterConsumed !== undefined && waterConsumed !== null) {
      waterVal = Number(waterConsumed);
    } else {
      // Preserve existing water value if not provided
      const existing = await NutritionStreak.findOne({ userId, date }).lean();
      waterVal = existing?.water?.consumed || 0;
    }
    const waterData = { consumed: waterVal, target: waterTarget };

    const completionScore = calcRawScore(cal, pro, waterData, fatData);
    const cappedScore = calcOverallScore(cal, pro, waterData, fatData);
    const streakQualified = cappedScore >= 50;

    const streak = await NutritionStreak.findOneAndUpdate(
      { userId, date },
      {
        userId,
        date,
        calories: cal,
        protein: pro,
        water: waterData,
        fat: fatData,
        completionScore,
        streakQualified,
      },
      { upsert: true, new: true }
    );

    return res.json({ message: 'Streak updated', streak });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update streak' });
  }
}

// ─── GET DAY STREAK ─────────────────────────────────────

/**
 * GET /api/streaks/day/:date
 * Returns a single day's streak details.
 */
export async function getDayStreak(req, res) {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { date } = req.params;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const streak = await NutritionStreak.findOne({ userId, date }).lean();

    if (!streak) {
      return res.json({
        date,
        found: false,
        calories: { consumed: 0, target: 0 },
        protein: { consumed: 0, target: 0 },
        water: { consumed: 0, target: 0 },
        fat: { consumed: 0, target: 0 },
        completionScore: 0,
        streakQualified: false,
      });
    }

    return res.json({ ...streak, found: true });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch day streak' });
  }
}
