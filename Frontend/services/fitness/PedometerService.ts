/**
 * PedometerService.ts
 * ──────────────────────────────────────────────────────────────
 * Cross-platform CMPedometer / Android step-counter wrapper using
 * expo-sensors. Used as a HealthKit fallback on iOS when Health
 * permissions are denied or unavailable.
 *
 * NOTE: We already have AndroidPedometerService for live watching on
 * Android. This module focuses on iOS Pedometer fallback to keep
 * separation clean and avoid breaking the existing Android path.
 * ──────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';
import { Pedometer } from 'expo-sensors';

export interface PedometerStepReading {
  steps: number;
  startDate: string;
  endDate: string;
}

/* ---------- Helpers ---------- */

const startOfLocalDay = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
};

/* ---------- Service ---------- */

class _PedometerService {
  private _available: boolean | null = null;
  private _permissionGranted: boolean | null = null;

  /**
   * Whether the device exposes a pedometer (iPhone 5s+ / motion coprocessor,
   * Android with TYPE_STEP_COUNTER).
   */
  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available;
    try {
      const ok = await Pedometer.isAvailableAsync();
      this._available = !!ok;
      console.log(`[Pedometer] isAvailable: ${this._available}`);
      return this._available;
    } catch (e) {
      console.warn('[Pedometer] isAvailableAsync failed:', e);
      this._available = false;
      return false;
    }
  }

  /**
   * Probe current permission status without prompting (best effort).
   * iOS: NSMotionUsageDescription / Motion & Fitness toggle.
   */
  async getPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
    if (!(await this.isAvailable())) return 'unsupported';
    try {
      const res = await Pedometer.getPermissionsAsync();
      this._permissionGranted = res.status === 'granted';
      return res.status as 'granted' | 'denied' | 'undetermined';
    } catch (e) {
      console.warn('[Pedometer] getPermissionsAsync failed:', e);
      return 'undetermined';
    }
  }

  /**
   * Total steps from local midnight to now. Returns null if unavailable
   * or permission denied.
   */
  async getStepsToday(): Promise<PedometerStepReading | null> {
    if (!(await this.isAvailable())) return null;

    const start = startOfLocalDay();
    const end = new Date();

    try {
      const res = await Pedometer.getStepCountAsync(start, end);
      const steps = Math.max(0, Math.round(Number(res?.steps ?? 0)));
      console.log(`[Pedometer] stepsToday=${steps} | platform=${Platform.OS}`);
      return {
        steps,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      };
    } catch (e: any) {
      // Common failure: permission denied → expo-sensors throws
      console.warn('[Pedometer] getStepCountAsync failed:', e?.message || e);
      this._permissionGranted = false;
      return null;
    }
  }

  /**
   * Steps over the trailing N days (used by Resolver as a sanity check
   * to detect HealthKit denial: pedometer > 0 but HK = 0 ⇒ HK denied).
   */
  async getStepsTrailingDays(days: number): Promise<number | null> {
    if (!(await this.isAvailable())) return null;
    const end = new Date();
    const start = new Date(end.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);
    try {
      const res = await Pedometer.getStepCountAsync(start, end);
      return Math.max(0, Math.round(Number(res?.steps ?? 0)));
    } catch (e: any) {
      console.warn('[Pedometer] getStepsTrailingDays failed:', e?.message || e);
      return null;
    }
  }
}

/** Singleton */
export const PedometerService = new _PedometerService();
