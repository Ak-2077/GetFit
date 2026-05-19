import mongoose from 'mongoose';

const userMemorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ── Memory Hierarchy Level ──
    memoryLevel: {
      type: Number,
      enum: [1, 2, 3, 4],
      default: 2,
      // L1: Core Identity — very slow decay (goal, allergies, injuries, diet pref)
      // L2: Long-term Evolving — medium decay (weight, maxes, routine, progress)
      // L3: Short-term Context — fast decay, 24-72h TTL (sore, tired, traveling)
      // L4: Session — destroyed on session end (temp clarifications)
    },

    // ── Memory Classification ──
    category: {
      type: String,
      enum: [
        "injury", "goal", "preference", "body_stats", "experience",
        "limitation", "achievement", "routine", "nutrition",
        "progress", "episodic", "other",
      ],
      required: true,
    },

    memoryType: {
      type: String,
      enum: ["static", "evolving", "temporal"],
      default: "static",
    },

    // ── Core Content ──
    fact: { type: String, required: true },

    // ── Importance Score (0-10) ──
    importanceScore: {
      type: Number, default: 5, min: 0, max: 10,
      // 10: life-threatening (peanut allergy)
      // 9: core goal, chronic injury
      // 7: response style, preferences
      // 5: general fact
      // 3: temporary context
      // 1: trivial
    },

    // ── Scoring Fields ──
    confidence: { type: Number, default: 0.8, min: 0, max: 1 },
    hitCount: { type: Number, default: 0 },
    lastAccessedAt: { type: Date, default: Date.now },
    relevanceScore: { type: Number, default: 1.0 },

    // ── Embedding Vector (for cosine similarity retrieval) ──
    embedding: { type: [Number], default: [] },

    // ── Versioning (for evolving facts) ──
    version: { type: Number, default: 1 },
    previousFact: { type: String, default: null },
    supersedesId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserMemory",
      default: null,
    },

    // ── Source Tracking (trust hierarchy) ──
    sourceSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatSession",
    },
    source: {
      type: String,
      enum: [
        "explicit_user_statement",  // highest trust — user directly stated
        "ai_extracted",             // LLM inferred from conversation
        "inferred_behavior",        // derived from patterns
        "feedback_learning",        // learned from thumbs up/down
        "system_generated",         // synced from user profile
        "user_confirmed",           // user verified an extracted fact
        // legacy compat
        "extracted", "profile_sync", "feedback",
      ],
      default: "ai_extracted",
    },

    // ── Status ──
    active: { type: Boolean, default: true },
    userConfirmed: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },

    // ── Memory Truth Engine ──
    evidenceCount: { type: Number, default: 1 }, // times this fact was independently confirmed
    reinforcementHistory: [{
      sessionId: mongoose.Schema.Types.ObjectId,
      timestamp: { type: Date, default: Date.now },
      source: String,
      confidenceDelta: Number,
    }],
    contradictionHistory: [{
      contradictingFact: String,
      sessionId: mongoose.Schema.Types.ObjectId,
      timestamp: { type: Date, default: Date.now },
      resolution: { type: String, enum: ['kept', 'superseded', 'merged', 'unresolved'], default: 'unresolved' },
    }],
    confidenceTrend: { type: Number, default: 0 }, // -1 to +1 (declining to rising)
    sourceReliability: { type: Number, default: 0.7 }, // 0-1 how reliable the source was
    lastVerifiedAt: { type: Date, default: null },
    verificationCount: { type: Number, default: 0 },
    truthScore: { type: Number, default: 0.7 }, // composite truth score
    needsVerification: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// ── Indexes ──
userMemorySchema.index({ userId: 1, active: 1, memoryLevel: 1, relevanceScore: -1 });
userMemorySchema.index({ userId: 1, category: 1, active: 1 });
userMemorySchema.index({ userId: 1, fact: 1 }, { unique: true });
userMemorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
userMemorySchema.index({ userId: 1, active: 1, importanceScore: -1 });

// ── Methods ──

userMemorySchema.methods.recordAccess = function () {
  this.hitCount += 1;
  this.lastAccessedAt = new Date();
  this.relevanceScore = Math.min(2.0, this.relevanceScore + 0.1 * (1 / Math.log2(this.hitCount + 2)));
  return this.save();
};

userMemorySchema.methods.supersede = function (newFact, sessionId) {
  this.previousFact = this.fact;
  this.fact = newFact;
  this.version += 1;
  this.sourceSessionId = sessionId;
  this.confidence = Math.min(1.0, this.confidence + 0.05);
  this.lastAccessedAt = new Date();
  this.embedding = []; // clear stale embedding — will be re-computed
  return this.save();
};

// ── Statics ──

// Hierarchy-aware decay: L1 decays 1%/week, L2 5%/week, L3 20%/week
userMemorySchema.statics.applyDecay = async function (userId) {
  const now = Date.now();
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const staleDate = new Date(now - WEEK);

  const decayLevels = [
    { level: 1, rate: 0.99, floor: 0.3 },
    { level: 2, rate: 0.95, floor: 0.1 },
    { level: 3, rate: 0.80, floor: 0.1 },
  ];

  for (const { level, rate, floor } of decayLevels) {
    const stale = await this.find({
      userId, active: true, memoryLevel: level,
      lastAccessedAt: { $lt: staleDate },
    }).select('_id relevanceScore');

    for (const mem of stale) {
      const newScore = Math.max(floor, (mem.relevanceScore || 1) * rate);
      await this.updateOne({ _id: mem._id }, { $set: { relevanceScore: newScore } });
    }
  }
};

// Ranked retrieval with composite score: importance * relevance * confidence * recency
userMemorySchema.statics.getActiveMemories = async function (userId, limit = 30) {
  const now = new Date();
  return this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), active: true, memoryLevel: { $ne: 4 } } },
    {
      $addFields: {
        daysSinceAccess: { $divide: [{ $subtract: [now, "$lastAccessedAt"] }, 86400000] },
        recencyBoost: { $max: [0.2, { $subtract: [1, { $divide: [{ $subtract: [now, "$lastAccessedAt"] }, 2592000000] }] }] },
        compositeScore: {
          $multiply: [
            { $divide: ["$importanceScore", 10] },
            "$relevanceScore",
            "$confidence",
            { $max: [0.2, { $subtract: [1, { $divide: [{ $subtract: [now, "$lastAccessedAt"] }, 2592000000] }] }] },
          ],
        },
      },
    },
    { $sort: { compositeScore: -1 } },
    { $limit: limit },
  ]);
};

// Clean up L4 session memories for a specific session
userMemorySchema.statics.clearSessionMemories = async function (userId, sessionId) {
  await this.deleteMany({ userId, memoryLevel: 4, sourceSessionId: sessionId });
};

export default mongoose.model('UserMemory', userMemorySchema);
