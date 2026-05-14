/**
 * AndroidPedometerService.ts
 * ────────────────────────────────────────────────────────────
 * Android-only step tracker built on `expo-sensors` Pedometer.
 *
 * THIS IS A PHASE-1 IMPLEMENTATION. It works around the fact that
 * Android's native TYPE_STEP_COUNTER does NOT support historical
 * range queries — `Pedometer.getStepCountAsync(start, end)` always
 * fails on Android. Instead we:
 *
 *   1. Subscribe to `Pedometer.watchStepCount(...)` while the app is
 *      running. The callback emits cumulative steps since the watcher
 *      started.
 *   2. Maintain a persisted `{ day, totalToday, watcherBaseline,
 *      lastCumulative }` record in AsyncStorage. On every event we
 *      add the delta (`cumulative - lastCumulative`) to totalToday.
 *   3. When the day rolls over we reset `totalToday` to 0 while
 *      keeping the current cumulative count as the new baseline so
 *      no steps are lost across midnight.
 *   4. Sensor resets (boot, sensor restart) are detected when
 *      `cumulative < lastCumulative` — we re-baseline without
 *      losing the totalToday already accumulated.
 *
 * Limitations (documented honestly):
 *   • If the app was completely killed for the entire day, today's
 *     count starts at 0 the moment the user opens it again.
 *     For full background coverage we need Health Connect (Phase 2).
 *   • Vendor battery managers (MIUI / ColorOS / OneUI) may kill the
 *     watcher in the background — AndroidFitnessDiagnostics flags these.
 *
 * iOS-safe: every method early-returns null/false on non-Android.
 * ────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/* ---------- Types ---------- */

export interface PedometerStepResult {
  value: number;
  startDate: string;
  endDate: string;
}

interface PersistedToday {
  day: string;            // 'YYYY-MM-DD' local
  totalToday: number;     // accumulated steps since local midnight
  /** Last cumulative count we processed from the watcher. Used to
   *  compute deltas and detect resets. -1 = not captured yet. */
  lastCumulative: number;
  /** The cumulative count emitted by the FIRST event of the current
   *  watcher session, kept for diagnostics. -1 = not captured yet. */
  watcherBaseline: number;
  updatedAt: number;
}

/* ---------- Constants ---------- */

const STORAGE_KEY = 'android_pedometer_today_v1';

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

const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getLocalStartOfDay = (): Date => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0, 0);
};

const emptyState = (): PersistedToday => ({
  day: todayKey(),
  totalToday: 0,
  lastCumulative: -1,
  watcherBaseline: -1,
  updatedAt: Date.now(),
});

/* ---------- Service ---------- */

class _AndroidPedometerService {
  private _available: boolean | null = null;
  private _authorized = false;
  private _subscription: any = null;
  private _state: PersistedToday = emptyState();
  private _stateLoaded = false;
  /** External callback invoked after every accepted update. */
  private _externalCallback: ((stepsToday: number) => void) | null = null;

  /* ── Capability checks ───────────────────────────── */

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

  async getPermissionStatus(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    const pedometer = getPedometer();
    if (!pedometer) return false;
    try {
      const { status } = await pedometer.getPermissionsAsync();
      this._authorized = status === 'granted';
      return this._authorized;
    } catch {
      return false;
    }
  }

  get authorized(): boolean {
    return this._authorized;
  }

  /* ── Today's steps (persisted, never throws) ─────────── */

  /**
   * Returns today's accumulated steps from the persisted baseline.
   * Safe to call any time — never throws, never calls the broken
   * `getStepCountAsync` on Android.
   */
  async getStepsToday(): Promise<PedometerStepResult | null> {
    if (Platform.OS !== 'android') return null;

    await this._ensureStateLoaded();
    this._rolloverIfNewDay();

    const start = getLocalStartOfDay();
    const end = new Date();

    const value = Math.max(0, Math.round(this._state.totalToday));
    console.log(
      `[AndroidPedometerService] stepsToday=${value} (persisted, day=${this._state.day}, lastCumulative=${this._state.lastCumulative})`
    );

    return {
      value,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }

  /* ── Live watcher with persisted baseline ────────────── */

  /**
   * Subscribe to Pedometer.watchStepCount and accumulate steps into
   * the persisted state. The optional callback receives today's running
   * total after each accepted update.
   *
   * Safe to call multiple times — restarts the watcher cleanly.
   */
  async startWatcher(callback?: (stepsToday: number) => void): Promise<void> {
    if (Platform.OS !== 'android') return;

    this._externalCallback = callback ?? null;
    this.stopWatching(); // ensure clean slate

    const pedometer = getPedometer();
    if (!pedometer) return;

    await this._ensureStateLoaded();
    this._rolloverIfNewDay();

    // Reset the per-session baseline. Each new watcher session restarts
    // the cumulative counter from 0 (expo-sensors behaviour on Android).
    this._state.watcherBaseline = -1;
    this._state.lastCumulative = -1;
    await this._persist();

    try {
      this._subscription = pedometer.watchStepCount((evt: any) => {
        const cumulative = Number(evt?.steps ?? 0);
        if (!Number.isFinite(cumulative) || cumulative < 0) return;
        this._handleWatcherEvent(cumulative).catch(() => {});
      });
      console.log('[AndroidPedometerService] Step watcher started (baseline tracking enabled)');
    } catch (e) {
      console.warn('[AndroidPedometerService] watchStepCount error:', e);
    }
  }

  /** Backwards-compat alias used by FitnessService.startPedometerWatcher. */
  watchSteps(callback: (steps: number) => void): void {
    void this.startWatcher((todayTotal) => callback(todayTotal));
  }

  stopWatching(): void {
    if (this._subscription) {
      try {
        this._subscription.remove();
      } catch {
        // silent
      }
      this._subscription = null;
      console.log('[AndroidPedometerService] Step watcher stopped');
    }
  }

  /* ── Internal: event handler ─────────────────────── */

  private async _handleWatcherEvent(cumulative: number): Promise<void> {
    this._rolloverIfNewDay();

    // First event of this session — capture baseline.
    if (this._state.watcherBaseline < 0) {
      this._state.watcherBaseline = cumulative;
      this._state.lastCumulative = cumulative;
      await this._persist();
      console.log(
        `[AndroidPedometerService] watcher baseline captured: ${cumulative} (totalToday=${this._state.totalToday})`
      );
      this._externalCallback?.(this._state.totalToday);
      return;
    }

    // Sensor reset (device reboot mid-session) — counter goes backwards.
    // Re-baseline without losing totalToday already accumulated.
    if (cumulative < this._state.lastCumulative) {
      console.log(
        `[AndroidPedometerService] Sensor reset detected (${this._state.lastCumulative} → ${cumulative}). Re-baselining.`
      );
      this._state.watcherBaseline = cumulative;
      this._state.lastCumulative = cumulative;
      await this._persist();
      this._externalCallback?.(this._state.totalToday);
      return;
    }

    // Normal forward increment: take the delta since last event.
    const delta = cumulative - this._state.lastCumulative;
    if (delta > 0) {
      this._state.totalToday += delta;
      this._state.lastCumulative = cumulative;
      this._state.updatedAt = Date.now();
      await this._persist();
      console.log(
        `[AndroidPedometerService] +${delta} steps (totalToday=${this._state.totalToday})`
      );
      this._externalCallback?.(this._state.totalToday);
    }
  }

  /* ── Internal: persistence ----------------------------- */

  private async _ensureStateLoaded(): Promise<void> {
    if (this._stateLoaded) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedToday;
        if (parsed && typeof parsed === 'object') {
          this._state = { ...emptyState(), ...parsed };
        }
      }
    } catch (e) {
      console.warn('[AndroidPedometerService] state restore failed:', e);
    } finally {
      this._stateLoaded = true;
      this._rolloverIfNewDay();
    }
  }

  private _rolloverIfNewDay(): void {
    const tk = todayKey();
    if (this._state.day !== tk) {
      console.log(
        `[AndroidPedometerService] Day rollover: ${this._state.day} → ${tk}. Resetting totalToday.`
      );
      // Preserve lastCumulative so the next delta is computed correctly.
      const preservedLast = this._state.lastCumulative;
      this._state = {
        ...emptyState(),
        day: tk,
        watcherBaseline: preservedLast >= 0 ? preservedLast : -1,
        lastCumulative: preservedLast,
      };
      void this._persist();
    }
  }

  private async _persist(): Promise<void> {
    try {
      this._state.updatedAt = Date.now();
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this._state));
    } catch {
      // silent — persistence failure is non-fatal
    }
  }

  /* ── Debug / introspection ───────────────────────── */

  /** Snapshot of the persisted state (for debug UI / diagnostics). */
  async dumpState(): Promise<PersistedToday> {
    await this._ensureStateLoaded();
    return { ...this._state };
  }

  /** Reset persisted state — debug only. */
  async _debugReset(): Promise<void> {
    this._state = emptyState();
    this._stateLoaded = true;
    await this._persist();
    console.log('[AndroidPedometerService] state reset (debug)');
  }
}

/** Singleton */
export const AndroidPedometerService = new _AndroidPedometerService();
