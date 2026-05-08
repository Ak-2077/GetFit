/**
 * AndroidPedometerService.ts
 * ──────────────────────────────────────────────────────────────
 * Platform-gated Android pedometer bridge.
 *
 * • Uses expo-sensors Pedometer (wraps Android TYPE_STEP_COUNTER)
 * • Real-time step events via watchStepCount()
 * • Daily step queries via getStepCountAsync()
 * • Android-only — all methods safely return null / false on iOS
 * • Mirrors HealthKitService pattern for architectural consistency
 * ──────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';

/* ---------- Types ---------- */

export interface PedometerStepResult {
  value: number;
  startDate: string;
  endDate: string;
}

/* ---------- Lazy import ---------- */

let PedometerModule: any = null;

const getPedometer = (): any => {
  if (Platform.OS !== 'android') return null;
  if (!PedometerModule) {
    try {
      PedometerModule = require('expo-sensors').Pedometer;
    } catch (e) {
      console.warn('[AndroidPedometerService] expo-sensors not available:', e);
      return null;
    }
  }
  return PedometerModule;
};

/* ---------- Helpers ---------- */

/**
 * Returns the start of the current day in the device's local timezone.
 */
const getLocalStartOfDay = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
};

/* ---------- Service ---------- */

class _AndroidPedometerService {
  private _available: boolean | null = null;
  private _authorized = false;
  private _subscription: any = null;

  /**
   * Check if pedometer hardware is available on this device.
   */
  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    if (this._available !== null) return this._available;

    const pedometer = getPedometer();
    if (!pedometer) {
      this._available = false;
      return false;
    }

    try {
      this._available = await pedometer.isAvailableAsync();
    } catch (e) {
      console.warn('[AndroidPedometerService] isAvailableAsync error:', e);
      this._available = false;
    }

    return this._available!;
  }

  /**
   * Request ACTIVITY_RECOGNITION permission.
   * Returns true if permission is granted.
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    const pedometer = getPedometer();
    if (!pedometer) return false;

    try {
      const { status } = await pedometer.requestPermissionsAsync();
      this._authorized = status === 'granted';
      console.log(`[AndroidPedometerService] Permission: ${status}`);
      return this._authorized;
    } catch (e) {
      console.warn('[AndroidPedometerService] Permission request error:', e);
      return false;
    }
  }

  /**
   * Check current permission status without prompting.
   */
  async getPermissionStatus(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;

    const pedometer = getPedometer();
    if (!pedometer) return false;

    try {
      const { status } = await pedometer.getPermissionsAsync();
      this._authorized = status === 'granted';
      return this._authorized;
    } catch (e) {
      return false;
    }
  }

  /**
   * Get steps from start of today to now.
   * Uses getStepCountAsync — catches up on steps taken while app was backgrounded.
   */
  async getStepsToday(): Promise<PedometerStepResult | null> {
    if (Platform.OS !== 'android') return null;

    const pedometer = getPedometer();
    if (!pedometer) return null;

    const startDate = getLocalStartOfDay();
    const endDate = new Date();
    const t0 = Date.now();

    try {
      const result = await pedometer.getStepCountAsync(startDate, endDate);
      const value = Number(result?.steps ?? 0);
      const elapsed = Date.now() - t0;

      console.log(
        `[AndroidPedometerService] steps: ${value} | range: ${startDate.toISOString()} → ${endDate.toISOString()} | ${elapsed}ms`
      );

      return {
        value: Math.max(0, Math.round(value)),
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      };
    } catch (e) {
      console.warn('[AndroidPedometerService] getStepCountAsync error:', e);
      return null;
    }
  }

  /**
   * Subscribe to real-time step count updates.
   * The callback receives incremental step events while the app is in foreground.
   * Calls the provided callback on each step event so FitnessService can trigger a refresh.
   */
  watchSteps(callback: (steps: number) => void): void {
    if (Platform.OS !== 'android') return;

    // Remove existing subscription first
    this.stopWatching();

    const pedometer = getPedometer();
    if (!pedometer) return;

    try {
      this._subscription = pedometer.watchStepCount((result: any) => {
        const steps = Number(result?.steps ?? 0);
        if (steps > 0) {
          callback(steps);
        }
      });
      console.log('[AndroidPedometerService] Step watcher started');
    } catch (e) {
      console.warn('[AndroidPedometerService] watchStepCount error:', e);
    }
  }

  /**
   * Remove the step count subscription.
   */
  stopWatching(): void {
    if (this._subscription) {
      try {
        this._subscription.remove();
      } catch (e) {
        // silent
      }
      this._subscription = null;
      console.log('[AndroidPedometerService] Step watcher stopped');
    }
  }

  get authorized(): boolean {
    return this._authorized;
  }
}

/** Singleton */
export const AndroidPedometerService = new _AndroidPedometerService();
