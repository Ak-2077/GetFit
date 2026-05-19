import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// ORCHESTRATION HEALTH — Reasoning diagnostics & self-monitoring
// Detects failures, memory pollution, bad prompts, slow tools,
// contradictory reasoning, and auto-recovers when possible.
// ═══════════════════════════════════════════════════════════════

const incidentSchema = new mongoose.Schema({
  type: { type: String, enum: [
    'retrieval_failure', 'memory_pollution', 'routing_failure',
    'low_confidence_output', 'bad_prompt', 'slow_tool',
    'contradictory_reasoning', 'hallucination_detected',
    'evaluator_rejection', 'loop_detected', 'timeout',
    'model_error', 'safety_violation',
  ], required: true },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  description: String,
  context: mongoose.Schema.Types.Mixed,
  recoveryAction: String,
  recovered: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const pipelineMetricSchema = new mongoose.Schema({
  stage: String,
  avgLatencyMs: { type: Number, default: 0 },
  successRate: { type: Number, default: 1.0 },
  totalCalls: { type: Number, default: 0 },
  failedCalls: { type: Number, default: 0 },
  lastFailure: Date,
}, { _id: false });

const orchestrationHealthSchema = new mongoose.Schema({
  scope: { type: String, enum: ['global', 'user'], default: 'global', index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', sparse: true },

  // ── Pipeline Metrics ──
  pipelineMetrics: { type: [pipelineMetricSchema], default: [] },

  // ── Incident Log ──
  recentIncidents: { type: [incidentSchema], default: [] }, // rolling 100

  // ── Aggregate Health ──
  overallHealth: { type: Number, default: 1.0 }, // 0-1
  memoryHealth: { type: Number, default: 1.0 },
  routingHealth: { type: Number, default: 1.0 },
  toolHealth: { type: Number, default: 1.0 },
  reasoningHealth: { type: Number, default: 1.0 },
  evaluatorHealth: { type: Number, default: 1.0 },

  // ── Circuit Breakers ──
  circuitBreakers: {
    toolExecution: { type: Boolean, default: false }, // if true, skip tools
    evaluator: { type: Boolean, default: false }, // if true, skip evaluator
    reasoning: { type: Boolean, default: false }, // if true, use simple reasoning
    simulation: { type: Boolean, default: false }, // if true, skip simulation
  },

  // ── Performance Counters ──
  counters: {
    totalRequests: { type: Number, default: 0 },
    successfulRequests: { type: Number, default: 0 },
    failedRequests: { type: Number, default: 0 },
    avgResponseTimeMs: { type: Number, default: 0 },
    p95ResponseTimeMs: { type: Number, default: 0 },
    hallucinationsCaught: { type: Number, default: 0 },
    safetyViolationsCaught: { type: Number, default: 0 },
    evaluatorRejections: { type: Number, default: 0 },
    autoRecoveries: { type: Number, default: 0 },
  },

  lastHealthCheck: { type: Date, default: Date.now },
}, { timestamps: true });

// ── Statics ──

orchestrationHealthSchema.statics.recordIncident = async function (type, severity, description, context = {}, recoveryAction = null) {
  let doc = await this.findOne({ scope: 'global' });
  if (!doc) doc = new this({ scope: 'global' });

  doc.recentIncidents.push({ type, severity, description, context, recoveryAction, recovered: !!recoveryAction });
  if (doc.recentIncidents.length > 100) {
    doc.recentIncidents = doc.recentIncidents.slice(-100);
  }

  // Update health scores
  doc._recomputeHealth();

  // Update counters
  if (severity === 'critical' || severity === 'high') {
    doc.counters.failedRequests++;
  }
  if (recoveryAction) doc.counters.autoRecoveries++;
  if (type === 'hallucination_detected') doc.counters.hallucinationsCaught++;
  if (type === 'safety_violation') doc.counters.safetyViolationsCaught++;
  if (type === 'evaluator_rejection') doc.counters.evaluatorRejections++;

  await doc.save();
  return doc;
};

orchestrationHealthSchema.statics.recordPipelineMetric = async function (stage, latencyMs, success) {
  let doc = await this.findOne({ scope: 'global' });
  if (!doc) doc = new this({ scope: 'global' });

  let metric = doc.pipelineMetrics.find(m => m.stage === stage);
  if (!metric) {
    doc.pipelineMetrics.push({ stage, avgLatencyMs: latencyMs, successRate: success ? 1 : 0, totalCalls: 1, failedCalls: success ? 0 : 1 });
  } else {
    metric.totalCalls++;
    if (!success) {
      metric.failedCalls++;
      metric.lastFailure = new Date();
    }
    metric.avgLatencyMs = metric.avgLatencyMs * 0.9 + latencyMs * 0.1;
    metric.successRate = 1 - (metric.failedCalls / metric.totalCalls);
  }

  doc.counters.totalRequests++;
  if (success) doc.counters.successfulRequests++;
  doc.counters.avgResponseTimeMs = doc.counters.avgResponseTimeMs * 0.95 + latencyMs * 0.05;

  await doc.save();
};

orchestrationHealthSchema.statics.getCircuitBreakers = async function () {
  const doc = await this.findOne({ scope: 'global' }).lean();
  if (!doc) return { toolExecution: false, evaluator: false, reasoning: false, simulation: false };
  return doc.circuitBreakers;
};

orchestrationHealthSchema.methods._recomputeHealth = function () {
  const recent = this.recentIncidents.slice(-20);
  const typeCount = {};
  recent.forEach(i => { typeCount[i.type] = (typeCount[i.type] || 0) + 1; });

  this.memoryHealth = Math.max(0, 1 - (typeCount.memory_pollution || 0) * 0.2 - (typeCount.retrieval_failure || 0) * 0.1);
  this.routingHealth = Math.max(0, 1 - (typeCount.routing_failure || 0) * 0.15);
  this.toolHealth = Math.max(0, 1 - (typeCount.slow_tool || 0) * 0.1 - (typeCount.timeout || 0) * 0.2);
  this.reasoningHealth = Math.max(0, 1 - (typeCount.contradictory_reasoning || 0) * 0.15 - (typeCount.loop_detected || 0) * 0.3);
  this.evaluatorHealth = Math.max(0, 1 - (typeCount.evaluator_rejection || 0) * 0.05);

  this.overallHealth = (this.memoryHealth + this.routingHealth + this.toolHealth + this.reasoningHealth + this.evaluatorHealth) / 5;

  // Auto circuit breakers
  this.circuitBreakers.toolExecution = this.toolHealth < 0.3;
  this.circuitBreakers.evaluator = this.evaluatorHealth < 0.2;
  this.circuitBreakers.reasoning = this.reasoningHealth < 0.3;
  this.circuitBreakers.simulation = this.toolHealth < 0.4 || this.reasoningHealth < 0.4;

  this.lastHealthCheck = new Date();
};

export default mongoose.model('OrchestrationHealth', orchestrationHealthSchema);
