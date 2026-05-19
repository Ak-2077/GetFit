import mongoose from 'mongoose';

/**
 * ReasoningCache — Stores expensive LLM outputs for reuse.
 * Prevents re-computing identical macro calculations, plans, reasoning chains.
 * TTL-based auto-expiry for freshness.
 */
const reasoningCacheSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    cacheKey: { type: String, required: true, index: true },  // hash of intent + params
    cacheType: {
      type: String,
      enum: ['macro_calculation', 'meal_plan', 'workout_plan', 'reasoning_chain', 'tool_result', 'tdee_calculation'],
      required: true,
    },

    // Input that generated this cache
    input: { type: mongoose.Schema.Types.Mixed },

    // Cached output
    output: { type: mongoose.Schema.Types.Mixed, required: true },

    // Metadata
    hitCount: { type: Number, default: 0 },
    confidence: { type: Number, default: 0.8, min: 0, max: 1 },
    lastAccessedAt: { type: Date, default: Date.now },

    // Auto-expire (TTL)
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

// Compound index for fast lookup
reasoningCacheSchema.index({ userId: 1, cacheKey: 1 }, { unique: true });
reasoningCacheSchema.index({ userId: 1, cacheType: 1 });

/**
 * Static: get cached result or null.
 */
reasoningCacheSchema.statics.getCache = async function (userId, cacheKey) {
  const entry = await this.findOneAndUpdate(
    { userId, cacheKey, expiresAt: { $gt: new Date() } },
    { $inc: { hitCount: 1 }, $set: { lastAccessedAt: new Date() } },
    { returnDocument: 'after' }
  );
  return entry ? entry.output : null;
};

/**
 * Static: set cache entry.
 */
reasoningCacheSchema.statics.setCache = async function (userId, cacheKey, cacheType, input, output, ttlHours = 24) {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  return this.findOneAndUpdate(
    { userId, cacheKey },
    { userId, cacheKey, cacheType, input, output, expiresAt, confidence: 0.8, hitCount: 0 },
    { upsert: true, returnDocument: 'after' }
  );
};

/**
 * Static: generate a cache key from parameters.
 */
reasoningCacheSchema.statics.buildKey = function (type, params) {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  // Simple hash — good enough for cache keys
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `${type}:${Math.abs(hash).toString(36)}`;
};

export default mongoose.model('ReasoningCache', reasoningCacheSchema);
