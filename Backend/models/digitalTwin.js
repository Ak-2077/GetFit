import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// DIGITAL TWIN — Persistent user behavior simulation model
// Models HOW the user behaves, not just what they say.
// Powers plan simulation and autonomous adaptation.
// ═══════════════════════════════════════════════════════════════

const behaviorPatternSchema = new mongoose.Schema({
  pattern: String,
  frequency: { type: Number, default: 1 }, // times observed
  confidence: { type: Number, default: 0.5 },
  firstSeen: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  context: String, // when this pattern occurs
}, { _id: false });

const causalLinkSchema = new mongoose.Schema({
  cause: String,
  effect: String,
  strength: { type: Number, default: 0.5 }, // 0-1 correlation strength
  observedCount: { type: Number, default: 1 },
  direction: { type: String, enum: ['positive', 'negative', 'neutral'], default: 'neutral' },
  examples: [String], // specific instances
}, { _id: false });

const digitalTwinSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // ── Behavioral Tendencies ──
  tendencies: {
    workoutConsistency: { type: Number, default: 0.5 }, // 0=skip-prone, 1=never-miss
    nutritionDiscipline: { type: Number, default: 0.5 }, // 0=frequent-breaks, 1=strict
    recoveryAwareness: { type: Number, default: 0.5 }, // 0=ignores-signals, 1=listens
    stressReactivity: { type: Number, default: 0.5 }, // 0=resilient, 1=highly-reactive
    motivationVolatility: { type: Number, default: 0.5 }, // 0=steady, 1=boom-bust
    planAdherence: { type: Number, default: 0.5 }, // 0=improviser, 1=follows-plans
    socialInfluence: { type: Number, default: 0.3 }, // 0=independent, 1=socially-driven
    perfectionismLevel: { type: Number, default: 0.3 }, // 0=relaxed, 1=all-or-nothing
  },

  // ── Recovery Profile ──
  recoveryProfile: {
    baseRecoveryRate: { type: Number, default: 0.5 }, // how fast they recover
    sleepSensitivity: { type: Number, default: 0.7 }, // how much sleep affects performance
    stressImpactOnRecovery: { type: Number, default: 0.5 }, // how stress slows recovery
    optimalRestDays: { type: Number, default: 2 }, // per week
    deloadFrequency: { type: Number, default: 4 }, // weeks between deloads
  },

  // ── Motivation Model ──
  motivationModel: {
    intrinsicDrive: { type: Number, default: 0.5 }, // self-motivated vs external
    progressSensitivity: { type: Number, default: 0.7 }, // how much progress affects motivation
    varietyNeed: { type: Number, default: 0.5 }, // boredom susceptibility
    accountabilityNeed: { type: Number, default: 0.5 }, // needs external push
    celebrationResponse: { type: Number, default: 0.5 }, // how much praise helps
    criticismTolerance: { type: Number, default: 0.5 }, // handles direct feedback
    burnoutRecoveryTime: { type: Number, default: 14 }, // days to bounce back
  },

  // ── Adherence Patterns ──
  adherencePatterns: {
    bestDaysOfWeek: [{ type: Number }], // 0=Sun, 6=Sat
    worstDaysOfWeek: [{ type: Number }],
    typicalDropoffWeek: { type: Number, default: 3 }, // week when adherence typically drops
    weekendBehavior: { type: String, enum: ['consistent', 'relaxed', 'derailed'], default: 'relaxed' },
    travelImpact: { type: Number, default: 0.7 }, // 0=no-impact, 1=complete-stop
    stressResponse: { type: String, enum: ['exercise_more', 'exercise_less', 'eat_more', 'eat_less', 'mixed'], default: 'mixed' },
  },

  // ── Fatigue Behavior ──
  fatigueBehavior: {
    fatigueThreshold: { type: Number, default: 0.7 }, // when they start skipping
    overtrainingRisk: { type: Number, default: 0.3 }, // tendency to overtrain
    volumeTolerance: { type: Number, default: 0.5 }, // 0=low-volume, 1=high-volume
    intensityPreference: { type: Number, default: 0.5 }, // 0=easy, 1=hard
    restDayCompliance: { type: Number, default: 0.5 }, // actually rests on rest days
  },

  // ── Causal Links (learned cause-effect relationships) ──
  causalLinks: { type: [causalLinkSchema], default: [] },

  // ── Observed Behavior Patterns ──
  observedPatterns: { type: [behaviorPatternSchema], default: [] },

  // ── Simulation Parameters ──
  simulationAccuracy: { type: Number, default: 0.5 }, // how well predictions match reality
  totalPredictions: { type: Number, default: 0 },
  correctPredictions: { type: Number, default: 0 },

  lastCalibratedAt: { type: Date, default: Date.now },
  calibrationCount: { type: Number, default: 0 },
}, { timestamps: true });

// ── Methods ──

digitalTwinSchema.methods.addCausalLink = function (cause, effect, strength = 0.5, direction = 'negative') {
  const existing = this.causalLinks.find(l => l.cause === cause && l.effect === effect);
  if (existing) {
    existing.observedCount++;
    existing.strength = Math.min(1.0, existing.strength + 0.05);
    existing.direction = direction;
  } else {
    this.causalLinks.push({ cause, effect, strength, direction, observedCount: 1 });
    if (this.causalLinks.length > 50) {
      this.causalLinks = this.causalLinks.sort((a, b) => b.observedCount - a.observedCount).slice(0, 40);
    }
  }
  return this.save();
};

digitalTwinSchema.methods.addPattern = function (pattern, context = '') {
  const existing = this.observedPatterns.find(p => p.pattern === pattern);
  if (existing) {
    existing.frequency++;
    existing.lastSeen = new Date();
    existing.confidence = Math.min(1.0, existing.confidence + 0.05);
  } else {
    this.observedPatterns.push({ pattern, context, confidence: 0.4 });
    if (this.observedPatterns.length > 100) {
      this.observedPatterns = this.observedPatterns.sort((a, b) => b.frequency - a.frequency).slice(0, 80);
    }
  }
  return this.save();
};

digitalTwinSchema.methods.recordPredictionOutcome = function (wasCorrect) {
  this.totalPredictions++;
  if (wasCorrect) this.correctPredictions++;
  this.simulationAccuracy = this.correctPredictions / Math.max(1, this.totalPredictions);
  return this.save();
};

/**
 * Simulate adherence probability for a given plan.
 * @param {object} plan - { workoutsPerWeek, intensity, nutritionStrictness, durationWeeks }
 * @returns {object} simulation result
 */
digitalTwinSchema.methods.simulatePlan = function (plan) {
  const { workoutsPerWeek = 4, intensity = 0.6, nutritionStrictness = 0.5, durationWeeks = 4 } = plan;

  // Base adherence from tendencies
  let adherenceProb = this.tendencies.planAdherence;

  // Intensity adjustment
  if (intensity > this.fatigueBehavior.intensityPreference + 0.2) {
    adherenceProb *= 0.8; // too hard
  }

  // Volume adjustment
  const volumeScore = workoutsPerWeek / 7;
  if (volumeScore > this.fatigueBehavior.volumeTolerance) {
    adherenceProb *= 0.75;
  }

  // Nutrition strictness
  if (nutritionStrictness > this.tendencies.nutritionDiscipline + 0.2) {
    adherenceProb *= 0.85;
  }

  // Duration fatigue (longer plans = more dropout)
  const durationFactor = Math.max(0.5, 1 - (durationWeeks - 2) * 0.05);
  adherenceProb *= durationFactor;

  // Motivation volatility impact
  adherenceProb *= (1 - this.tendencies.motivationVolatility * 0.3);

  // Perfectionism penalty (all-or-nothing people quit when imperfect)
  if (this.tendencies.perfectionismLevel > 0.7) {
    adherenceProb *= 0.85;
  }

  // Fatigue accumulation simulation
  const weeklyFatigue = intensity * workoutsPerWeek * 0.1;
  const recoveryPerWeek = this.recoveryProfile.baseRecoveryRate * this.recoveryProfile.optimalRestDays * 0.15;
  const netFatigue = Math.max(0, weeklyFatigue - recoveryPerWeek);
  const cumulativeFatigue = netFatigue * durationWeeks;

  // Burnout probability
  const burnoutProb = Math.min(1.0, cumulativeFatigue * (1 + this.tendencies.stressReactivity));

  // Sustainability score
  const sustainability = Math.max(0, adherenceProb - burnoutProb * 0.5);

  return {
    adherenceProbability: Math.max(0, Math.min(1, adherenceProb)),
    burnoutProbability: Math.max(0, Math.min(1, burnoutProb)),
    sustainabilityScore: Math.max(0, Math.min(1, sustainability)),
    fatigueAccumulation: cumulativeFatigue,
    estimatedDropoffWeek: Math.max(1, Math.round(this.adherencePatterns.typicalDropoffWeek * adherenceProb)),
    recommendations: this._generateSimRecommendations(adherenceProb, burnoutProb, sustainability, plan),
  };
};

digitalTwinSchema.methods._generateSimRecommendations = function (adherence, burnout, sustainability, plan) {
  const recs = [];
  if (adherence < 0.5) recs.push('Reduce workout frequency or intensity');
  if (burnout > 0.5) recs.push('Add planned deload weeks');
  if (sustainability < 0.4) recs.push('Simplify the plan significantly');
  if (plan.nutritionStrictness > 0.7 && this.tendencies.nutritionDiscipline < 0.5) {
    recs.push('Use flexible nutrition approach instead of strict tracking');
  }
  if (plan.workoutsPerWeek > 5 && this.fatigueBehavior.volumeTolerance < 0.5) {
    recs.push('Reduce to 3-4 sessions per week');
  }
  return recs;
};

digitalTwinSchema.methods.calibrate = function (actualBehavior) {
  const lr = 0.1; // learning rate for calibration
  
  if (actualBehavior.workoutAdherence !== undefined) {
    this.tendencies.workoutConsistency += (actualBehavior.workoutAdherence - this.tendencies.workoutConsistency) * lr;
  }
  if (actualBehavior.nutritionAdherence !== undefined) {
    this.tendencies.nutritionDiscipline += (actualBehavior.nutritionAdherence - this.tendencies.nutritionDiscipline) * lr;
  }
  if (actualBehavior.motivationLevel !== undefined) {
    const delta = actualBehavior.motivationLevel - 0.5;
    this.tendencies.motivationVolatility += (Math.abs(delta) - this.tendencies.motivationVolatility) * lr;
  }

  this.lastCalibratedAt = new Date();
  this.calibrationCount++;
  return this.save();
};

export default mongoose.model('DigitalTwin', digitalTwinSchema);
