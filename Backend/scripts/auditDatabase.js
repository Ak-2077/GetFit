import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Food from '../models/food.js';
import FoodLog from '../models/foodLog.js';
import BurnLog from '../models/burnLog.js';
import User from '../models/user.js';

dotenv.config();

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const runAudit = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const [foodCount, foodLogCount, burnLogCount, userCount] = await Promise.all([
      Food.countDocuments(),
      FoodLog.countDocuments(),
      BurnLog.countDocuments(),
      User.countDocuments(),
    ]);

    const duplicateBarcodes = await Food.aggregate([
      { $match: { barcode: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$barcode', count: { $sum: 1 }, ids: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);

    const foods = await Food.find({}).select('name brand barcode calories protein carbs fat servingSize source unit userId').lean();
    const invalidFoods = [];

    for (const food of foods) {
      const issues = [];
      if (!food.name || !String(food.name).trim()) issues.push('missing_name');
      if (!isFiniteNumber(food.calories) || food.calories < 0) issues.push('invalid_calories');
      if (food.protein != null && (!isFiniteNumber(food.protein) || food.protein < 0)) issues.push('invalid_protein');
      if (food.carbs != null && (!isFiniteNumber(food.carbs) || food.carbs < 0)) issues.push('invalid_carbs');
      if (food.fat != null && (!isFiniteNumber(food.fat) || food.fat < 0)) issues.push('invalid_fat');
      if (!food.source) issues.push('missing_source');
      if (food.source === 'user' && !food.userId) issues.push('user_source_without_userId');
      if (issues.length > 0) invalidFoods.push({ _id: String(food._id), name: food.name || '-', barcode: food.barcode || '-', issues });
    }

    const foodLogs = await FoodLog.find({}).select('userId foodId quantity caloriesConsumed meal date').lean();
    const userIds = new Set((await User.find({}).select('_id').lean()).map((u) => String(u._id)));
    const foodIds = new Set((await Food.find({}).select('_id').lean()).map((f) => String(f._id)));

    const invalidFoodLogs = [];
    for (const log of foodLogs) {
      const issues = [];
      if (!userIds.has(String(log.userId))) issues.push('missing_user_ref');
      if (!foodIds.has(String(log.foodId))) issues.push('missing_food_ref');
      if (!isFiniteNumber(log.quantity) || log.quantity <= 0) issues.push('invalid_quantity');
      if (log.caloriesConsumed != null && (!isFiniteNumber(log.caloriesConsumed) || log.caloriesConsumed < 0)) issues.push('invalid_caloriesConsumed');
      if (issues.length > 0) invalidFoodLogs.push({ _id: String(log._id), issues });
    }

    const burnLogs = await BurnLog.find({}).select('userId caloriesBurned date').lean();
    const invalidBurnLogs = [];
    for (const log of burnLogs) {
      const issues = [];
      if (!userIds.has(String(log.userId))) issues.push('missing_user_ref');
      if (!isFiniteNumber(log.caloriesBurned) || log.caloriesBurned < 0) issues.push('invalid_caloriesBurned');
      if (!log.date) issues.push('missing_date');
      if (issues.length > 0) invalidBurnLogs.push({ _id: String(log._id), issues });
    }

    const users = await User.find({}).select('email password role').lean();
    const invalidUsers = [];
    for (const user of users) {
      const issues = [];
      if (!user.email || !String(user.email).trim()) issues.push('missing_email');
      if (!user.password || !String(user.password).trim()) issues.push('missing_password');
      if (!user.role) issues.push('missing_role');
      if (issues.length > 0) invalidUsers.push({ _id: String(user._id), email: user.email || '-', issues });
    }

    const report = {
      summary: {
        foods: foodCount,
        foodLogs: foodLogCount,
        burnLogs: burnLogCount,
        users: userCount,
      },
      quality: {
        duplicateBarcodes: duplicateBarcodes.length,
        invalidFoods: invalidFoods.length,
        invalidFoodLogs: invalidFoodLogs.length,
        invalidBurnLogs: invalidBurnLogs.length,
        invalidUsers: invalidUsers.length,
      },
      details: {
        duplicateBarcodes,
        invalidFoods: invalidFoods.slice(0, 30),
        invalidFoodLogs: invalidFoodLogs.slice(0, 30),
        invalidBurnLogs: invalidBurnLogs.slice(0, 30),
        invalidUsers: invalidUsers.slice(0, 30),
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('AUDIT_FAILED', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

runAudit();
