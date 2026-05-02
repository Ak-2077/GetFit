/**
 * HealthKitService.ts
 * ──────────────────────────────────────────────────────────────
 * Platform-gated Apple HealthKit bridge.
 *
 * • Uses HKStatisticsQuery with cumulativeSum for StepCount
 *   and ActiveEnergyBurned
 * • Fetches from startOfDay (local timezone) to current time
 * • Statistics queries auto-deduplicate across iPhone + Apple Watch
 * • iOS-only — all methods safely return null / false on Android
 * ──────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';

/* ---------- Types ---------- */

export interface HealthKitStepResult {
  value: number;
  startDate: string;
  endDate: string;
}

export interface HealthKitCalorieResult {
  value: number;
  startDate: string;
  endDate: string;
}

/* ---------- Lazy import ---------- */

let AppleHealthKit: any = null;

const getHealthKit = (): any => {
  if (Platform.OS !== 'ios') return null;
  if (!AppleHealthKit) {
    try {
      // react-native-health provides the HealthKit bindings
      AppleHealthKit = require('react-native-health').default;
    } catch (e) {
      console.warn('[HealthKitService] react-native-health not available:', e);
      return null;
    }
  }
  return AppleHealthKit;
};

/* ---------- Permissions ---------- */

const PERMISSIONS = {
  permissions: {
    read: [
      'StepCount',
      'ActiveEnergyBurned',
      'BodyMass',
    ],
    write: [] as string[],
  },
};

/* ---------- Helpers ---------- */

/**
 * Returns the start of the current day in the device's **local** timezone.
 * Critical for HealthKit queries — avoids UTC-shift bugs.
 */
export const getLocalStartOfDay = (): Date => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return start;
};

/* ---------- Service ---------- */

class _HealthKitService {
  private _initialized = false;
  private _available: boolean | null = null;

  /**
   * Check if HealthKit is available on this device (iOS only).
   */
  isAvailable(): boolean {
    if (Platform.OS !== 'ios') return false;
    if (this._available !== null) return this._available;

    const hk = getHealthKit();
    if (!hk) {
      this._available = false;
      return false;
    }

    // react-native-health exposes isAvailable synchronously after init
    this._available = true;
    return true;
  }

  /**
   * Initialize HealthKit and request permissions.
   * Safe to call multiple times — idempotent after first success.
   */
  initialize(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this._initialized) {
        resolve(true);
        return;
      }

      if (!this.isAvailable()) {
        console.log('[HealthKitService] Not available (non-iOS or missing module)');
        resolve(false);
        return;
      }

      const hk = getHealthKit();
      hk.initHealthKit(PERMISSIONS, (err: any) => {
        if (err) {
          console.warn('[HealthKitService] Init failed:', err);
          this._available = false;
          resolve(false);
          return;
        }

        this._initialized = true;
        console.log('[HealthKitService] Initialized successfully');
        resolve(true);
      });
    });
  }

  /**
   * HKStatisticsQuery — cumulativeSum for StepCount.
   * Fetches from startOfDay to now. Auto-deduplicates across devices.
   */
  getStepsToday(): Promise<HealthKitStepResult | null> {
    return new Promise((resolve) => {
      if (!this._initialized) {
        resolve(null);
        return;
      }

      const hk = getHealthKit();
      const startDate = getLocalStartOfDay().toISOString();
      const endDate = new Date().toISOString();

      const options = {
        startDate,
        endDate,
        type: 'Walking', // maps to StepCount
      };

      const t0 = Date.now();

      hk.getStepCount(options, (err: any, results: any) => {
        const elapsed = Date.now() - t0;

        if (err) {
          console.warn(`[HealthKitService] getStepCount error (${elapsed}ms):`, err);
          resolve(null);
          return;
        }

        const value = Number(results?.value ?? 0);
        console.log(
          `[HealthKitService] steps: ${value} | range: ${startDate} → ${endDate} | ${elapsed}ms`
        );

        resolve({
          value: Math.round(value),
          startDate,
          endDate,
        });
      });
    });
  }

  /**
   * HKStatisticsQuery — cumulativeSum for ActiveEnergyBurned.
   * Fetches from startOfDay to now. Same time range as steps for consistency.
   */
  getActiveEnergyBurnedToday(): Promise<HealthKitCalorieResult | null> {
    return new Promise((resolve) => {
      if (!this._initialized) {
        resolve(null);
        return;
      }

      const hk = getHealthKit();
      const startDate = getLocalStartOfDay().toISOString();
      const endDate = new Date().toISOString();

      const options = {
        startDate,
        endDate,
      };

      const t0 = Date.now();

      hk.getActiveEnergyBurned(options, (err: any, results: any) => {
        const elapsed = Date.now() - t0;

        if (err) {
          console.warn(`[HealthKitService] getActiveEnergyBurned error (${elapsed}ms):`, err);
          resolve(null);
          return;
        }

        const value = Number(results?.value ?? 0);
        console.log(
          `[HealthKitService] burn: ${value} kcal | range: ${startDate} → ${endDate} | ${elapsed}ms`
        );

        resolve({
          value: Math.round(value),
          startDate,
          endDate,
        });
      });
    });
  }

  /**
   * Read the user's latest body mass from HealthKit (kg).
   * Used for fallback calorie estimation if HealthKit energy is unavailable.
   */
  getLatestWeight(): Promise<number | null> {
    return new Promise((resolve) => {
      if (!this._initialized) {
        resolve(null);
        return;
      }

      const hk = getHealthKit();

      hk.getLatestWeight({ unit: 'kg' }, (err: any, results: any) => {
        if (err || !results?.value) {
          resolve(null);
          return;
        }

        resolve(Number(results.value));
      });
    });
  }

  /**
   * Set up a background observer for step count changes.
   * Calls the provided callback when HealthKit detects new step data.
   */
  observeSteps(callback: () => void): void {
    if (!this._initialized) return;

    const hk = getHealthKit();
    try {
      hk.initStepCountObserver({}, () => {
        console.log('[HealthKitService] Step observer triggered');
        callback();
      });
    } catch (e) {
      console.warn('[HealthKitService] Failed to set up step observer:', e);
    }
  }

  get initialized(): boolean {
    return this._initialized;
  }
}

/** Singleton — shared across the entire app */
export const HealthKitService = new _HealthKitService();
