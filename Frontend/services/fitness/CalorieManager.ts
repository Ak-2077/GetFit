/**
 * CalorieManager.ts
 * ──────────────────────────────────────────────────────────────
 * Manages calorie burn data with HealthKit priority + fallback estimation.
 *
 * • Tries HealthKit ActiveEnergyBurned first (HKStatisticsQuery, cumulativeSum)
 * • Falls back to step-based estimation if HealthKit unavailable
 * • Merges manual burn logs from backend
 * • Throttled, cached, monotonic — same guarantees as StepManager
 * ──────────────────────────────────────────────────────────────
 */

import { HealthKitService } from './HealthKitService';
import { getCaloriesBurn } from '../api';
import { FitnessSource } from './FitnessStore';

/* ---------- Types ---------- */

export interface CalorieResult {
  totalCaloriesBurned: number;
  healthKitCalories: number;
  estimatedCalories: number;
  manualCalories: number;
  walkingCalories: number;
  source: FitnessSource;
}

/* ---------- Constants ---------- */

const THROTTLE_MS = 10_000;

// Fallback estimation constants
const CALORIES_PER_STEP_BASE = 0.04; // kcal per step at 70kg
const REFERENCE_WEIGHT_KG = 70;

/* ---------- Manager ---------- */

class _CalorieManager {
  private _lastFetch = 0;
  private _lastValue: CalorieResult = {
    totalCaloriesBurned: 0,
    healthKitCalories: 0,
    estimatedCalories: 0,
    manualCalories: 0,
    walkingCalories: 0,
    source: 'none',
  };
  private _fetching = false;
  private _userWeightKg: number = 70; // default, updated from HealthKit or profile

  /**
   * Update the user's weight for fallback estimation.
   */
  setUserWeight(weightKg: number): void {
    if (weightKg > 0 && weightKg < 400) {
      this._userWeightKg = weightKg;
    }
  }

  /**
   * Fetch current calorie burn data.
   * @param currentSteps — Current step count (for fallback estimation)
   * @param force — Bypass throttle
   */
  async fetch(currentSteps: number = 0, force = false): Promise<CalorieResult> {
    const now = Date.now();

    // Throttle guard
    if (!force && now - this._lastFetch < THROTTLE_MS) {
      console.log(
        `[CalorieManager] throttled: skipping (last: ${Math.round((now - this._lastFetch) / 1000)}s ago)`
      );
      return this._lastValue;
    }

    // Re-entrancy guard
    if (this._fetching) {
      console.log('[CalorieManager] fetch already in progress — returning cached');
      return this._lastValue;
    }

    this._fetching = true;
    const t0 = Date.now();

    try {
      let hkCalories = 0;
      let hkAvailable = false;

      // ── Try HealthKit ActiveEnergyBurned ──
      if (HealthKitService.initialized) {
        const hkResult = await HealthKitService.getActiveEnergyBurnedToday();

        if (hkResult && hkResult.value >= 0) {
          hkCalories = hkResult.value;
          hkAvailable = true;
        }

        // Also try to get weight from HealthKit for better estimation
        const hkWeight = await HealthKitService.getLatestWeight();
        if (hkWeight && hkWeight > 0) {
          this._userWeightKg = hkWeight;
        }
      }

      // ── Get manual burn logs from backend ──
      let manualCalories = 0;
      let backendWalkingCalories = 0;
      let backendTotalCalories = 0;

      try {
        const burnRes = await getCaloriesBurn();
        manualCalories = Number(burnRes?.data?.manualCaloriesBurned || 0);
        backendWalkingCalories = Number(burnRes?.data?.walkingCaloriesBurned || 0);
        backendTotalCalories = Number(burnRes?.data?.totalCaloriesBurned || 0);
      } catch {
        // Backend unavailable — proceed with HealthKit only
      }

      // ── Calculate estimated calories from steps (fallback) ──
      const estimatedCalories = this._estimateFromSteps(currentSteps);

      // ── Determine total and source ──
      let totalCaloriesBurned: number;
      let source: FitnessSource;
      let walkingCalories: number;

      if (hkAvailable) {
        // HealthKit provides accurate calorie data — use it as primary
        // Add manual burn logs on top (backend-tracked workouts)
        totalCaloriesBurned = hkCalories + manualCalories;
        walkingCalories = hkCalories; // HealthKit includes all active energy
        source = 'healthkit';

        console.log(
          `[CalorieManager] fetch: ${totalCaloriesBurned} kcal (HK: ${hkCalories} + manual: ${manualCalories}) | source: healthkit | ${Date.now() - t0}ms`
        );
      } else if (estimatedCalories > 0 && currentSteps > 0) {
        // Step-based estimation available (from Android pedometer or other step source)
        totalCaloriesBurned = estimatedCalories + manualCalories;
        walkingCalories = estimatedCalories;
        // Use 'estimated' as source — FitnessService will override with 'pedometer'
        // if the steps came from Android pedometer
        source = 'estimated';

        console.log(
          `[CalorieManager] fetch: ${totalCaloriesBurned} kcal (steps: ${currentSteps}, est: ${estimatedCalories} + manual: ${manualCalories}) | source: estimated | weight: ${this._userWeightKg}kg | ${Date.now() - t0}ms`
        );
      } else if (backendTotalCalories > 0) {
        // Backend has data — use it
        totalCaloriesBurned = backendTotalCalories;
        walkingCalories = backendWalkingCalories;
        source = 'backend';

        console.log(
          `[CalorieManager] fetch: ${totalCaloriesBurned} kcal | source: backend | ${Date.now() - t0}ms`
        );
      } else {
        // Full fallback — estimate from steps
        totalCaloriesBurned = estimatedCalories + manualCalories;
        walkingCalories = estimatedCalories;
        source = 'estimated';

        console.log(
          `[CalorieManager] fallback: ${totalCaloriesBurned} kcal | method: step-estimation | weight: ${this._userWeightKg}kg | ${Date.now() - t0}ms`
        );
      }

      const result: CalorieResult = {
        totalCaloriesBurned: Math.round(totalCaloriesBurned),
        healthKitCalories: Math.round(hkCalories),
        estimatedCalories: Math.round(estimatedCalories),
        manualCalories: Math.round(manualCalories),
        walkingCalories: Math.round(walkingCalories),
        source,
      };

      this._applyMonotonic(result);
      return result;
    } catch (e) {
      console.warn('[CalorieManager] fetch error:', e);
      return this._lastValue;
    } finally {
      this._lastFetch = Date.now();
      this._fetching = false;
    }
  }

  /**
   * Get last known calorie data without triggering a new fetch.
   */
  getCached(): CalorieResult {
    return { ...this._lastValue };
  }

  /**
   * Reset cached values (e.g. at day boundary).
   */
  resetForNewDay(): void {
    this._lastValue = {
      totalCaloriesBurned: 0,
      healthKitCalories: 0,
      estimatedCalories: 0,
      manualCalories: 0,
      walkingCalories: 0,
      source: 'none',
    };
    this._lastFetch = 0;
    console.log('[CalorieManager] Reset for new day');
  }

  /* ── Internal ── */

  /**
   * Estimate calories burned from step count, user weight, and activity intensity.
   *
   * Formula: steps × base_rate × (weight / reference_weight) × intensity_factor
   * - base_rate: 0.04 kcal/step at 70kg
   * - intensity_factor: 1.0 for walking (could be higher for running)
   */
  private _estimateFromSteps(steps: number): number {
    if (steps <= 0) return 0;

    const weightFactor = this._userWeightKg / REFERENCE_WEIGHT_KG;
    const intensityFactor = 1.0; // Walking intensity

    return steps * CALORIES_PER_STEP_BASE * weightFactor * intensityFactor;
  }

  /**
   * Monotonic guarantee — only accept total values ≥ current cached value.
   */
  private _applyMonotonic(result: CalorieResult): void {
    if (
      result.totalCaloriesBurned < this._lastValue.totalCaloriesBurned &&
      this._lastValue.totalCaloriesBurned > 0
    ) {
      console.warn(
        `[CalorieManager] ⚠️ value drop: ${this._lastValue.totalCaloriesBurned} → ${result.totalCaloriesBurned} (keeping ${this._lastValue.totalCaloriesBurned})`
      );
      result.totalCaloriesBurned = this._lastValue.totalCaloriesBurned;
    }
    this._lastValue = { ...result };
  }
}

/** Singleton */
export const CalorieManager = new _CalorieManager();
