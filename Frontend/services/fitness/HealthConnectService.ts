/**
 * HealthConnectService.ts
 * ──────────────────────────────────────────────────────────────
 * Android-only Health Connect bridge — mirrors HealthKitService
 * in architecture and API surface.
 *
 * • Uses react-native-health-connect for Google Health Connect
 * • Reads Steps, ActiveCaloriesBurned, Distance, ExerciseSessions
 * • Supports historical range queries (unlike raw Pedometer)
 * • Persistent data survives app kills (unlike watchStepCount)
 * • iOS-safe: every method early-returns null/false on non-Android
 *
 * Priority in the fitness pipeline:
 *   Health Connect (conf 95) > Pedometer watcher (conf 65) > BMR (conf 40)
 * ──────────────────────────────────────────────────────────────
 */

import { Platform, Linking } from 'react-native';

/* ---------- Types ---------- */

export interface HealthConnectStepResult {
  value: number;
  startDate: string;
  endDate: string;
}

export interface HealthConnectCalorieResult {
  value: number;
  startDate: string;
  endDate: string;
}

export interface HealthConnectDistanceResult {
  /** Distance in meters */
  value: number;
  startDate: string;
  endDate: string;
}

/* ---------- Lazy import ---------- */

let HC: any = null;

const getHC = (): any => {
  if (Platform.OS !== 'android') return null;
  if (HC) return HC;
  try {
    HC = require('react-native-health-connect');
    return HC;
  } catch (e: any) {
    console.warn(
      '[HealthConnectService] react-native-health-connect not available:',
      e?.message
    );
    return null;
  }
};

/* ---------- Constants ---------- */

const READ_PERMISSIONS = [
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'Distance' },
  { accessType: 'read', recordType: 'ExerciseSession' },
] as const;

const HEALTH_CONNECT_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';

/* ---------- Helpers ---------- */

const getLocalStartOfDay = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
};

const toISOString = (d: Date): string => d.toISOString();

/* ---------- Service ---------- */

class _HealthConnectService {
  private _initialized = false;
  private _available: boolean | null = null;
  private _authorized = false;

  /* ── Availability ────────────────────────────────── */

  /**
   * Check if Health Connect is available on this device.
   * Android 14+ has it built-in; older versions need the Play Store app.
   */
  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    if (this._available !== null) return this._available;

    const hc = getHC();
    if (!hc) {
      this._available = false;
      return false;
    }

    try {
      // getSdkStatus returns: SDK_UNAVAILABLE(1), SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED(2), SDK_AVAILABLE(3)
      const status = await hc.getSdkStatus(hc.SdkAvailabilityStatus);
      this._available = status === 3; // SDK_AVAILABLE
      console.log(
        `[HealthConnectService] getSdkStatus=${status} → available=${this._available}`
      );
    } catch (e: any) {
      // Fallback: try initialize directly
      try {
        await hc.initialize();
        this._available = true;
        console.log('[HealthConnectService] initialize() succeeded → available=true');
      } catch {
        this._available = false;
        console.log('[HealthConnectService] initialize() failed → available=false');
      }
    }

    return this._available!;
  }

  /* ── Initialization ──────────────────────────────── */

  /**
   * Initialize the Health Connect client.
   * Must be called before any data reads.
   */
  async initialize(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    if (this._initialized) return true;

    const hc = getHC();
    if (!hc) return false;

    try {
      await hc.initialize();
      this._initialized = true;
      console.log('[HealthConnectService] Initialized');
      return true;
    } catch (e: any) {
      console.warn('[HealthConnectService] initialize error:', e?.message);
      return false;
    }
  }

  /* ── Permissions ─────────────────────────────────── */

  /**
   * Request read permissions for steps, calories, distance, exercise.
   * Returns true if all requested permissions were granted.
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    const hc = getHC();
    if (!hc) return false;

    if (!this._initialized) {
      const ok = await this.initialize();
      if (!ok) return false;
    }

    try {
      const granted = await hc.requestPermission(
        READ_PERMISSIONS as any
      );

      // Check that at least Steps read was granted
      const hasSteps = Array.isArray(granted)
        ? granted.some(
            (p: any) => p.recordType === 'Steps' && p.accessType === 'read'
          )
        : false;

      this._authorized = hasSteps;
      console.log(
        `[HealthConnectService] Permission result: hasSteps=${hasSteps}, granted=${JSON.stringify(granted)}`
      );
      return this._authorized;
    } catch (e: any) {
      const msg = e?.message ?? '';
      // The native HealthConnectPermissionDelegate uses a lateinit Activity
      // result launcher. If the Activity hasn't finished creating yet (e.g.
      // during early init), the launcher is uninitialized and throws
      // UninitializedPropertyAccessException. In that case, return false
      // gracefully — the user can retry from the permission card later.
      if (msg.includes('UninitializedPropertyAccessException') || msg.includes('lateinit')) {
        console.warn(
          '[HealthConnectService] requestPermission: native permission delegate not ready yet — retry later from UI'
        );
      } else {
        console.warn('[HealthConnectService] requestPermission error:', msg);
      }
      return false;
    }
  }

  /**
   * Check current permission status without prompting the user.
   */
  async getPermissionStatus(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    const hc = getHC();
    if (!hc) return false;

    if (!this._initialized) {
      const ok = await this.initialize();
      if (!ok) return false;
    }

    try {
      const granted = await hc.getGrantedPermissions();
      const hasSteps = Array.isArray(granted)
        ? granted.some(
            (p: any) => p.recordType === 'Steps' && p.accessType === 'read'
          )
        : false;

      this._authorized = hasSteps;
      return this._authorized;
    } catch (e: any) {
      console.warn('[HealthConnectService] getGrantedPermissions error:', e?.message);
      return false;
    }
  }

  /* ── Today's Data ────────────────────────────────── */

  /**
   * Total steps from local midnight to now.
   * Uses readRecords('Steps') which properly aggregates from all
   * connected fitness apps (Samsung Health, Google Fit, etc.).
   */
  async getStepsToday(): Promise<HealthConnectStepResult | null> {
    if (Platform.OS !== 'android' || !this._initialized || !this._authorized)
      return null;

    const hc = getHC();
    if (!hc) return null;

    const start = getLocalStartOfDay();
    const end = new Date();

    try {
      const records = await hc.readRecords('Steps', {
        timeRangeFilter: {
          operator: 'between',
          startTime: toISOString(start),
          endTime: toISOString(end),
        },
      });

      // Sum all step records for today
      let totalSteps = 0;
      if (Array.isArray(records)) {
        for (const r of records) {
          totalSteps += Number(r?.count ?? 0);
        }
      }

      console.log(
        `[HealthConnectService] stepsToday=${totalSteps} (${
          Array.isArray(records) ? records.length : 0
        } records)`
      );

      return {
        value: Math.max(0, Math.round(totalSteps)),
        startDate: toISOString(start),
        endDate: toISOString(end),
      };
    } catch (e: any) {
      console.warn('[HealthConnectService] getStepsToday error:', e?.message);
      return null;
    }
  }

  /**
   * Active calories burned from midnight to now (kcal).
   */
  async getActiveCaloriesToday(): Promise<HealthConnectCalorieResult | null> {
    if (Platform.OS !== 'android' || !this._initialized || !this._authorized)
      return null;

    const hc = getHC();
    if (!hc) return null;

    const start = getLocalStartOfDay();
    const end = new Date();

    try {
      const records = await hc.readRecords('ActiveCaloriesBurned', {
        timeRangeFilter: {
          operator: 'between',
          startTime: toISOString(start),
          endTime: toISOString(end),
        },
      });

      let totalCals = 0;
      if (Array.isArray(records)) {
        for (const r of records) {
          totalCals += Number(r?.energy?.inKilocalories ?? 0);
        }
      }

      console.log(
        `[HealthConnectService] activeCaloriesToday=${totalCals.toFixed(1)} kcal`
      );

      return {
        value: Math.max(0, totalCals),
        startDate: toISOString(start),
        endDate: toISOString(end),
      };
    } catch (e: any) {
      console.warn(
        '[HealthConnectService] getActiveCaloriesToday error:',
        e?.message
      );
      return null;
    }
  }

  /**
   * Distance walked/run from midnight to now (meters).
   */
  async getDistanceToday(): Promise<HealthConnectDistanceResult | null> {
    if (Platform.OS !== 'android' || !this._initialized || !this._authorized)
      return null;

    const hc = getHC();
    if (!hc) return null;

    const start = getLocalStartOfDay();
    const end = new Date();

    try {
      const records = await hc.readRecords('Distance', {
        timeRangeFilter: {
          operator: 'between',
          startTime: toISOString(start),
          endTime: toISOString(end),
        },
      });

      let totalMeters = 0;
      if (Array.isArray(records)) {
        for (const r of records) {
          totalMeters += Number(r?.distance?.inMeters ?? 0);
        }
      }

      console.log(
        `[HealthConnectService] distanceToday=${totalMeters.toFixed(0)}m`
      );

      return {
        value: Math.max(0, totalMeters),
        startDate: toISOString(start),
        endDate: toISOString(end),
      };
    } catch (e: any) {
      console.warn('[HealthConnectService] getDistanceToday error:', e?.message);
      return null;
    }
  }

  /* ── Historical Data (Analytics) ─────────────────── */

  /**
   * Per-day step/calorie buckets for the trailing N days.
   * Returns a contiguous array of { date, value } points.
   */
  async getDailyBuckets(
    metric: 'steps' | 'activeCalories',
    days: number
  ): Promise<Array<{ date: Date; value: number }> | null> {
    if (Platform.OS !== 'android' || !this._initialized || !this._authorized)
      return null;

    const hc = getHC();
    if (!hc) return null;

    const recordType = metric === 'steps' ? 'Steps' : 'ActiveCaloriesBurned';

    const endDate = new Date();
    const today = getLocalStartOfDay();
    const startDate = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    try {
      const records = await hc.readRecords(recordType, {
        timeRangeFilter: {
          operator: 'between',
          startTime: toISOString(startDate),
          endTime: toISOString(endDate),
        },
      });

      // Bucket records by local day
      const byDay: Record<string, number> = {};
      if (Array.isArray(records)) {
        for (const r of records) {
          const ts = r?.startTime ? new Date(r.startTime) : null;
          if (!ts) continue;
          const key = `${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}`;
          const value =
            metric === 'steps'
              ? Number(r?.count ?? 0)
              : Number(r?.energy?.inKilocalories ?? 0);
          byDay[key] = (byDay[key] || 0) + value;
        }
      }

      // Build contiguous series
      const series: Array<{ date: Date; value: number }> = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        series.push({ date: d, value: Math.max(0, byDay[key] ?? 0) });
      }

      console.log(
        `[HealthConnectService] getDailyBuckets(${metric}, ${days}d): ${series.length} buckets, total=${series.reduce((s, b) => s + b.value, 0)}`
      );

      return series;
    } catch (e: any) {
      console.warn(
        `[HealthConnectService] getDailyBuckets(${metric}) error:`,
        e?.message
      );
      return null;
    }
  }

  /* ── Install Prompt ──────────────────────────────── */

  /**
   * Open the Play Store page for Health Connect.
   * Used when Health Connect is not installed (Android < 14).
   */
  async openInstallPage(): Promise<void> {
    try {
      await Linking.openURL(HEALTH_CONNECT_PLAY_STORE_URL);
    } catch (e: any) {
      console.warn('[HealthConnectService] openInstallPage error:', e?.message);
      // Fallback to the Play Store market URI
      try {
        await Linking.openURL(
          'market://details?id=com.google.android.apps.healthdata'
        );
      } catch {
        // silent — no Play Store available
      }
    }
  }

  /* ── Quick data probe (diagnostics) ──────────────── */

  /**
   * Try to read 1 step record to verify the full HC pipeline.
   * Used by AndroidFitnessDiagnostics.
   */
  async probeDataAccess(): Promise<'ok' | 'empty' | 'error'> {
    if (Platform.OS !== 'android' || !this._initialized || !this._authorized)
      return 'error';

    const hc = getHC();
    if (!hc) return 'error';

    try {
      const now = new Date();
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000); // last 24h
      const records = await hc.readRecords('Steps', {
        timeRangeFilter: {
          operator: 'between',
          startTime: toISOString(start),
          endTime: toISOString(now),
        },
      });
      if (Array.isArray(records) && records.length > 0) return 'ok';
      return 'empty';
    } catch {
      return 'error';
    }
  }

  /* ── Accessors ───────────────────────────────────── */

  get initialized(): boolean {
    return this._initialized;
  }

  get authorized(): boolean {
    return this._authorized;
  }

  get available(): boolean {
    return this._available === true;
  }
}

/** Singleton */
export const HealthConnectService = new _HealthConnectService();
