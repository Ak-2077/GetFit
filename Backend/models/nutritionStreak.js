import mongoose from 'mongoose';

const nutritionStreakSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    date: {
      type: String, // YYYY-MM-DD
      required: true,
    },
    calories: {
      consumed: { type: Number, default: 0 },
      target: { type: Number, default: 2000 },
    },
    protein: {
      consumed: { type: Number, default: 0 },
      target: { type: Number, default: 120 },
    },
    water: {
      consumed: { type: Number, default: 0 },
      target: { type: Number, default: 2.5 },
    },
    fat: {
      consumed: { type: Number, default: 0 },
      target: { type: Number, default: 70 },
    },
    completionScore: {
      type: Number,
      default: 0,
    },
    streakQualified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

nutritionStreakSchema.index({ userId: 1, date: 1 }, { unique: true });
nutritionStreakSchema.index({ userId: 1, date: -1 });

export default mongoose.model('NutritionStreak', nutritionStreakSchema);
