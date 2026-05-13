/**
 * StepManager.ts
 * ──────────────────────────────────────────────────────────────
 * Manages step count retrieval with platform-native priority.
 *
 * Priority chain:
 *   1. iOS  → HealthKit (HKStatisticsQuery, cumulativeSum)
 *   2. Android → expo-sensors Pedometer (TYPE_STEP_COUNTER)
 *   3. Fallback → Backend API
 *
 * • Throttles queries to max 1 per 10 seconds
 * • Caches last known value — never returns a lower value within a day
 * ──────────────────────────────────────────────────────────────
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { HealthKitService } from './HealthKitService';
import { AndroidPedometerService } from './AndroidPedometerService';
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
const BASELINE_KEY = 'step_manager_baseline';
const BASELINE_DAY_KEY = 'step_manager_baseline_day';

/* ---------- Manager ---------- */

class _StepManager {
  private _lastFetch = 0;
  private _lastValue: StepResult = { steps: 0, distanceKm: 0, source: 'none' };
  private _fetching = false;
  private _baselineSteps: number | null = null;
  private _baselineDay: string = '';
  private _baselineLoaded = false;

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
      // ── 1. Try HealthKit first (iOS) ──
      // HealthKit returns clean daily totals from midnight — no calibration needed
      if (HealthKitService.initialized) {
        const hkResult = await HealthKitService.getStepsToday();

        if (hkResult && hkResult.value >= 0) {
          const steps = Math.round(hkResult.value);
          const distanceKm = Number((steps * STRIDE_KM).toFixed(2));

          const result: StepResult = { steps, distanceKm, source: 'healthkit' };
          this._applyMonotonic(result);

          console.log(
            `[StepManager] fetch: ${result.steps} steps | source: healthkit | ${Date.now() - t0}ms`
          );
          return result;
        }
      }

      // ── 2. Try Android Pedometer (Android) ──
      if (AndroidPedometerService.authorized) {
        const pedometerResult = await AndroidPedometerService.getStepsToday();

        if (pedometerResult && pedometerResult.value >= 0) {
          const rawSteps = pedometerResult.value;
          const steps = await this._calibrateSteps(rawSteps);
          const distanceKm = Number((steps * STRIDE_KM).toFixed(2));

          const result: StepResult = { steps, distanceKm, source: 'pedometer' };
          this._applyMonotonic(result);

          console.log(
            `[StepManager] fetch: ${result.steps} steps (raw: ${rawSteps}, baseline: ${this._baselineSteps}) | source: pedometer | ${Date.now() - t0}ms`
          );
          return result;
        }
      }

      // ── 3. Fallback: Backend API ──
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
   * Also clears the sensor baseline so a new one is captured on next fetch.
   */
  resetForNewDay(): void {
    this._lastValue = { steps: 0, distanceKm: 0, source: 'none' };
    this._lastFetch = 0;
    this._baselineSteps = null;
    this._baselineDay = '';
    AsyncStorage.multiRemove([BASELINE_KEY, BASELINE_DAY_KEY]).catch(() => {});
    console.log('[StepManager] Reset for new day (baseline cleared)');
  }

  /* ── Internal ── */

  /**
   * Load baseline from AsyncStorage on first access.
   */
  private async _loadBaseline(): Promise<void> {
    if (this._baselineLoaded) return;
    try {
      const [day, steps] = await Promise.all([
        AsyncStorage.getItem(BASELINE_DAY_KEY),
        AsyncStorage.getItem(BASELINE_KEY),
      ]);
      const today = this._getTodayKey();
      if (day === today && steps !== null) {
        this._baselineSteps = Number(steps);
        this._baselineDay = day;
        console.log(`[StepManager] Loaded baseline: ${this._baselineSteps} for ${day}`);
      } else {
        this._baselineSteps = null;
        this._baselineDay = '';
        console.log('[StepManager] No valid baseline — will calibrate on first sensor reading');
      }
    } catch (e) {
      console.warn('[StepManager] Failed to load baseline:', e);
    }
    this._baselineLoaded = true;
  }

  /**
   * Save baseline to AsyncStorage.
   */
  private async _saveBaseline(steps: number): Promise<void> {
    const today = this._getTodayKey();
    this._baselineSteps = steps;
    this._baselineDay = today;
    try {
      await Promise.all([
        AsyncStorage.setItem(BASELINE_DAY_KEY, today),
        AsyncStorage.setItem(BASELINE_KEY, String(steps)),
      ]);
      console.log(`[StepManager] Saved baseline: ${steps} for ${today}`);
    } catch (e) {
      console.warn('[StepManager] Failed to save baseline:', e);
    }
  }

  /**
   * Calibrate raw sensor steps against the daily baseline.
   * First sensor reading of the day becomes the baseline; displayed steps
   * = rawSteps − baseline (clamped to 0). This eliminates phantom steps
   * that sensors may report on first access.
   */
  private async _calibrateSteps(rawSteps: number): Promise<number> {
    await this._loadBaseline();

    const today = this._getTodayKey();

    // First sensor reading of the day — capture as baseline
    if (this._baselineSteps === null || this._baselineDay !== today) {
      await this._saveBaseline(rawSteps);
      return 0;
    }

    return Math.max(0, rawSteps - this._baselineSteps);
  }

  private _getTodayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
  }

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
