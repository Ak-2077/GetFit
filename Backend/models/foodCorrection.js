import mongoose from 'mongoose';

const foodCorrectionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  imageHash: { type: String, default: '' },
  // What the AI predicted
  aiPrediction: { type: String, required: true },
  aiConfidence: { type: Number, default: 0 },
  // What the user selected instead
  userCorrection: { type: String, required: true },
  // Context
  rawVisionText: { type: String, default: '' },
  detectedIngredients: [{ type: String }],
  visualCues: [{ type: String }],
  // Metadata
  wasAlternativeSelected: { type: Boolean, default: false }, // user picked from top-3
  wasManualEntry: { type: Boolean, default: false }, // user typed manually
}, { timestamps: true });

// Indexes for analytics
foodCorrectionSchema.index({ aiPrediction: 1, userCorrection: 1 });
foodCorrectionSchema.index({ createdAt: -1 });
foodCorrectionSchema.index({ userId: 1, createdAt: -1 });

// ═══ STATIC: Get most corrected foods (global) ═══
foodCorrectionSchema.statics.getMostCorrected = function (limit = 20) {
  return this.aggregate([
    { $group: { _id: '$aiPrediction', correctedTo: { $addToSet: '$userCorrection' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
};

// ═══ STATIC: Get correction mapping for a specific food ═══
foodCorrectionSchema.statics.getCorrectionMap = function (aiPrediction) {
  return this.aggregate([
    { $match: { aiPrediction: aiPrediction.toLowerCase() } },
    { $group: { _id: '$userCorrection', count: { $sum: 1 }, avgConfidence: { $avg: '$aiConfidence' } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);
};

const FoodCorrection = mongoose.model('FoodCorrection', foodCorrectionSchema);
export default FoodCorrection;
