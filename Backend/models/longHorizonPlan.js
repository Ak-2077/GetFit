import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// LONG-HORIZON PLANNER — Persistent proactive coaching state
// Tracks weekly/monthly trends and drives autonomous adaptation
// ═══════════════════════════════════════════════════════════════

const weeklySnapshotSchema = new mongoose.Schema({
  weekStart: Date,
  adherenceRate: { type: Number, default: 0 }, // 0-1
  workoutsCompleted: { type: Number, default: 0 },
  workoutsPlanned: { type: Number, default: 0 },
  nutritionAdherence: { type: Number, default: 0 }, // 0-1
  avgEnergy: { type: Number, default: 0.5 },
  avgRecovery: { type: Number, default: 0.5 },
  avgMotivation: { type: Number, default: 0.5 },
  avgStress: { type: Number, default: 0.3 },
  weightDelta: { type: Number, default: 0 }, // kg change
  sleepQuality: { type: Number, default: 0.5 },
  injuryFlags: [String],
}, { _id: false });

const adaptationSchema = new mongoose.Schema({
  triggeredAt: { type: Date, default: Date.now },
  trigger: String, // 'motivation_decline', 'burnout_risk', 'plateau_detected', etc.
  action: String, // 'reduce_intensity', 'simplify_nutrition', 'change_tone', etc.
  magnitude: { type: Number, default: 0.5 }, // 0-1 how much to adjust
  status: { type: String, enum: ['active', 'expired', 'overridden'], default: 'active' },
  expiresAt: Date,
  userAcknowledged: { type: Boolean, default: false },
}, { _id: false });

const longHorizonPlanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // ── Trend Tracking ──
  weeklySnapshots: { type: [weeklySnapshotSchema], default: [] }, // last 12 weeks
  
  // ── Long-term Metrics ──
  overallAdherence: { type: Number, default: 0.5 }, // rolling 30-day
  motivationTrend: { type: Number, default: 0 }, // -1 to +1 (declining to rising)
  burnoutAccumulation: { type: Number, default: 0 }, // 0-1
  plateauWeeks: { type: Number, default: 0 }, // consecutive weeks with no progress
  habitStability: { type: Number, default: 0.5 }, // 0-1 (how consistent habits are)
  recoveryCyclePhase: { type: String, enum: ['building', 'peaking', 'deload', 'recovery'], default: 'building' },
  
  // ── Current Plan State ──
  currentPhase: { type: String, enum: ['onboarding', 'progressive', 'maintenance', 'deload', 'recovery', 'aggressive'], default: 'onboarding' },
  phaseStartedAt: { type: Date, default: Date.now },
  phaseTargetDuration: { type: Number, default: 28 }, // days
  
  // ── Autonomous Adaptations ──
  activeAdaptations: { type: [adaptationSchema], default: [] },
  adaptationHistory: { type: [adaptationSchema], default: [] },
  
  // ── Proactive Coaching Flags ──
  proactiveFlags: {
    shouldReduceIntensity: { type: Boolean, default: false },
    shouldSimplifyNutrition: { type: Boolean, default: false },
    shouldChangeCoachingTone: { type: Boolean, default: false },
    shouldSuggestDeload: { type: Boolean, default: false },
    shouldCelebrateProgress: { type: Boolean, default: false },
    shouldAddressConsistency: { type: Boolean, default: false },
    suggestedToneShift: { type: String, default: null }, // 'supportive', 'direct', 'motivational'
  },

  // ── Prediction State ──
  predictions: {
    nextWeekAdherence: { type: Number, default: 0.5 },
    burnoutRiskDate: Date,
    plateauBreakthrough: Date,
    goalCompletionEstimate: Date,
    motivationNadir: Date, // lowest expected point
  },

  lastComputedAt: { type: Date, default: Date.now },
  computeVersion: { type: Number, default: 1 },
}, { timestamps: true });

// ── Methods ──

longHorizonPlanSchema.methods.addWeeklySnapshot = function (snapshot) {
  this.weeklySnapshots.push({ weekStart: new Date(), ...snapshot });
  if (this.weeklySnapshots.length > 12) {
    this.weeklySnapshots = this.weeklySnapshots.slice(-12);
  }
  this._recomputeTrends();
  return this.save();
};

longHorizonPlanSchema.methods._recomputeTrends = function () {
  const snaps = this.weeklySnapshots;
  if (snaps.length < 2) return;

  const recent = snaps.slice(-4); // last 4 weeks
  const older = snaps.slice(-8, -4); // 4 weeks before that

  // Overall adherence (rolling 4-week)
  this.overallAdherence = recent.reduce((s, w) => s + w.adherenceRate, 0) / recent.length;

  // Motivation trend
  const recentMotiv = recent.reduce((s, w) => s + w.avgMotivation, 0) / recent.length;
  const olderMotiv = older.length > 0 ? older.reduce((s, w) => s + w.avgMotivation, 0) / older.length : recentMotiv;
  this.motivationTrend = Math.max(-1, Math.min(1, (recentMotiv - olderMotiv) * 5));

  // Burnout accumulation
  const highStressWeeks = recent.filter(w => w.avgStress > 0.7 || w.avgRecovery < 0.3).length;
  this.burnoutAccumulation = Math.min(1.0, this.burnoutAccumulation + highStressWeeks * 0.1 - (4 - highStressWeeks) * 0.05);
  this.burnoutAccumulation = Math.max(0, this.burnoutAccumulation);

  // Plateau detection
  const recentWeight = recent.map(w => w.weightDelta);
  const noProgress = recentWeight.every(d => Math.abs(d) < 0.2);
  this.plateauWeeks = noProgress ? this.plateauWeeks + recent.length : 0;

  // Habit stability
  const adherenceVariance = this._variance(recent.map(w => w.adherenceRate));
  this.habitStability = Math.max(0, 1 - adherenceVariance * 4);

  // Proactive flags
  this.proactiveFlags.shouldReduceIntensity = this.burnoutAccumulation > 0.6 || recent.some(w => w.avgRecovery < 0.3);
  this.proactiveFlags.shouldSimplifyNutrition = this.overallAdherence < 0.4 && this.motivationTrend < 0;
  this.proactiveFlags.shouldChangeCoachingTone = this.motivationTrend < -0.3;
  this.proactiveFlags.shouldSuggestDeload = this.burnoutAccumulation > 0.7 || this.plateauWeeks >= 3;
  this.proactiveFlags.shouldCelebrateProgress = this.motivationTrend > 0.3 && this.overallAdherence > 0.8;
  this.proactiveFlags.shouldAddressConsistency = this.habitStability < 0.3;

  if (this.motivationTrend < -0.3) this.proactiveFlags.suggestedToneShift = 'supportive';
  else if (this.overallAdherence > 0.8) this.proactiveFlags.suggestedToneShift = 'direct';
  else this.proactiveFlags.suggestedToneShift = 'motivational';

  this.lastComputedAt = new Date();
};

longHorizonPlanSchema.methods._variance = function (arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
};

longHorizonPlanSchema.methods.addAdaptation = function (trigger, action, magnitude = 0.5, durationDays = 14) {
  const adaptation = {
    trigger,
    action,
    magnitude,
    expiresAt: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
  };
  this.activeAdaptations.push(adaptation);
  // Expire old adaptations
  this.activeAdaptations = this.activeAdaptations.filter(a => a.expiresAt > new Date());
  return this.save();
};

longHorizonPlanSchema.methods.toContextString = function () {
  const parts = [];
  if (this.motivationTrend < -0.2) parts.push(`Motivation declining (trend: ${this.motivationTrend.toFixed(2)})`);
  if (this.burnoutAccumulation > 0.5) parts.push(`Burnout risk elevated: ${(this.burnoutAccumulation * 100).toFixed(0)}%`);
  if (this.plateauWeeks >= 2) parts.push(`Progress plateau: ${this.plateauWeeks} weeks`);
  if (this.habitStability < 0.4) parts.push(`Habit consistency low: ${(this.habitStability * 100).toFixed(0)}%`);
  parts.push(`Phase: ${this.currentPhase}, Adherence: ${(this.overallAdherence * 100).toFixed(0)}%`);
  
  const flags = this.proactiveFlags;
  if (flags.shouldReduceIntensity) parts.push('→ Reduce intensity recommended');
  if (flags.shouldSimplifyNutrition) parts.push('→ Simplify nutrition recommended');
  if (flags.shouldSuggestDeload) parts.push('→ Deload week recommended');
  if (flags.shouldCelebrateProgress) parts.push('→ Celebrate recent progress');
  
  return parts.join('\n');
};

export default mongoose.model('LongHorizonPlan', longHorizonPlanSchema);
