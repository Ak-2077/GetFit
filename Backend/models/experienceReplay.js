import mongoose from 'mongoose';

/**
 * ExperienceReplay — Stores corrected, failed, and high-quality responses
 * for continuous learning and autonomous prompt optimization.
 */
const experienceReplaySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // What happened
    userMessage: { type: String, required: true },
    intent: { type: String, required: true },
    mode: { type: String, default: 'coach' },

    // Original response
    originalResponse: { type: String, required: true },
    originalScore: { type: Number, default: 0.5 },

    // Corrected/improved response (if available)
    correctedResponse: { type: String },
    correctedScore: { type: Number },

    // Why it was stored
    replayType: {
      type: String,
      enum: [
        'evaluator_rejection',   // evaluator rejected + regenerated
        'evaluator_revision',    // evaluator said revise
        'reflection_revision',   // self-reflection revised
        'user_negative_feedback', // user thumbs-down
        'user_positive_feedback', // user thumbs-up (exemplar)
        'safety_violation',      // safety flag triggered
        'high_quality',          // high confidence + good feedback
      ],
      required: true,
    },

    // Context at time of response
    pipelineTier: { type: String, enum: ['fast', 'medium', 'deep'] },
    memoriesUsed: { type: Number, default: 0 },
    toolsUsed: [{ type: String }],
    reasoningConfidence: { type: Number },
    evaluatorVerdict: { type: String },

    // Learning signals
    feedbackReason: { type: String },
    revisionGuidance: { type: String },
    issues: [{ type: String }],

    // Has this been replayed/used for improvement?
    replayed: { type: Boolean, default: false },
    replayedAt: { type: Date },
  },
  { timestamps: true }
);

experienceReplaySchema.index({ userId: 1, replayType: 1 });
experienceReplaySchema.index({ replayed: 1, replayType: 1 });
experienceReplaySchema.index({ createdAt: -1 });

/**
 * Static: record an experience for replay.
 */
experienceReplaySchema.statics.recordExperience = async function (data) {
  return this.create(data);
};

/**
 * Static: get unreplayed experiences for learning.
 */
experienceReplaySchema.statics.getUnreplayed = async function (userId, limit = 20) {
  return this.find({ userId, replayed: false })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Static: get exemplar responses (high-quality) for prompt optimization.
 */
experienceReplaySchema.statics.getExemplars = async function (userId, intent, limit = 5) {
  return this.find({
    userId,
    intent,
    replayType: { $in: ['user_positive_feedback', 'high_quality'] },
    correctedScore: { $gte: 0.7 },
  })
    .sort({ correctedScore: -1, createdAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Static: get failure patterns for a specific intent.
 */
experienceReplaySchema.statics.getFailurePatterns = async function (userId, intent, limit = 10) {
  return this.find({
    userId,
    intent,
    replayType: { $in: ['evaluator_rejection', 'user_negative_feedback', 'safety_violation'] },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('userMessage issues revisionGuidance feedbackReason')
    .lean();
};

/**
 * Static: mark experiences as replayed.
 */
experienceReplaySchema.statics.markReplayed = async function (ids) {
  return this.updateMany(
    { _id: { $in: ids } },
    { $set: { replayed: true, replayedAt: new Date() } }
  );
};

/**
 * Static: get learning stats.
 */
experienceReplaySchema.statics.getLearningStats = async function (userId) {
  const [total, unreplayed, byType] = await Promise.all([
    this.countDocuments({ userId }),
    this.countDocuments({ userId, replayed: false }),
    this.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: '$replayType', count: { $sum: 1 }, avgScore: { $avg: '$originalScore' } } },
    ]),
  ]);
  return { total, unreplayed, byType };
};

export default mongoose.model('ExperienceReplay', experienceReplaySchema);
