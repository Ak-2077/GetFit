import OrchestrationHealth from '../models/orchestrationHealth.js';
import PromptPerformance from '../models/promptPerformance.js';

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTICS SERVICE — Orchestration health + auto-recovery
// Monitors pipeline health, detects failures, applies circuit
// breakers, and tracks system performance.
// ═══════════════════════════════════════════════════════════════

/**
 * Record a pipeline stage execution.
 */
export const recordStageExecution = async (stage, startTime, success) => {
  const latencyMs = Date.now() - startTime;
  await OrchestrationHealth.recordPipelineMetric(stage, latencyMs, success).catch(() => {});
  return { stage, latencyMs, success };
};

/**
 * Record an incident (failure, anomaly, safety issue).
 */
export const recordIncident = async (type, severity, description, context = {}) => {
  const recoveryAction = AUTO_RECOVERY_MAP[type] || null;
  await OrchestrationHealth.recordIncident(type, severity, description, context, recoveryAction).catch(() => {});
  return { type, severity, recovered: !!recoveryAction };
};

/**
 * Get current circuit breaker states.
 * Circuit breakers disable failing subsystems to maintain core responsiveness.
 */
export const getCircuitBreakers = async () => {
  return OrchestrationHealth.getCircuitBreakers();
};

/**
 * Get full orchestration health dashboard.
 */
export const getHealthDashboard = async () => {
  const health = await OrchestrationHealth.findOne({ scope: 'global' }).lean();
  if (!health) return { overallHealth: 1.0, status: 'healthy', details: {} };

  let status = 'healthy';
  if (health.overallHealth < 0.7) status = 'degraded';
  if (health.overallHealth < 0.4) status = 'unhealthy';
  if (health.overallHealth < 0.2) status = 'critical';

  return {
    overallHealth: health.overallHealth,
    status,
    subsystems: {
      memory: { health: health.memoryHealth, status: health.memoryHealth > 0.6 ? 'ok' : 'degraded' },
      routing: { health: health.routingHealth, status: health.routingHealth > 0.6 ? 'ok' : 'degraded' },
      tools: { health: health.toolHealth, status: health.toolHealth > 0.6 ? 'ok' : 'degraded' },
      reasoning: { health: health.reasoningHealth, status: health.reasoningHealth > 0.6 ? 'ok' : 'degraded' },
      evaluator: { health: health.evaluatorHealth, status: health.evaluatorHealth > 0.6 ? 'ok' : 'degraded' },
    },
    circuitBreakers: health.circuitBreakers,
    counters: health.counters,
    recentIncidents: (health.recentIncidents || []).slice(-10),
    pipelineMetrics: health.pipelineMetrics,
  };
};

/**
 * Record prompt performance outcome.
 */
export const recordPromptOutcome = async (userId, data) => {
  return PromptPerformance.recordOutcome(userId, data);
};

/**
 * Get best performing configuration for a user.
 */
export const getBestConfig = async (userId, intent) => {
  return PromptPerformance.getBestConfig(userId, intent);
};

/**
 * Meta learning: record an insight about what works.
 */
export const recordMetaInsight = async (userId, dimension, bestValue, confidence = 0.5) => {
  return PromptPerformance.addMetaInsight(userId, dimension, bestValue, confidence);
};

/**
 * Check if a specific subsystem should be skipped (circuit breaker).
 */
export const shouldSkip = async (subsystem) => {
  const breakers = await getCircuitBreakers();
  return breakers[subsystem] || false;
};

/**
 * Wrap a pipeline stage with diagnostics tracking.
 * Auto-records latency, success/failure, and incidents.
 */
export const withDiagnostics = (stageName) => {
  return async (fn) => {
    const start = Date.now();
    try {
      const result = await fn();
      recordStageExecution(stageName, start, true).catch(() => {});
      return { success: true, result, latencyMs: Date.now() - start };
    } catch (err) {
      recordStageExecution(stageName, start, false).catch(() => {});
      recordIncident(
        mapErrorToIncidentType(err, stageName),
        'medium',
        `${stageName}: ${err.message}`,
        { stage: stageName }
      ).catch(() => {});
      return { success: false, result: null, error: err.message, latencyMs: Date.now() - start };
    }
  };
};

// ── Auto-recovery map ──
const AUTO_RECOVERY_MAP = {
  retrieval_failure: 'skip_memory_retrieval_use_profile_only',
  routing_failure: 'use_default_coaching_mode',
  slow_tool: 'skip_tool_use_llm_knowledge',
  timeout: 'return_cached_or_default_response',
  model_error: 'retry_with_fallback_model',
  loop_detected: 'break_loop_return_partial',
  evaluator_rejection: 'use_original_response_with_warning',
};

function mapErrorToIncidentType(err, stage) {
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('ECONNREFUSED')) return 'timeout';
  if (msg.includes('loop') || msg.includes('recursion')) return 'loop_detected';
  if (stage.includes('tool')) return 'slow_tool';
  if (stage.includes('memory') || stage.includes('retrieval')) return 'retrieval_failure';
  if (stage.includes('routing') || stage.includes('intent')) return 'routing_failure';
  if (stage.includes('evaluat')) return 'evaluator_rejection';
  return 'model_error';
}
