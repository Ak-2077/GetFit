import mongoose from 'mongoose';

const foodMemorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  foodName: { type: String, required: true },
  normalizedName: { type: String, default: '' },
  foodId: { type: mongoose.Schema.Types.ObjectId, ref: 'Food' },
  // Frequency tracking
  logCount: { type: Number, default: 1 },
  lastLoggedAt: { type: Date, default: Date.now },
  // Typical usage
  typicalQuantity: { type: Number, default: 1 },
  typicalUnit: { type: String, default: 'serving' },
  typicalMealType: { type: String, enum: ['breakfast', 'lunch', 'dinner', 'snack'], default: 'lunch' },
  // AI correction tracking
  aiDetectedName: { type: String, default: '' },
  userCorrectedName: { type: String, default: '' },
  correctionCount: { type: Number, default: 0 },
  // Nutrition snapshot (per 100g)
  calories: { type: Number },
  protein: { type: Number },
  carbs: { type: Number },
  fat: { type: Number },
  // Meta
  source: { type: String, enum: ['scan', 'manual', 'barcode'], default: 'manual' },
  cuisine: { type: String, default: 'general' },
  isFavorite: { type: Boolean, default: false },
}, { timestamps: true });

// Compound index for quick lookup
foodMemorySchema.index({ userId: 1, foodName: 1 }, { unique: true });
foodMemorySchema.index({ userId: 1, logCount: -1 });
foodMemorySchema.index({ userId: 1, lastLoggedAt: -1 });

const FoodMemory = mongoose.model('FoodMemory', foodMemorySchema);
export default FoodMemory;
