import mongoose from 'mongoose';
import FoodLog from '../models/foodLog.js';

// ─── GET WEEKLY CALORIES ────────────────────────────────
/**
 * GET /api/user/weekly-calories
 * Returns aggregated daily calories for the last 7 days (Mon–Sun).
 * Uses the existing FoodLog collection — no separate CalorieLogs model needed.
 */
export async function getWeeklyCalories(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Build array of last 7 days (today and 6 days before)
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push(d);
    }

    const startDate = days[0];
    const endDate = new Date(days[6]);
    endDate.setHours(23, 59, 59, 999);

    // Aggregate calories by date from FoodLog
    const pipeline = [
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          date: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$date' },
          },
          calories: { $sum: '$caloriesConsumed' },
        },
      },
    ];

    const results = await FoodLog.aggregate(pipeline);

    // Build a map of date-string → calories
    const calorieMap = {};
    for (const r of results) {
      calorieMap[r._id] = Math.round(r.calories || 0);
    }

    // Day names
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Map to response format
    const data = days.map((d) => {
      const key = d.toISOString().split('T')[0];
      return {
        day: dayNames[d.getDay()],
        calories: calorieMap[key] || 0,
      };
    });

    return res.json({ data });
  } catch (error) {
    console.error('Weekly calories error:', error);
    return res.status(500).json({ message: error.message || 'Failed to fetch weekly calories' });
  }
}
