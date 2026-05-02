/**
 * FitnessStore.ts
 * ──────────────────────────────────────────────────────────────
 * Central state store for fitness data with event emitter pattern.
 *
 * • Single source of truth for steps + calories across all tabs
 * • Monotonic guarantees — values never decrease within a day
 * • Subscribable — UI hooks register listeners for reactive updates
 * • Day boundary detection — auto-resets at midnight
 * ──────────────────────────────────────────────────────────────
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/* ---------- Types ---------- */

export type FitnessSource = 'healthkit' | 'backend' | 'estimated' | 'none';

export interface FitnessState {
  steps: number;
  distanceKm: number;
  caloriesBurned: number;
  healthKitCalories: number;
  estimatedCalories: number;
  manualCalories: number;
  walkingCalories: number;
  source: FitnessSource;
  lastUpdated: number;
  isHealthKitAvailable: boolean;
  isHealthKitAuthorized: boolean;
  isLoading: boolean;
}

export type FitnessListener = (state: FitnessState) => void;

/* ---------- Constants ---------- */

const CACHE_KEY = 'fitness_store_cache';
const CACHE_DAY_KEY = 'fitness_store_day';

const INITIAL_STATE: FitnessState = {
  steps: 0,
  distanceKm: 0,
  caloriesBurned: 0,
  healthKitCalories: 0,
  estimatedCalories: 0,
  manualCalories: 0,
  walkingCalories: 0,
  source: 'none',
  lastUpdated: 0,
  isHealthKitAvailable: false,
  isHealthKitAuthorized: false,
  isLoading: true,
};

/* ---------- Helpers ---------- */

const getTodayKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
};

/* ---------- Store ---------- */

class _FitnessStore {
  private _state: FitnessState = { ...INITIAL_STATE };
  private _listeners: Set<FitnessListener> = new Set();
  private _lastDayKey: string = '';

  constructor() {
    this._lastDayKey = getTodayKey();
  }

  /* ── Public API ── */

  getState(): FitnessState {
    return { ...this._state };
  }

  subscribe(listener: FitnessListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Update the store with new fitness data.
   * Applies monotonic guarantees — new values must be ≥ current values
   * within the same day.
   */
  update(partial: Partial<FitnessState>): void {
    const currentDay = getTodayKey();

    // Day boundary — reset everything if the day changed
    if (currentDay !== this._lastDayKey) {
      console.log(
        `[FitnessStore] Day boundary detected: ${this._lastDayKey} → ${currentDay} — resetting`
      );
      this._lastDayKey = currentDay;
      this._state = { ...INITIAL_STATE, isHealthKitAvailable: this._state.isHealthKitAvailable, isHealthKitAuthorized: this._state.isHealthKitAuthorized };
    }

    const next = { ...this._state };

    // Monotonic step guarantee
    if (partial.steps !== undefined) {
      if (partial.steps < this._state.steps && this._state.steps > 0) {
        console.warn(
          `[FitnessStore] ⚠️ step drop detected: ${this._state.steps} → ${partial.steps} (keeping ${this._state.steps})`
        );
      } else {
        next.steps = partial.steps;
        // Recalculate distance from steps: average stride ~0.762m
        next.distanceKm = Number(((partial.steps * 0.000762)).toFixed(2));
      }
    }

    if (partial.distanceKm !== undefined && partial.distanceKm >= next.distanceKm) {
      next.distanceKm = Number(partial.distanceKm.toFixed(2));
    }

    // Monotonic calorie guarantee
    if (partial.caloriesBurned !== undefined) {
      if (partial.caloriesBurned < this._state.caloriesBurned && this._state.caloriesBurned > 0) {
        console.warn(
          `[FitnessStore] ⚠️ calorie drop detected: ${this._state.caloriesBurned} → ${partial.caloriesBurned} (keeping ${this._state.caloriesBurned})`
        );
      } else {
        next.caloriesBurned = partial.caloriesBurned;
      }
    }

    // Non-monotonic fields (metadata, can change freely)
    if (partial.healthKitCalories !== undefined) next.healthKitCalories = partial.healthKitCalories;
    if (partial.estimatedCalories !== undefined) next.estimatedCalories = partial.estimatedCalories;
    if (partial.manualCalories !== undefined) next.manualCalories = partial.manualCalories;
    if (partial.walkingCalories !== undefined) next.walkingCalories = partial.walkingCalories;
    if (partial.source !== undefined) next.source = partial.source;
    if (partial.isHealthKitAvailable !== undefined) next.isHealthKitAvailable = partial.isHealthKitAvailable;
    if (partial.isHealthKitAuthorized !== undefined) next.isHealthKitAuthorized = partial.isHealthKitAuthorized;
    if (partial.isLoading !== undefined) next.isLoading = partial.isLoading;

    next.lastUpdated = Date.now();
    this._state = next;

    // Notify listeners
    this._emit();

    // Persist to cache (fire-and-forget)
    this._persistCache().catch(() => {});
  }

  /**
   * Restore cached state from AsyncStorage.
   * Only restores if the cached day matches today.
   */
  async restoreFromCache(): Promise<void> {
    try {
      const [cachedDay, cachedState] = await Promise.all([
        AsyncStorage.getItem(CACHE_DAY_KEY),
        AsyncStorage.getItem(CACHE_KEY),
      ]);

      const today = getTodayKey();

      if (cachedDay !== today || !cachedState) {
        console.log('[FitnessStore] Cache miss or stale day — starting fresh');
        return;
      }

      const parsed: FitnessState = JSON.parse(cachedState);
      // Restore only data fields, not loading states
      this._state = {
        ...parsed,
        isLoading: true, // will be set to false after first fetch
        lastUpdated: parsed.lastUpdated || 0,
      };

      console.log(
        `[FitnessStore] Restored cache: steps=${parsed.steps}, burn=${parsed.caloriesBurned}`
      );
    } catch (e) {
      console.warn('[FitnessStore] Cache restore failed:', e);
    }
  }

  /* ── Internal ── */

  private _emit(): void {
    const snapshot = this.getState();
    this._listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch (e) {
        console.warn('[FitnessStore] Listener error:', e);
      }
    });
  }

  private async _persistCache(): Promise<void> {
    try {
      await Promise.all([
        AsyncStorage.setItem(CACHE_DAY_KEY, getTodayKey()),
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(this._state)),
      ]);
    } catch {
      // silent
    }
  }
}

/** Singleton */
export const FitnessStore = new _FitnessStore();
