/**
 * CalorieReconciliationEngine.ts
 * ──────────────────────────────────────────────────────────────
 * Pure, stateless reconciliation policy for steps + calories.
 *
 * Given (current_value, incoming_value), decides:
 *   - accept the new value, OR
 *   - hold the old value (mark as syncing, optionally retry).
 *
 * Rules (from product spec):
 *   • A drop is REJECTED only when ALL are true:
 *       1) same calendar day
 *       2) drop magnitude > 15%
 *       3) new source confidence is LOWER than previous
 *       4) data is not newer (timestamp ≤ previous)
 *       5) no explicit recalculation hint set on incoming
 *
 *   • Otherwise accept. This means a higher-confidence source can
 *     freely correct an inflated estimate downward, jitter under
 *     15% is allowed within a source, and within-source corrections
 *     with fresher timestamps are accepted.
 *
 *   • Drastic same-source drops (e.g. HK 400→150 from stale partial
 *     sync) are flagged with `suggestRetry: true` so the caller can
 *     schedule a single retry before exposing the value to the UI.
 * ──────────────────────────────────────────────────────────────
 */

import type { FitnessSource } from './FitnessStore';

export interface MetricSnapshot {
  value: number;
  source: FitnessSource;
  confidence: number;
  /** ms since epoch — when the upstream measurement was produced */
  timestamp: number;
  /** True when the value comes from an estimator (non-measured) */
  estimated: boolean;
}

export interface IncomingMetric extends MetricSnapshot {
  /** Optional hint from caller that this represents a HK recalculation
   *  (e.g. background observer fired indicating fresh sync). When true,
   *  drops are accepted unconditionally. */
  recalculation?: boolean;
}

export interface ReconciliationDecision {
  /** Should the store accept the new value? */
  accept: boolean;
  /** Human-readable reason (for logs / debug UI) */
  reason: string;
  /** Caller should retry the fetch once after a short delay */
  suggestRetry: boolean;
}

/* ---------- Constants ---------- */

const DROP_TOLERANCE_PCT = 0.15;       // <=15% drop = accepted as jitter
const DRASTIC_DROP_PCT = 0.40;         // >=40% same-source drop = suspicious → retry
const SAME_SOURCE_FRESH_DROP_PCT = 0.30; // accept <=30% within-source if newer

/* ---------- Engine ---------- */

class _CalorieReconciliationEngine {
  /**
   * Decide whether to accept an incoming metric value.
   * Pure function — no side effects.
   */
  reconcile(
    current: MetricSnapshot | null,
    incoming: IncomingMetric
  ): ReconciliationDecision {
    // First-ever value or cleared state — always accept.
    if (!current || current.value <= 0) {
      return { accept: true, reason: 'first-value', suggestRetry: false };
    }

    // Day changed → caller should have reset; accept regardless.
    if (!sameLocalDay(current.timestamp, incoming.timestamp)) {
      return { accept: true, reason: 'day-changed', suggestRetry: false };
    }

    // Rising values or equal → always accept.
    if (incoming.value >= current.value) {
      return { accept: true, reason: 'monotonic-up', suggestRetry: false };
    }

    // Explicit recalculation hint (e.g. HK observer with fresh sync) → trust it.
    if (incoming.recalculation) {
      return {
        accept: true,
        reason: 'explicit-recalculation',
        suggestRetry: false,
      };
    }

    const dropPct = (current.value - incoming.value) / current.value;

    // Small drop within tolerance → accept (normal jitter / dedup correction).
    if (dropPct <= DROP_TOLERANCE_PCT) {
      return { accept: true, reason: `jitter-${pct(dropPct)}`, suggestRetry: false };
    }

    // Higher-confidence source correcting an inflated estimate → accept.
    if (incoming.confidence > current.confidence) {
      return {
        accept: true,
        reason: `higher-confidence ${current.confidence}→${incoming.confidence}`,
        suggestRetry: false,
      };
    }

    // Same source, newer data, moderate drop → accept (within-source correction).
    if (
      incoming.source === current.source &&
      incoming.confidence === current.confidence &&
      incoming.timestamp > current.timestamp &&
      dropPct <= SAME_SOURCE_FRESH_DROP_PCT
    ) {
      return {
        accept: true,
        reason: `same-source-fresh-correction-${pct(dropPct)}`,
        suggestRetry: false,
      };
    }

    // Drastic same-source drop → likely stale partial sync. Hold & retry.
    if (
      incoming.source === current.source &&
      incoming.confidence === current.confidence &&
      dropPct >= DRASTIC_DROP_PCT
    ) {
      return {
        accept: false,
        reason: `stale-sync-suspected-${pct(dropPct)}`,
        suggestRetry: true,
      };
    }

    // Lower-confidence source trying to overwrite — reject.
    if (incoming.confidence < current.confidence) {
      return {
        accept: false,
        reason: `lower-confidence ${current.confidence}→${incoming.confidence}`,
        suggestRetry: false,
      };
    }

    // Default: same/lower confidence, no fresher timestamp, drop > tolerance → hold.
    return {
      accept: false,
      reason: `unjustified-drop-${pct(dropPct)}`,
      suggestRetry: false,
    };
  }
}

/* ---------- Helpers ---------- */

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function sameLocalDay(a: number, b: number): boolean {
  if (!a || !b) return true; // unknown — don't trigger reset based on this
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Singleton */
export const CalorieReconciliationEngine = new _CalorieReconciliationEngine();
