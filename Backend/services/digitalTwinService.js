import DigitalTwin from '../models/digitalTwin.js';
import { simulatePlan, causalReasoning } from './aiClient.js';

// ═══════════════════════════════════════════════════════════════
// DIGITAL TWIN SERVICE — User behavior modeling + plan simulation
// Powers the simulation engine and autonomous adaptation.
// ═══════════════════════════════════════════════════════════════

/**
 * Get or create digital twin for a user.
 */
export const getOrCreateTwin = async (userId) => {
  let twin = await DigitalTwin.findOne({ userId });
  if (!twin) {
    twin = new DigitalTwin({ userId });
    await twin.save();
  }
  return twin;
};

/**
 * Calibrate digital twin from observed behavior.
 * Called after workout/nutrition data is logged.
 */
export const calibrateTwin = async (userId, observedBehavior) => {
  const twin = await getOrCreateTwin(userId);
  await twin.calibrate(observedBehavior);
  return twin;
};

/**
 * Add a causal link discovered from behavior patterns.
 */
export const addCausalLink = async (userId, cause, effect, strength = 0.5, direction = 'negative') => {
  const twin = await getOrCreateTwin(userId);
  await twin.addCausalLink(cause, effect, strength, direction);
  return twin;
};

/**
 * Add an observed behavior pattern.
 */
export const addBehaviorPattern = async (userId, pattern, context = '') => {
  const twin = await getOrCreateTwin(userId);
  await twin.addPattern(pattern, context);
  return twin;
};

/**
 * Simulate a plan locally using the digital twin model.
 * Fast — no LLM call, pure math from twin parameters.
 */
export const simulatePlanLocal = async (userId, plan) => {
  const twin = await getOrCreateTwin(userId);
  return twin.simulatePlan(plan);
};

/**
 * Simulate a plan using both local twin AND LLM simulation.
 * Returns merged result for higher confidence.
 */
export const simulatePlanFull = async (userId, plan, durationWeeks = 4) => {
  const twin = await getOrCreateTwin(userId);

  // Local simulation (fast, deterministic)
  const localResult = twin.simulatePlan({ ...plan, durationWeeks });

  // LLM simulation (richer, but slower)
  let llmResult = null;
  try {
    const twinParams = {
      tendencies: twin.tendencies,
      recoveryProfile: twin.recoveryProfile,
      motivationModel: twin.motivationModel,
      adherencePatterns: twin.adherencePatterns,
      fatigueBehavior: twin.fatigueBehavior,
    };
    llmResult = await simulatePlan(plan, twinParams, durationWeeks);
  } catch (_) { /* LLM simulation is optional */ }

  // Merge results (weighted average if both available)
  if (llmResult) {
    return {
      adherenceProbability: localResult.adherenceProbability * 0.4 + llmResult.adherence_probability * 0.6,
      burnoutProbability: localResult.burnoutProbability * 0.4 + llmResult.burnout_probability * 0.6,
      sustainabilityScore: localResult.sustainabilityScore * 0.4 + llmResult.sustainability_score * 0.6,
      fatigueAccumulation: localResult.fatigueAccumulation * 0.4 + llmResult.fatigue_accumulation * 0.6,
      estimatedDropoffWeek: Math.round(localResult.estimatedDropoffWeek * 0.4 + llmResult.estimated_dropoff_week * 0.6),
      motivationImpact: llmResult.motivation_impact || 0,
      recoveryImpact: llmResult.recovery_impact || 0,
      recommendations: [...(localResult.recommendations || []), ...(llmResult.recommendations || [])],
      weekByWeek: llmResult.week_by_week || null,
      source: 'hybrid',
      twinAccuracy: twin.simulationAccuracy,
    };
  }

  return { ...localResult, source: 'local', twinAccuracy: twin.simulationAccuracy };
};

/**
 * Run causal analysis on recent observations.
 */
export const analyzeCausalPatterns = async (userId, observations, userState = null) => {
  const twin = await getOrCreateTwin(userId);

  // Get existing causal links for context
  const knownLinks = twin.causalLinks.slice(0, 10).map(l => `${l.cause} → ${l.effect} (strength: ${l.strength.toFixed(1)})`);

  // Combine observations with known causal links
  const enrichedObservations = [...observations];
  if (knownLinks.length > 0) {
    enrichedObservations.push(`Known patterns: ${knownLinks.join(', ')}`);
  }

  try {
    const result = await causalReasoning(enrichedObservations, userState, 'recent');

    // Store new causal links back into twin
    if (result.causal_chains) {
      for (const chain of result.causal_chains) {
        if (chain.chain && chain.chain.length >= 2) {
          const cause = chain.chain[0];
          const effect = chain.chain[chain.chain.length - 1];
          await twin.addCausalLink(cause, effect, chain.strength || 0.5, 'negative');
        }
      }
    }

    return result;
  } catch (_) {
    return { causal_chains: [], root_causes: [], predicted_effects: [], intervention_points: [], confidence: 0 };
  }
};

/**
 * Get digital twin context string for AI prompt injection.
 */
export const getTwinContext = async (userId) => {
  const twin = await getOrCreateTwin(userId);
  const parts = [];

  // Key tendencies
  const t = twin.tendencies;
  if (t.workoutConsistency < 0.4) parts.push('Tends to skip workouts');
  if (t.workoutConsistency > 0.8) parts.push('Very consistent with workouts');
  if (t.nutritionDiscipline < 0.4) parts.push('Struggles with nutrition consistency');
  if (t.motivationVolatility > 0.7) parts.push('Motivation fluctuates significantly');
  if (t.perfectionismLevel > 0.7) parts.push('All-or-nothing mindset — needs flexibility built in');
  if (t.planAdherence < 0.4) parts.push('Prefers flexibility over strict plans');

  // Key causal links
  const strongLinks = twin.causalLinks.filter(l => l.strength > 0.6 && l.observedCount >= 2);
  if (strongLinks.length > 0) {
    parts.push('CAUSAL PATTERNS:');
    strongLinks.slice(0, 5).forEach(l => parts.push(`  ${l.cause} → ${l.effect}`));
  }

  // Recovery profile
  if (twin.recoveryProfile.baseRecoveryRate < 0.4) parts.push('Slow recovery — needs extra rest days');
  if (twin.fatigueBehavior.overtrainingRisk > 0.6) parts.push('Prone to overtraining');

  return parts.join('\n');
};

/**
 * Record prediction outcome for accuracy tracking.
 */
export const recordPredictionResult = async (userId, wasCorrect) => {
  const twin = await getOrCreateTwin(userId);
  await twin.recordPredictionOutcome(wasCorrect);
  return twin.simulationAccuracy;
};
