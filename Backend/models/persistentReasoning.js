import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// PERSISTENT REASONING STATE — Multi-session reasoning continuity
// Maintains unresolved thoughts, active strategies, assumptions,
// and planning context across conversations.
// ═══════════════════════════════════════════════════════════════

const assumptionSchema = new mongoose.Schema({
  fact: { type: String, required: true },
  confidence: { type: Number, default: 0.7 },
  source: { type: String, enum: ['user_stated', 'inferred', 'tool_derived', 'pattern_detected'], default: 'inferred' },
  createdAt: { type: Date, default: Date.now },
  verifiedAt: Date,
  invalidatedAt: Date,
  active: { type: Boolean, default: true },
}, { _id: false });

const unresolvedSchema = new mongoose.Schema({
  question: String,
  context: String,
  priority: { type: Number, default: 5 }, // 1-10
  createdAt: { type: Date, default: Date.now },
  resolvedAt: Date,
  resolution: String,
  status: { type: String, enum: ['open', 'resolved', 'abandoned'], default: 'open' },
}, { _id: false });

const strategySchema = new mongoose.Schema({
  domain: { type: String, enum: ['workout', 'nutrition', 'recovery', 'motivation', 'habit', 'overall'], required: true },
  strategy: String,
  rationale: String,
  confidence: { type: Number, default: 0.6 },
  activeSince: { type: Date, default: Date.now },
  lastValidated: { type: Date, default: Date.now },
  performanceScore: { type: Number, default: 0.5 }, // 0-1 how well strategy is working
  adjustmentCount: { type: Number, default: 0 },
}, { _id: false });

const planningContextSchema = new mongoose.Schema({
  topic: String,
  phase: { type: String, enum: ['gathering_info', 'analyzing', 'planning', 'presenting', 'iterating', 'finalized'], default: 'gathering_info' },
  collectedFacts: [String],
  pendingQuestions: [String],
  draftPlan: mongoose.Schema.Types.Mixed,
  lastUpdated: { type: Date, default: Date.now },
  sessionId: mongoose.Schema.Types.ObjectId,
}, { _id: false });

const persistentReasoningSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // ── Active Assumptions ──
  assumptions: { type: [assumptionSchema], default: [] },

  // ── Unresolved Reasoning ──
  unresolvedQuestions: { type: [unresolvedSchema], default: [] },

  // ── Current Strategies ──
  activeStrategies: { type: [strategySchema], default: [] },

  // ── Multi-turn Planning ──
  activePlanningContexts: { type: [planningContextSchema], default: [] },

  // ── Pending Clarifications ──
  pendingClarifications: [{
    question: String,
    importance: { type: Number, default: 5 },
    askedCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  }],

  // ── Reasoning Continuity ──
  lastReasoningChain: {
    sessionId: mongoose.Schema.Types.ObjectId,
    topic: String,
    conclusions: [String],
    openThreads: [String],
    timestamp: Date,
  },

  // ── Meta State ──
  reasoningDepth: { type: Number, default: 1 }, // 1-5, increases with complex conversations
  totalReasoningCycles: { type: Number, default: 0 },
  lastActiveAt: { type: Date, default: Date.now },
}, { timestamps: true });

// ── Methods ──

persistentReasoningSchema.methods.addAssumption = function (fact, confidence = 0.7, source = 'inferred') {
  // Check for existing similar assumption
  const existing = this.assumptions.find(a => a.active && a.fact.toLowerCase() === fact.toLowerCase());
  if (existing) {
    existing.confidence = Math.min(1.0, existing.confidence + 0.1);
    existing.verifiedAt = new Date();
  } else {
    this.assumptions.push({ fact, confidence, source });
    if (this.assumptions.length > 50) {
      // Remove oldest low-confidence assumptions
      this.assumptions = this.assumptions
        .filter(a => a.active)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 40);
    }
  }
  return this.save();
};

persistentReasoningSchema.methods.invalidateAssumption = function (fact) {
  const assumption = this.assumptions.find(a => a.active && a.fact.toLowerCase().includes(fact.toLowerCase()));
  if (assumption) {
    assumption.active = false;
    assumption.invalidatedAt = new Date();
  }
  return this.save();
};

persistentReasoningSchema.methods.addUnresolved = function (question, context = '', priority = 5) {
  this.unresolvedQuestions.push({ question, context, priority });
  if (this.unresolvedQuestions.filter(q => q.status === 'open').length > 20) {
    // Abandon lowest priority
    const open = this.unresolvedQuestions.filter(q => q.status === 'open');
    open.sort((a, b) => a.priority - b.priority);
    open[0].status = 'abandoned';
  }
  return this.save();
};

persistentReasoningSchema.methods.resolveQuestion = function (question, resolution) {
  const q = this.unresolvedQuestions.find(u => u.status === 'open' && u.question.includes(question));
  if (q) {
    q.status = 'resolved';
    q.resolvedAt = new Date();
    q.resolution = resolution;
  }
  return this.save();
};

persistentReasoningSchema.methods.setStrategy = function (domain, strategy, rationale, confidence = 0.6) {
  const existing = this.activeStrategies.find(s => s.domain === domain);
  if (existing) {
    existing.strategy = strategy;
    existing.rationale = rationale;
    existing.confidence = confidence;
    existing.lastValidated = new Date();
    existing.adjustmentCount++;
  } else {
    this.activeStrategies.push({ domain, strategy, rationale, confidence });
  }
  return this.save();
};

persistentReasoningSchema.methods.toContextString = function () {
  const parts = [];

  // Active strategies
  const strategies = this.activeStrategies.filter(s => s.confidence > 0.4);
  if (strategies.length > 0) {
    parts.push('ACTIVE STRATEGIES:');
    strategies.forEach(s => parts.push(`  [${s.domain}] ${s.strategy} (confidence: ${s.confidence.toFixed(1)})`));
  }

  // Key assumptions
  const assumptions = this.assumptions.filter(a => a.active && a.confidence > 0.6).slice(0, 8);
  if (assumptions.length > 0) {
    parts.push('KEY ASSUMPTIONS:');
    assumptions.forEach(a => parts.push(`  - ${a.fact}`));
  }

  // Unresolved questions (high priority)
  const unresolved = this.unresolvedQuestions.filter(q => q.status === 'open' && q.priority >= 7);
  if (unresolved.length > 0) {
    parts.push('UNRESOLVED:');
    unresolved.forEach(q => parts.push(`  ? ${q.question}`));
  }

  // Pending clarifications
  if (this.pendingClarifications?.length > 0) {
    const pending = this.pendingClarifications.filter(c => c.askedCount < 2).slice(0, 3);
    if (pending.length > 0) {
      parts.push('NEED TO ASK:');
      pending.forEach(c => parts.push(`  → ${c.question}`));
    }
  }

  return parts.join('\n');
};

export default mongoose.model('PersistentReasoning', persistentReasoningSchema);
