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
      enum: ['macro_calculation', 'meal_plan', 'workout_plan', 'reasoning_chain', 'tool_result', 'tdee_calculation', 'coaching_response', 'intent_plan'],
      required: true,
    },

    // Input that generated this cache
    input: { type: mongoose.Schema.Types.Mixed },

    // Cached output
    output: { type: mongoose.Schema.Types.Mixed, required: true },

    // Semantic matching — embedding of the input query for fuzzy cache hits
    embedding: { type: [Number], default: [] },
    intent: { type: String, default: '' },

    // Metadata
    hitCount: { type: Number, default: 0 },
    confidence: { type: Number, default: 0.8, min: 0, max: 1 },
    qualityScore: { type: Number, default: 0.7, min: 0, max: 1 },
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
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `${type}:${Math.abs(hash).toString(36)}`;
};

/**
 * Static: semantic cache lookup — find similar cached responses by embedding.
 * Returns best match above similarity threshold, or null.
 */
reasoningCacheSchema.statics.semanticLookup = async function (userId, queryEmbedding, intent, threshold = 0.88) {
  if (!queryEmbedding || queryEmbedding.length === 0) return null;

  const candidates = await this.find({
    userId,
    intent,
    expiresAt: { $gt: new Date() },
    embedding: { $exists: true, $not: { $size: 0 } },
    qualityScore: { $gte: 0.6 },
  }).sort({ hitCount: -1 }).limit(20).lean();

  if (candidates.length === 0) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const c of candidates) {
    if (!c.embedding || c.embedding.length !== queryEmbedding.length) continue;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < queryEmbedding.length; i++) {
      dot += queryEmbedding[i] * c.embedding[i];
      magA += queryEmbedding[i] ** 2;
      magB += c.embedding[i] ** 2;
    }
    const sim = magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
    if (sim > bestScore && sim >= threshold) {
      bestScore = sim;
      bestMatch = c;
    }
  }

  if (bestMatch) {
    await this.findByIdAndUpdate(bestMatch._id, {
      $inc: { hitCount: 1 },
      $set: { lastAccessedAt: new Date() },
    });
    return { output: bestMatch.output, similarity: bestScore, hitCount: bestMatch.hitCount + 1 };
  }

  return null;
};

/**
 * Static: store a response with its embedding for future semantic matching.
 */
reasoningCacheSchema.statics.setCacheWithEmbedding = async function (userId, cacheKey, cacheType, input, output, embedding, intent, ttlHours = 24, qualityScore = 0.7) {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  return this.findOneAndUpdate(
    { userId, cacheKey },
    { userId, cacheKey, cacheType, input, output, embedding, intent, expiresAt, confidence: 0.8, qualityScore, hitCount: 0 },
    { upsert: true, returnDocument: 'after' }
  );
};

// Intent-based TTL tiers (hours)
reasoningCacheSchema.statics.TTL_TIERS = {
  macro_calculation: 168,    // 1 week — rarely changes
  tdee_calculation: 168,
  meal_plan: 72,             // 3 days
  workout_plan: 72,
  coaching_response: 12,     // 12 hours — coaching context changes
  reasoning_chain: 24,
  tool_result: 48,
  intent_plan: 4,            // 4 hours — intent patterns shift
};

export default mongoose.model('ReasoningCache', reasoningCacheSchema);
