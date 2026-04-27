import mongoose from 'mongoose';

const foodLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    foodId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Food',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: 1,
    },
    servings: {
      type: Number,
      default: 1,
    },
    date: {
      type: Date,
      default: new Date().setHours(0, 0, 0, 0),
    },
    meal: {
      type: String,
      enum: ['breakfast', 'lunch', 'dinner', 'snack', 'snacks'],
      default: 'snack',
    },
    mealType: {
      type: String,
      enum: ['breakfast', 'lunch', 'dinner', 'snack', 'snacks'],
      default: 'snack',
    },
    servingText: {
      type: String,
      default: '',
      trim: true,
    },
    servingUnit: {
      type: String,
      default: '',
      trim: true,
    },
    caloriesConsumed: Number,
    calories: {
      type: Number,
      default: 0,
    },
    protein: {
      type: Number,
      default: 0,
    },
    carbs: {
      type: Number,
      default: 0,
    },
    fat: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Compound index for efficient weekly calorie aggregation
foodLogSchema.index({ userId: 1, date: 1 });
foodLogSchema.index({ userId: 1, mealType: 1, date: 1 });

export default mongoose.model('FoodLog', foodLogSchema);

