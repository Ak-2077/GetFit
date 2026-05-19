import LongHorizonPlan from '../models/longHorizonPlan.js';
import PersistentReasoning from '../models/persistentReasoning.js';
import UserState from '../models/userState.js';

// ═══════════════════════════════════════════════════════════════
// PLANNER SERVICE — Long-horizon planning + autonomous adaptation
// Proactively adapts coaching without user asking.
// ═══════════════════════════════════════════════════════════════

/**
 * Get or create the long-horizon plan for a user.
 */
export const getOrCreatePlan = async (userId) => {
  let plan = await LongHorizonPlan.findOne({ userId });
  if (!plan) {
    plan = new LongHorizonPlan({ userId });
    await plan.save();
  }
  return plan;
};

/**
 * Get or create persistent reasoning state.
 */
export const getOrCreateReasoning = async (userId) => {
  let reasoning = await PersistentReasoning.findOne({ userId });
  if (!reasoning) {
    reasoning = new PersistentReasoning({ userId });
    await reasoning.save();
  }
  return reasoning;
};

/**
 * Record a weekly snapshot from aggregated user data.
 * Called by a scheduled job or after session end.
 */
export const recordWeeklySnapshot = async (userId, snapshotData) => {
  const plan = await getOrCreatePlan(userId);
  await plan.addWeeklySnapshot(snapshotData);
  return plan;
};

/**
 * Check if autonomous adaptations should fire.
 * Returns list of triggered adaptations.
 */
export const checkAutonomousAdaptations = async (userId) => {
  const plan = await getOrCreatePlan(userId);
  const state = await UserState.findOne({ userId });
  if (!plan || !state) return [];

  const newAdaptations = [];

  // Motivation declining for 2+ weeks → reduce difficulty + change tone
  if (plan.motivationTrend < -0.2 && plan.weeklySnapshots.length >= 2) {
    const recentMotivations = plan.weeklySnapshots.slice(-2).map(w => w.avgMotivation);
    if (recentMotivations.every(m => m < 0.4)) {
      if (!plan.activeAdaptations.find(a => a.trigger === 'motivation_decline' && a.status === 'active')) {
        newAdaptations.push({
          trigger: 'motivation_decline',
          action: 'reduce_intensity_and_simplify',
          magnitude: 0.6,
          durationDays: 14,
        });
      }
    }
  }

  // Burnout accumulation high → suggest deload
  if (plan.burnoutAccumulation > 0.65) {
    if (!plan.activeAdaptations.find(a => a.trigger === 'burnout_risk' && a.status === 'active')) {
      newAdaptations.push({
        trigger: 'burnout_risk',
        action: 'suggest_deload_week',
        magnitude: 0.8,
        durationDays: 7,
      });
    }
  }

  // Plateau detected (3+ weeks) → change strategy
  if (plan.plateauWeeks >= 3) {
    if (!plan.activeAdaptations.find(a => a.trigger === 'plateau_detected' && a.status === 'active')) {
      newAdaptations.push({
        trigger: 'plateau_detected',
        action: 'change_training_strategy',
        magnitude: 0.5,
        durationDays: 21,
      });
    }
  }

  // Habit instability → simplify everything
  if (plan.habitStability < 0.3 && plan.overallAdherence < 0.4) {
    if (!plan.activeAdaptations.find(a => a.trigger === 'habit_instability' && a.status === 'active')) {
      newAdaptations.push({
        trigger: 'habit_instability',
        action: 'simplify_all_recommendations',
        magnitude: 0.7,
        durationDays: 14,
      });
    }
  }

  // Apply new adaptations
  for (const adapt of newAdaptations) {
    await plan.addAdaptation(adapt.trigger, adapt.action, adapt.magnitude, adapt.durationDays);
  }

  return newAdaptations;
};

/**
 * Get the proactive coaching context string for injection into prompts.
 */
export const getProactiveContext = async (userId) => {
  const [plan, reasoning] = await Promise.all([
    getOrCreatePlan(userId),
    getOrCreateReasoning(userId),
  ]);

  const parts = [];

  // Long-horizon plan context
  const planContext = plan.toContextString();
  if (planContext) parts.push(planContext);

  // Persistent reasoning context
  const reasoningContext = reasoning.toContextString();
  if (reasoningContext) parts.push(reasoningContext);

  // Active adaptations
  const active = plan.activeAdaptations.filter(a => a.status === 'active' && a.expiresAt > new Date());
  if (active.length > 0) {
    parts.push('ACTIVE ADAPTATIONS:');
    active.forEach(a => parts.push(`  [${a.trigger}] → ${a.action} (mag: ${a.magnitude})`));
  }

  return parts.join('\n');
};

/**
 * Update persistent reasoning after a conversation.
 */
export const updateReasoningState = async (userId, sessionId, updates) => {
  const reasoning = await getOrCreateReasoning(userId);

  if (updates.newAssumptions) {
    for (const a of updates.newAssumptions) {
      await reasoning.addAssumption(a.fact, a.confidence, a.source);
    }
  }

  if (updates.resolvedQuestions) {
    for (const q of updates.resolvedQuestions) {
      await reasoning.resolveQuestion(q.question, q.resolution);
    }
  }

  if (updates.newUnresolved) {
    for (const q of updates.newUnresolved) {
      await reasoning.addUnresolved(q.question, q.context, q.priority);
    }
  }

  if (updates.strategyUpdate) {
    const s = updates.strategyUpdate;
    await reasoning.setStrategy(s.domain, s.strategy, s.rationale, s.confidence);
  }

  if (updates.conclusions || updates.openThreads) {
    reasoning.lastReasoningChain = {
      sessionId,
      topic: updates.topic || 'general',
      conclusions: updates.conclusions || [],
      openThreads: updates.openThreads || [],
      timestamp: new Date(),
    };
    reasoning.totalReasoningCycles++;
    reasoning.lastActiveAt = new Date();
    await reasoning.save();
  }

  return reasoning;
};

/**
 * Get coaching tone adjustment based on current plan state.
 */
export const getCoachingToneAdjustment = async (userId) => {
  const plan = await getOrCreatePlan(userId);
  if (!plan) return null;

  const flags = plan.proactiveFlags;
  if (!flags) return null;

  return {
    suggestedTone: flags.suggestedToneShift || 'coach',
    shouldCelebrate: flags.shouldCelebrateProgress,
    shouldSimplify: flags.shouldSimplifyNutrition || flags.shouldReduceIntensity,
    shouldDeload: flags.shouldSuggestDeload,
    shouldAddressConsistency: flags.shouldAddressConsistency,
    burnoutLevel: plan.burnoutAccumulation,
    motivationTrend: plan.motivationTrend,
  };
};
