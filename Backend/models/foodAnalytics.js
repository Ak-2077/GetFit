import mongoose from 'mongoose';

const foodAnalyticsSchema = new mongoose.Schema({
  date: { type: Date, required: true, index: true },
  totalScans: { type: Number, default: 0 },
  autoConfirmed: { type: Number, default: 0 },
  userConfirmed: { type: Number, default: 0 },
  userCorrected: { type: Number, default: 0 },
  
  // Track most corrected foods daily
  corrections: [{
    aiPrediction: String,
    userCorrection: String,
    count: Number
  }],
  
  // Track confidence distribution
  confidenceBuckets: {
    high: { type: Number, default: 0 },   // >= 95%
    medium: { type: Number, default: 0 }, // 85% - 95%
    low: { type: Number, default: 0 }     // < 85%
  },
  
  // Accuracy percentage
  accuracyScore: { type: Number, default: 0 }
}, { timestamps: true });

// Method to update daily analytics
foodAnalyticsSchema.statics.logScan = async function(scanData) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { confidence, isCorrected, aiPrediction, userCorrection } = scanData;
  
  const update = {
    $inc: { 
      totalScans: 1,
      autoConfirmed: confidence >= 0.95 && !isCorrected ? 1 : 0,
      userConfirmed: confidence < 0.95 && !isCorrected ? 1 : 0,
      userCorrected: isCorrected ? 1 : 0,
      'confidenceBuckets.high': confidence >= 0.95 ? 1 : 0,
      'confidenceBuckets.medium': confidence >= 0.85 && confidence < 0.95 ? 1 : 0,
      'confidenceBuckets.low': confidence < 0.85 ? 1 : 0
    }
  };

  const analytics = await this.findOneAndUpdate(
    { date: today },
    update,
    { new: true, upsert: true }
  );
  
  if (isCorrected && aiPrediction && userCorrection) {
    const correctionExists = analytics.corrections.find(c => c.aiPrediction === aiPrediction && c.userCorrection === userCorrection);
    
    if (correctionExists) {
      await this.updateOne(
        { date: today, 'corrections.aiPrediction': aiPrediction, 'corrections.userCorrection': userCorrection },
        { $inc: { 'corrections.$.count': 1 } }
      );
    } else {
      await this.updateOne(
        { date: today },
        { $push: { corrections: { aiPrediction, userCorrection, count: 1 } } }
      );
    }
  }
  
  // Update accuracy score
  if (analytics) {
    const accuracy = ((analytics.totalScans - analytics.userCorrected) / Math.max(analytics.totalScans, 1)) * 100;
    await this.updateOne({ date: today }, { $set: { accuracyScore: accuracy } });
  }
};

const FoodAnalytics = mongoose.model('FoodAnalytics', foodAnalyticsSchema);
export default FoodAnalytics;
