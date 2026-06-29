/**
 * Portion Learning Model (Stage 5 / 14)
 * ──────────────────────────────────────────────────────────────
 * Stores per-user portion corrections so future estimates personalize.
 * User-specific only — never affects other users / global estimates.
 * ──────────────────────────────────────────────────────────────
 */

import mongoose from 'mongoose';

const portionLearningSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    foodName: { type: String, required: true, trim: true, lowercase: true },
    estimatedWeight: { type: Number, default: 0 },   // last AI estimate
    selectedWeight: { type: Number, default: 0 },     // last user choice
    averageWeight: { type: Number, default: 0 },      // running average of user choices
    timesCorrected: { type: Number, default: 0 },     // how many times user overrode AI
    lastUsed: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

portionLearningSchema.index({ userId: 1, foodName: 1 }, { unique: true });

/**
 * Record a correction and update the running average.
 */
portionLearningSchema.statics.record = async function (userId, foodName, estimatedWeight, selectedWeight) {
  const name = (foodName || '').toLowerCase().trim();
  const existing = await this.findOne({ userId, foodName: name });
  const corrected = Math.abs((estimatedWeight || 0) - (selectedWeight || 0)) > 5;

  if (!existing) {
    return this.create({
      userId, foodName: name,
      estimatedWeight: estimatedWeight || 0,
      selectedWeight: selectedWeight || 0,
      averageWeight: selectedWeight || 0,
      timesCorrected: corrected ? 1 : 0,
      lastUsed: new Date(),
    });
  }

  // Running average weighted toward recent selections
  const n = existing.timesCorrected || 1;
  const newAvg = ((existing.averageWeight * n) + selectedWeight) / (n + 1);
  existing.estimatedWeight = estimatedWeight || existing.estimatedWeight;
  existing.selectedWeight = selectedWeight || existing.selectedWeight;
  existing.averageWeight = Math.round(newAvg);
  if (corrected) existing.timesCorrected = n + 1;
  existing.lastUsed = new Date();
  await existing.save();
  return existing;
};

export default mongoose.model('PortionLearning', portionLearningSchema);
