/**
 * StepManager.ts
 * ──────────────────────────────────────────────────────────────
 * Manages step count retrieval with HealthKit priority + backend fallback.
 *
 * • Tries HealthKit first (HKStatisticsQuery, cumulativeSum)
 * • Falls back to backend API on non-iOS or HealthKit failure
 * • Throttles queries to max 1 per 10 seconds
 * • Caches last known value — never returns a lower value within a day
 * ──────────────────────────────────────────────────────────────
 */

import { HealthKitService } from './HealthKitService';
import { getStepsToday } from '../api';
import { FitnessSource } from './FitnessStore';

/* ---------- Types ---------- */

export interface StepResult {
  steps: number;
  distanceKm: number;
  source: FitnessSource;
}

/* ---------- Constants ---------- */

const THROTTLE_MS = 10_000; // Minimum interval between fetches
const STRIDE_KM = 0.000762; // Average stride length in km

/* ---------- Manager ---------- */

class _StepManager {
  private _lastFetch = 0;
  private _lastValue: StepResult = { steps: 0, distanceKm: 0, source: 'none' };
  private _fetching = false;

  /**
   * Fetch current step count.
   * Returns cached value if throttled or if a fetch is already in progress.
   */
  async fetch(force = false): Promise<StepResult> {
    const now = Date.now();

    // Throttle guard
    if (!force && now - this._lastFetch < THROTTLE_MS) {
      console.log(
        `[StepManager] throttled: skipping (last: ${Math.round((now - this._lastFetch) / 1000)}s ago)`
      );
      return this._lastValue;
    }

    // Re-entrancy guard
    if (this._fetching) {
      console.log('[StepManager] fetch already in progress — returning cached');
      return this._lastValue;
    }

    this._fetching = true;
    const t0 = Date.now();

    try {
      // ── Try HealthKit first ──
      if (HealthKitService.initialized) {
        const hkResult = await HealthKitService.getStepsToday();

        if (hkResult && hkResult.value >= 0) {
          const steps = hkResult.value;
          const distanceKm = Number((steps * STRIDE_KM).toFixed(2));

          const result: StepResult = { steps, distanceKm, source: 'healthkit' };
          this._applyMonotonic(result);

          console.log(
            `[StepManager] fetch: ${result.steps} steps | source: healthkit | ${Date.now() - t0}ms`
          );
          return result;
        }
      }

      // ── Fallback: Backend API ──
      const apiRes = await getStepsToday().catch(() => ({ data: null }));
      const apiSteps = Number(apiRes?.data?.steps || 0);
      const apiDistance = Number(apiRes?.data?.distanceKm || 0);

      const result: StepResult = {
        steps: apiSteps,
        distanceKm: apiDistance || Number((apiSteps * STRIDE_KM).toFixed(2)),
        source: 'backend',
      };
      this._applyMonotonic(result);

      console.log(
        `[StepManager] fetch: ${result.steps} steps | source: backend | ${Date.now() - t0}ms`
      );
      return result;
    } catch (e) {
      console.warn('[StepManager] fetch error:', e);
      return this._lastValue;
    } finally {
      this._lastFetch = Date.now();
      this._fetching = false;
    }
  }

  /**
   * Get the last known step count without triggering a new fetch.
   */
  getCached(): StepResult {
    return { ...this._lastValue };
  }

  /**
   * Reset cached values (e.g. at day boundary).
   */
  resetForNewDay(): void {
    this._lastValue = { steps: 0, distanceKm: 0, source: 'none' };
    this._lastFetch = 0;
    console.log('[StepManager] Reset for new day');
  }

  /* ── Internal ── */

  /**
   * Monotonic guarantee — only accept values ≥ current cached value.
   */
  private _applyMonotonic(result: StepResult): void {
    if (result.steps < this._lastValue.steps && this._lastValue.steps > 0) {
      console.warn(
        `[StepManager] ⚠️ value drop: ${this._lastValue.steps} → ${result.steps} (keeping ${this._lastValue.steps})`
      );
      result.steps = this._lastValue.steps;
      result.distanceKm = this._lastValue.distanceKm;
    }
    this._lastValue = { ...result };
  }
}

/** Singleton */
export const StepManager = new _StepManager();
