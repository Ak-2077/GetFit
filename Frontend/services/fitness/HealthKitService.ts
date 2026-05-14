/**
 * HealthKitService.ts
 * ──────────────────────────────────────────────────────────────
 * Platform-gated Apple HealthKit bridge.
 *
 * • Uses @kingstinct/react-native-healthkit (Bridgeless / New Arch compatible)
 * • HKStatisticsQuery (cumulativeSum) for StepCount + ActiveEnergyBurned
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

/* ---------- Lazy module loader ---------- */

let HK: any = null;

const getHK = (): any => {
  if (Platform.OS !== 'ios') return null;
  if (HK) return HK;
  try {
    const mod = require('@kingstinct/react-native-healthkit');
    const keys = Object.keys(mod || {});
    console.log(`[HealthKitService] @kingstinct/react-native-healthkit keys count: ${keys.length}`);
    HK = mod;
    return HK;
  } catch (e) {
    console.warn('[HealthKitService] @kingstinct/react-native-healthkit not available:', e);
    return null;
  }
};

/* ---------- Permission identifiers ---------- */

const READ_PERMISSIONS = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierBodyMass',
] as const;

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

    const hk = getHK();
    if (!hk) {
      this._available = false;
      return false;
    }

    this._available = true;
    return true;
  }

  /**
   * Async availability check using the native API.
   */
  async checkAvailabilityAsync(): Promise<boolean> {
    if (Platform.OS !== 'ios') return false;
    const hk = getHK();
    if (!hk?.isHealthDataAvailable) return false;
    try {
      const ok = await hk.isHealthDataAvailable();
      console.log(`[HealthKitService] isHealthDataAvailable: ${ok}`);
      return !!ok;
    } catch (e) {
      console.warn('[HealthKitService] isHealthDataAvailable failed:', e);
      return false;
    }
  }

  /**
   * Initialize HealthKit and request permissions.
   * Safe to call multiple times — idempotent after first success.
   */
  async initialize(): Promise<boolean> {
    if (this._initialized) return true;

    if (!this.isAvailable()) {
      console.log('[HealthKitService] Not available (non-iOS or missing module)');
      return false;
    }

    const hk = getHK();
    if (!hk?.requestAuthorization) {
      console.warn('[HealthKitService] requestAuthorization not exported by module');
      this._available = false;
      return false;
    }

    const nativeOk = await this.checkAvailabilityAsync();
    if (!nativeOk) {
      this._available = false;
      return false;
    }

    try {
      await hk.requestAuthorization({ toRead: READ_PERMISSIONS as unknown as string[] });
      this._initialized = true;
      console.log('[HealthKitService] Authorization requested + initialized');
      return true;
    } catch (e) {
      console.warn('[HealthKitService] requestAuthorization failed:', e);
      this._available = false;
      return false;
    }
  }

  /**
   * Internal: aggregate cumulativeSum for a HK quantity identifier today.
   */
  private async _sumQuantityToday(
    identifier: string,
    unit: string
  ): Promise<{ value: number; startDate: string; endDate: string } | null> {
    if (!this._initialized) return null;

    const hk = getHK();
    if (!hk?.queryStatisticsForQuantity) {
      console.warn('[HealthKitService] queryStatisticsForQuantity not available');
      return null;
    }

    const start = getLocalStartOfDay();
    const end = new Date();
    const t0 = Date.now();

    try {
      const stats = await hk.queryStatisticsForQuantity(
        identifier,
        ['cumulativeSum'],
        {
          filter: { date: { startDate: start, endDate: end } },
          unit,
        }
      );
      const elapsed = Date.now() - t0;
      const value = Number(stats?.sumQuantity?.quantity ?? 0);
      console.log(
        `[HealthKitService] ${identifier} sum=${value} ${unit} | ${elapsed}ms`
      );
      return {
        value: Math.round(value),
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      };
    } catch (e: any) {
      const elapsed = Date.now() - t0;
      console.warn(
        `[HealthKitService] queryStatistics(${identifier}) error (${elapsed}ms):`,
        e?.message || e
      );
      return null;
    }
  }

  /**
   * Step count for today (cumulativeSum, deduplicated across devices).
   */
  getStepsToday(): Promise<HealthKitStepResult | null> {
    return this._sumQuantityToday('HKQuantityTypeIdentifierStepCount', 'count');
  }

  /**
   * Active energy burned today in kcal.
   */
  getActiveEnergyBurnedToday(): Promise<HealthKitCalorieResult | null> {
    return this._sumQuantityToday('HKQuantityTypeIdentifierActiveEnergyBurned', 'kcal');
  }

  /**
   * Read the user's latest body mass from HealthKit (kg).
   */
  async getLatestWeight(): Promise<number | null> {
    if (!this._initialized) return null;
    const hk = getHK();
    if (!hk?.getMostRecentQuantitySample) return null;
    try {
      const sample = await hk.getMostRecentQuantitySample(
        'HKQuantityTypeIdentifierBodyMass',
        'kg'
      );
      const value = Number(sample?.quantity ?? 0);
      if (!value) return null;
      return value;
    } catch (e) {
      console.warn('[HealthKitService] getLatestWeight failed:', e);
      return null;
    }
  }

  /**
   * Query the iOS request-status for our read scopes.
   * Returns:
   *  - 'shouldRequest' — user has not been prompted (or prompt was dismissed)
   *  - 'unnecessary'   — system already decided (granted OR denied — Apple won't tell)
   *  - 'unknown'       — indeterminate / pre-init
   */
  async getAuthorizationRequestStatus(): Promise<
    'unknown' | 'shouldRequest' | 'unnecessary'
  > {
    if (Platform.OS !== 'ios') return 'unknown';
    const hk = getHK();
    if (!hk?.getRequestStatusForAuthorization) return 'unknown';
    try {
      const status = await hk.getRequestStatusForAuthorization({
        toRead: READ_PERMISSIONS as unknown as string[],
      });
      // enum: 0 unknown, 1 shouldRequest, 2 unnecessary
      if (status === 1) return 'shouldRequest';
      if (status === 2) return 'unnecessary';
      return 'unknown';
    } catch (e) {
      console.warn('[HealthKitService] getRequestStatusForAuthorization failed:', e);
      return 'unknown';
    }
  }

  /**
   * Per-day cumulative buckets for an arbitrary HKQuantity identifier.
   * Uses HealthKit's HKStatisticsCollectionQuery (1-day intervals).
   *
   * Returns an array of { date, value } points covering the trailing
   * `days` calendar days, ending today (inclusive). Missing days are
   * filled with 0 so the resulting series is always contiguous.
   */
  async getDailyBuckets(
    identifier:
      | 'HKQuantityTypeIdentifierStepCount'
      | 'HKQuantityTypeIdentifierActiveEnergyBurned'
      | 'HKQuantityTypeIdentifierDistanceWalkingRunning',
    days: number
  ): Promise<Array<{ date: Date; value: number }> | null> {
    if (!this._initialized || Platform.OS !== 'ios') return null;
    const hk = getHK();
    if (!hk?.queryStatisticsCollectionForQuantity) return null;

    const unit =
      identifier === 'HKQuantityTypeIdentifierStepCount'
        ? 'count'
        : identifier === 'HKQuantityTypeIdentifierActiveEnergyBurned'
          ? 'kcal'
          : 'm';

    const today = getLocalStartOfDay();
    const startDate = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const endDate = new Date(); // include partial today

    try {
      const collection = await hk.queryStatisticsCollectionForQuantity(
        identifier,
        ['cumulativeSum'],
        startDate,
        { day: 1 },
        { filter: { date: { startDate, endDate } }, unit }
      );

      // Index returned buckets by local YYYY-MM-DD for fast lookup.
      const byDay: Record<string, number> = {};
      for (const entry of collection ?? []) {
        const ts = entry?.startDate ? new Date(entry.startDate) : null;
        if (!ts) continue;
        const key = `${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}`;
        const v = Number(entry?.sumQuantity?.quantity ?? 0);
        byDay[key] = (byDay[key] || 0) + v;
      }

      // Build a contiguous series for every day in the window.
      const series: Array<{ date: Date; value: number }> = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        series.push({ date: d, value: Math.max(0, byDay[key] ?? 0) });
      }
      return series;
    } catch (e: any) {
      console.warn(
        `[HealthKitService] getDailyBuckets(${identifier}) error:`,
        e?.message || e
      );
      return null;
    }
  }

  /**
   * Hourly buckets for a given quantity over the last `hours` hours
   * (default 24). Used by the "Day" range in analytics screens.
   */
  async getHourlyBuckets(
    identifier:
      | 'HKQuantityTypeIdentifierStepCount'
      | 'HKQuantityTypeIdentifierActiveEnergyBurned',
    hours = 24
  ): Promise<Array<{ date: Date; value: number }> | null> {
    if (!this._initialized || Platform.OS !== 'ios') return null;
    const hk = getHK();
    if (!hk?.queryStatisticsCollectionForQuantity) return null;

    const unit =
      identifier === 'HKQuantityTypeIdentifierStepCount' ? 'count' : 'kcal';

    const now = new Date();
    // Anchor at start of current hour for stable buckets.
    const anchor = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      0,
      0,
      0
    );
    const startDate = new Date(anchor.getTime() - (hours - 1) * 60 * 60 * 1000);
    const endDate = now;

    try {
      const collection = await hk.queryStatisticsCollectionForQuantity(
        identifier,
        ['cumulativeSum'],
        startDate,
        { hour: 1 },
        { filter: { date: { startDate, endDate } }, unit }
      );

      const byHour: Record<number, number> = {};
      for (const entry of collection ?? []) {
        const ts = entry?.startDate ? new Date(entry.startDate) : null;
        if (!ts) continue;
        const slot = Math.round((ts.getTime() - startDate.getTime()) / 3600000);
        const v = Number(entry?.sumQuantity?.quantity ?? 0);
        byHour[slot] = (byHour[slot] || 0) + v;
      }

      const series: Array<{ date: Date; value: number }> = [];
      for (let i = 0; i < hours; i++) {
        const d = new Date(startDate.getTime() + i * 3600000);
        series.push({ date: d, value: Math.max(0, byHour[i] ?? 0) });
      }
      return series;
    } catch (e: any) {
      console.warn(
        `[HealthKitService] getHourlyBuckets(${identifier}) error:`,
        e?.message || e
      );
      return null;
    }
  }

  /**
   * Sum of steps over the trailing N days. Used to distinguish
   * "permission denied" (always 0) from "no activity today" (>0 historically).
   */
  async getStepsTrailingDays(days: number): Promise<number | null> {
    if (!this._initialized) return null;
    const hk = getHK();
    if (!hk?.queryStatisticsForQuantity) return null;
    const end = new Date();
    const start = new Date(end.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);
    try {
      const stats = await hk.queryStatisticsForQuantity(
        'HKQuantityTypeIdentifierStepCount',
        ['cumulativeSum'],
        { filter: { date: { startDate: start, endDate: end } }, unit: 'count' }
      );
      const value = Number(stats?.sumQuantity?.quantity ?? 0);
      return Math.round(value);
    } catch (e: any) {
      console.warn('[HealthKitService] getStepsTrailingDays error:', e?.message || e);
      return null;
    }
  }

  /**
   * Set up an observer for step count changes.
   * Calls the provided callback when HealthKit detects new step data.
   */
  observeSteps(callback: () => void): void {
    if (!this._initialized) return;
    const hk = getHK();
    if (!hk?.subscribeToChanges) {
      console.warn('[HealthKitService] subscribeToChanges not available');
      return;
    }
    try {
      hk.subscribeToChanges('HKQuantityTypeIdentifierStepCount', () => {
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
