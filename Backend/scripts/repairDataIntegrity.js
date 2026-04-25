import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Food from '../models/food.js';
import FoodLog from '../models/foodLog.js';
import User from '../models/user.js';

dotenv.config();

const repairDataIntegrity = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const roleRepair = await User.updateMany(
      {
        $or: [{ role: { $exists: false } }, { role: null }, { role: '' }],
      },
      {
        $set: { role: 'user' },
      }
    );

    const validFoodIds = (await Food.find({}).select('_id').lean()).map((f) => f._id);
    const orphanFoodLogs = await FoodLog.find({ foodId: { $nin: validFoodIds } }).select('_id').lean();
    const orphanIds = orphanFoodLogs.map((log) => log._id);

    let removedFoodLogs = { deletedCount: 0 };
    if (orphanIds.length > 0) {
      removedFoodLogs = await FoodLog.deleteMany({ _id: { $in: orphanIds } });
    }

    console.log('✅ Data integrity repair complete');
    console.log(`  - Users role fixed: ${roleRepair.modifiedCount || 0}`);
    console.log(`  - Orphan food logs removed: ${removedFoodLogs.deletedCount || 0}`);
  } catch (error) {
    console.error('❌ Data repair failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

repairDataIntegrity();
