import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// PROMPT PERFORMANCE — Self-improving prompt system
// Tracks which prompts, routing patterns, coaching styles,
// and response structures perform best. Auto-optimizes over time.
// ═══════════════════════════════════════════════════════════════

const promptVariantSchema = new mongoose.Schema({
  promptId: String, // unique identifier for this variant
  promptType: { type: String, enum: ['system', 'routing', 'reasoning', 'evaluation', 'coaching'], required: true },
  template: String, // the prompt template
  intent: String, // which intent this prompt serves
  
  // Performance metrics
  totalUses: { type: Number, default: 0 },
  positiveOutcomes: { type: Number, default: 0 },
  negativeOutcomes: { type: Number, default: 0 },
  avgConfidence: { type: Number, default: 0.5 },
  avgUserSatisfaction: { type: Number, default: 0.5 },
  
  // Computed score
  performanceScore: { type: Number, default: 0.5 },
  
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: Date.now },
}, { _id: false });

const metaLearningSchema = new mongoose.Schema({
  dimension: String, // 'coaching_style', 'response_length', 'tone', 'structure', etc.
  bestValue: mongoose.Schema.Types.Mixed,
  evidence: { type: Number, default: 0 }, // how many data points support this
  confidence: { type: Number, default: 0.3 },
  lastUpdated: { type: Date, default: Date.now },
}, { _id: false });

const promptPerformanceSchema = new mongoose.Schema({
  // Global (not per-user) — tracks system-wide prompt performance
  scope: { type: String, enum: ['global', 'user'], default: 'global' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },

  // ── Prompt Variants ──
  promptVariants: { type: [promptVariantSchema], default: [] },

  // ── Routing Performance ──
  routingPerformance: {
    intentAccuracy: { type: Map, of: Number, default: {} }, // intent → accuracy
    bestModeByIntent: { type: Map, of: String, default: {} }, // intent → best mode
    toolRoutingAccuracy: { type: Number, default: 0.5 },
  },

  // ── Coaching Style Performance (per-user) ──
  coachingStyleScores: {
    warm: { type: Number, default: 0.5 },
    direct: { type: Number, default: 0.5 },
    technical: { type: Number, default: 0.5 },
    supportive: { type: Number, default: 0.5 },
    motivational: { type: Number, default: 0.5 },
    concise: { type: Number, default: 0.5 },
  },

  // ── Response Structure Performance ──
  responseStructureScores: {
    bulletPoints: { type: Number, default: 0.5 },
    paragraph: { type: Number, default: 0.5 },
    numbered: { type: Number, default: 0.5 },
    tableFormat: { type: Number, default: 0.5 },
    conversational: { type: Number, default: 0.5 },
  },

  // ── Meta Learning Insights ──
  metaInsights: { type: [metaLearningSchema], default: [] },

  // ── Aggregated Stats ──
  totalInteractions: { type: Number, default: 0 },
  totalPositiveFeedback: { type: Number, default: 0 },
  totalNegativeFeedback: { type: Number, default: 0 },
  avgResponseQuality: { type: Number, default: 0.5 },

  lastOptimizedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// ── Statics ──

promptPerformanceSchema.statics.recordOutcome = async function (userId, data) {
  const { promptType, intent, isPositive, confidence, coachingStyle, responseStructure } = data;
  const lr = 0.03; // slow learning rate for stability

  let doc = await this.findOne({ scope: 'user', userId });
  if (!doc) {
    doc = new this({ scope: 'user', userId });
  }

  doc.totalInteractions++;
  if (isPositive) doc.totalPositiveFeedback++;
  else doc.totalNegativeFeedback++;

  // Update coaching style scores
  if (coachingStyle && doc.coachingStyleScores[coachingStyle] !== undefined) {
    const current = doc.coachingStyleScores[coachingStyle];
    doc.coachingStyleScores[coachingStyle] = current + (isPositive ? lr : -lr);
    doc.coachingStyleScores[coachingStyle] = Math.max(0, Math.min(1, doc.coachingStyleScores[coachingStyle]));
  }

  // Update response structure scores
  if (responseStructure && doc.responseStructureScores[responseStructure] !== undefined) {
    const current = doc.responseStructureScores[responseStructure];
    doc.responseStructureScores[responseStructure] = current + (isPositive ? lr : -lr);
    doc.responseStructureScores[responseStructure] = Math.max(0, Math.min(1, doc.responseStructureScores[responseStructure]));
  }

  // Update average quality
  const score = isPositive ? 1 : 0;
  doc.avgResponseQuality = doc.avgResponseQuality * 0.95 + score * 0.05;

  await doc.save();
  return doc;
};

promptPerformanceSchema.statics.getBestConfig = async function (userId, intent) {
  const doc = await this.findOne({ scope: 'user', userId }).lean();
  if (!doc) return { coachingStyle: 'coach', responseStructure: 'conversational' };

  // Find best coaching style
  const styles = doc.coachingStyleScores || {};
  const bestStyle = Object.entries(styles).sort(([, a], [, b]) => b - a)[0];

  // Find best response structure
  const structures = doc.responseStructureScores || {};
  const bestStructure = Object.entries(structures).sort(([, a], [, b]) => b - a)[0];

  return {
    coachingStyle: bestStyle ? bestStyle[0] : 'warm',
    coachingStyleScore: bestStyle ? bestStyle[1] : 0.5,
    responseStructure: bestStructure ? bestStructure[0] : 'conversational',
    responseStructureScore: bestStructure ? bestStructure[1] : 0.5,
    avgQuality: doc.avgResponseQuality || 0.5,
  };
};

promptPerformanceSchema.statics.addMetaInsight = async function (userId, dimension, bestValue, confidence = 0.5) {
  let doc = await this.findOne({ scope: 'user', userId });
  if (!doc) doc = new this({ scope: 'user', userId });

  const existing = doc.metaInsights.find(m => m.dimension === dimension);
  if (existing) {
    existing.bestValue = bestValue;
    existing.evidence++;
    existing.confidence = Math.min(1.0, existing.confidence + 0.05);
    existing.lastUpdated = new Date();
  } else {
    doc.metaInsights.push({ dimension, bestValue, confidence });
  }

  await doc.save();
  return doc;
};

export default mongoose.model('PromptPerformance', promptPerformanceSchema);
