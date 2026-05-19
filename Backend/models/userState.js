import mongoose from 'mongoose';

/**
 * UserState — Continuously updated holistic user state for adaptive coaching.
 * The AI reasons against this state to dynamically adjust recommendations.
 */
const userStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    // ── Physical State (0.0 = very low, 1.0 = optimal) ──
    energy: { type: Number, default: 0.5, min: 0, max: 1 },
    recovery: { type: Number, default: 0.5, min: 0, max: 1 },
    fatigue: { type: Number, default: 0.3, min: 0, max: 1 },
    sleepQuality: { type: Number, default: 0.5, min: 0, max: 1 },

    // ── Behavioral State ──
    adherence: { type: Number, default: 0.5, min: 0, max: 1 },       // how well user follows plans
    consistency: { type: Number, default: 0.5, min: 0, max: 1 },     // regularity of engagement
    motivation: { type: Number, default: 0.5, min: 0, max: 1 },
    stress: { type: Number, default: 0.3, min: 0, max: 1 },

    // ── Risk Assessment ──
    injuryRisk: { type: Number, default: 0.1, min: 0, max: 1 },
    burnoutRisk: { type: Number, default: 0.1, min: 0, max: 1 },
    plateauRisk: { type: Number, default: 0.1, min: 0, max: 1 },

    // ── Training Metrics ──
    trainingMomentum: { type: Number, default: 0.5, min: 0, max: 1 }, // trending up or down
    volumeLoad: { type: String, enum: ['low', 'moderate', 'high', 'excessive'], default: 'moderate' },
    recommendedIntensity: { type: String, enum: ['deload', 'light', 'moderate', 'high', 'peak'], default: 'moderate' },

    // ── Signals (raw inputs that update state) ──
    signals: [{
      type: { type: String, enum: ['workout_logged', 'meal_logged', 'feedback', 'missed_day', 'injury_report', 'sleep_report', 'mood_report', 'goal_change'] },
      value: mongoose.Schema.Types.Mixed,
      timestamp: { type: Date, default: Date.now },
    }],

    // ── Predictions ──
    predictions: {
      likelyBurnout: { type: Boolean, default: false },
      likelyPlanAbandonment: { type: Boolean, default: false },
      motivationDrop: { type: Boolean, default: false },
      readyForProgression: { type: Boolean, default: false },
    },

    // ── Last computed ──
    lastComputedAt: { type: Date, default: Date.now },
    computeVersion: { type: Number, default: 1 },
  },
  { timestamps: true }
);

userStateSchema.index({ userId: 1 });

// ── Methods ──

/**
 * Add a signal and recompute state.
 */
userStateSchema.methods.addSignal = function (signalType, value = {}) {
  this.signals.push({ type: signalType, value, timestamp: new Date() });

  // Keep only last 50 signals
  if (this.signals.length > 50) {
    this.signals = this.signals.slice(-50);
  }

  // Recompute state based on recent signals
  this._recompute();
  return this.save();
};

/**
 * Internal: recompute all state dimensions from recent signals.
 */
userStateSchema.methods._recompute = function () {
  const now = Date.now();
  const recent = this.signals.filter(s => now - new Date(s.timestamp).getTime() < 7 * 24 * 60 * 60 * 1000);
  const DECAY = 0.02; // slight decay per compute towards neutral

  // Count signal types in last 7 days
  const counts = {};
  for (const s of recent) {
    counts[s.type] = (counts[s.type] || 0) + 1;
  }

  // ── Adherence: based on workouts + meals logged vs expected ──
  const workoutsLogged = counts.workout_logged || 0;
  const mealsLogged = counts.meal_logged || 0;
  const missedDays = counts.missed_day || 0;
  const expectedWorkouts = 4; // baseline expectation per week
  this.adherence = Math.max(0, Math.min(1, workoutsLogged / expectedWorkouts));
  this.consistency = Math.max(0, Math.min(1, (workoutsLogged + mealsLogged) / 10));

  // ── Recovery / Fatigue ──
  if (workoutsLogged > 5) {
    this.fatigue = Math.min(1, this.fatigue + 0.1);
    this.recovery = Math.max(0, this.recovery - 0.1);
  } else if (workoutsLogged <= 2) {
    this.fatigue = Math.max(0, this.fatigue - 0.05);
    this.recovery = Math.min(1, this.recovery + 0.1);
  }

  // ── Injury signals ──
  if (counts.injury_report) {
    this.injuryRisk = Math.min(1, this.injuryRisk + 0.2 * counts.injury_report);
  } else {
    this.injuryRisk = Math.max(0, this.injuryRisk - DECAY);
  }

  // ── Motivation from feedback ──
  const feedbackSignals = recent.filter(s => s.type === 'feedback');
  const positives = feedbackSignals.filter(s => s.value?.positive).length;
  const negatives = feedbackSignals.filter(s => !s.value?.positive).length;
  if (feedbackSignals.length > 0) {
    const ratio = positives / feedbackSignals.length;
    this.motivation = 0.7 * this.motivation + 0.3 * ratio;
  }

  // ── Burnout / Plateau risk ──
  this.burnoutRisk = Math.max(0, Math.min(1,
    (this.fatigue * 0.4) + (1 - this.motivation) * 0.3 + this.stress * 0.3
  ));
  this.plateauRisk = Math.max(0, Math.min(1,
    (1 - this.trainingMomentum) * 0.5 + (1 - this.adherence) * 0.5
  ));

  // ── Predictions ──
  this.predictions.likelyBurnout = this.burnoutRisk > 0.6;
  this.predictions.likelyPlanAbandonment = this.adherence < 0.3 && missedDays > 3;
  this.predictions.motivationDrop = this.motivation < 0.3;
  this.predictions.readyForProgression = this.adherence > 0.7 && this.recovery > 0.6 && this.fatigue < 0.4;

  // ── Recommended intensity ──
  if (this.burnoutRisk > 0.7 || this.injuryRisk > 0.6) {
    this.recommendedIntensity = 'deload';
  } else if (this.fatigue > 0.7 || this.recovery < 0.3) {
    this.recommendedIntensity = 'light';
  } else if (this.predictions.readyForProgression) {
    this.recommendedIntensity = 'high';
  } else {
    this.recommendedIntensity = 'moderate';
  }

  this.lastComputedAt = new Date();
  this.computeVersion += 1;
};

/**
 * Build a compact state string for injection into AI context.
 */
userStateSchema.methods.toContextString = function () {
  const parts = [];

  if (this.recommendedIntensity !== 'moderate') {
    parts.push(`Recommended intensity: ${this.recommendedIntensity}`);
  }
  if (this.injuryRisk > 0.4) parts.push(`Injury risk: ${(this.injuryRisk * 100).toFixed(0)}%`);
  if (this.burnoutRisk > 0.5) parts.push(`Burnout risk: HIGH`);
  if (this.predictions.likelyPlanAbandonment) parts.push(`Warning: user may abandon plan`);
  if (this.predictions.motivationDrop) parts.push(`Motivation declining`);
  if (this.predictions.readyForProgression) parts.push(`Ready for progression`);
  if (this.fatigue > 0.6) parts.push(`Fatigue level: high`);
  if (this.recovery < 0.3) parts.push(`Recovery: poor`);
  if (this.adherence < 0.3) parts.push(`Adherence: low — simplify plans`);

  return parts.length > 0 ? parts.join('. ') : '';
};

export default mongoose.model('UserState', userStateSchema);
