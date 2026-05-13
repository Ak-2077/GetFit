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
import {
  CalorieReconciliationEngine,
  type MetricSnapshot,
} from './CalorieReconciliationEngine';

/* ---------- Types ---------- */

export type FitnessSource = 'healthkit' | 'pedometer' | 'backend' | 'estimated' | 'none';

export interface FitnessState {
  steps: number;
  distanceKm: number;
  caloriesBurned: number;
  healthKitCalories: number;
  estimatedCalories: number;
  manualCalories: number;
  walkingCalories: number;
  source: FitnessSource;
  /** Human-readable source description for the UI */
  sourceLabel: string;
  /** 0–100 confidence score for the chosen calorie source */
  confidence: number;
  /** True when HealthKit appears denied (heuristic) and we recommend
   *  prompting the user to enable Apple Health permissions. */
  permissionIssue: boolean;
  /** True while reconciliation is holding a suspicious drop and we
   *  expect a retry shortly (UI may show a subtle "Syncing" hint). */
  isSyncing: boolean;
  lastUpdated: number;
  isHealthKitAvailable: boolean;
  isHealthKitAuthorized: boolean;
  isPedometerAvailable: boolean;
  isPedometerAuthorized: boolean;
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
  sourceLabel: '',
  confidence: 0,
  permissionIssue: false,
  isSyncing: false,
  lastUpdated: 0,
  isHealthKitAvailable: false,
  isHealthKitAuthorized: false,
  isPedometerAvailable: false,
  isPedometerAuthorized: false,
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

  /** Per-metric metadata used by the reconciliation engine to make
   *  confidence-aware decisions. Not part of the public FitnessState
   *  (which only exposes what the UI needs). */
  private _stepsMeta: MetricSnapshot = {
    value: 0,
    source: 'none',
    confidence: 0,
    timestamp: 0,
    estimated: false,
  };
  private _caloriesMeta: MetricSnapshot = {
    value: 0,
    source: 'none',
    confidence: 0,
    timestamp: 0,
    estimated: false,
  };

  /** Number of consecutive holds (suspicious drops). The caller can
   *  read this to decide whether to keep retrying. */
  private _retryHints = { steps: 0, calories: 0 };

  constructor() {
    this._lastDayKey = getTodayKey();
  }

  /** Read the pending-retry hints (consumed by FitnessService). */
  consumeRetryHint(): { steps: boolean; calories: boolean } {
    const hint = {
      steps: this._retryHints.steps > 0,
      calories: this._retryHints.calories > 0,
    };
    this._retryHints = { steps: 0, calories: 0 };
    return hint;
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
      this._state = { ...INITIAL_STATE, isHealthKitAvailable: this._state.isHealthKitAvailable, isHealthKitAuthorized: this._state.isHealthKitAuthorized, isPedometerAvailable: this._state.isPedometerAvailable, isPedometerAuthorized: this._state.isPedometerAuthorized };
    }

    const next = { ...this._state };
    const now = Date.now();

    const incomingConfidence =
      partial.confidence !== undefined ? partial.confidence : this._caloriesMeta.confidence;
    const incomingSource: FitnessSource = partial.source ?? this._caloriesMeta.source;
    const recalculation = (partial as any).recalculation === true;
    let isSyncingNext = false;

    // ── Step reconciliation ───────────────────────────────────
    if (partial.steps !== undefined) {
      const decision = CalorieReconciliationEngine.reconcile(
        this._state.steps > 0 ? this._stepsMeta : null,
        {
          value: partial.steps,
          source: incomingSource,
          confidence: incomingConfidence,
          timestamp: now,
          estimated: false,
          recalculation,
        }
      );
      console.log(
        `[FitnessResolver] steps comparing: old=${this._state.steps} (${this._stepsMeta.source}, conf=${this._stepsMeta.confidence}) new=${partial.steps} (${incomingSource}, conf=${incomingConfidence}) → ${
          decision.accept ? 'ACCEPT' : 'HOLD'
        } (${decision.reason})`
      );
      if (decision.accept) {
        next.steps = partial.steps;
        next.distanceKm = Number((partial.steps * 0.000762).toFixed(2));
        this._stepsMeta = {
          value: partial.steps,
          source: incomingSource,
          confidence: incomingConfidence,
          timestamp: now,
          estimated: false,
        };
      } else if (decision.suggestRetry) {
        this._retryHints.steps += 1;
        isSyncingNext = true;
      }
    }

    if (partial.distanceKm !== undefined && partial.distanceKm >= next.distanceKm) {
      next.distanceKm = Number(partial.distanceKm.toFixed(2));
    }

    // ── Calorie reconciliation ────────────────────────────────
    if (partial.caloriesBurned !== undefined) {
      const estimatedFlag =
        (partial as any).estimated === true ||
        (incomingSource !== 'healthkit' && incomingSource !== 'pedometer');
      const decision = CalorieReconciliationEngine.reconcile(
        this._state.caloriesBurned > 0 ? this._caloriesMeta : null,
        {
          value: partial.caloriesBurned,
          source: incomingSource,
          confidence: incomingConfidence,
          timestamp: now,
          estimated: estimatedFlag,
          recalculation,
        }
      );
      console.log(
        `[FitnessResolver] calories comparing: old=${this._state.caloriesBurned} (${this._caloriesMeta.source}, conf=${this._caloriesMeta.confidence}) new=${partial.caloriesBurned} (${incomingSource}, conf=${incomingConfidence}) → ${
          decision.accept ? 'ACCEPT' : 'HOLD'
        } (${decision.reason})`
      );
      if (decision.accept) {
        next.caloriesBurned = partial.caloriesBurned;
        this._caloriesMeta = {
          value: partial.caloriesBurned,
          source: incomingSource,
          confidence: incomingConfidence,
          timestamp: now,
          estimated: estimatedFlag,
        };
      } else if (decision.suggestRetry) {
        this._retryHints.calories += 1;
        isSyncingNext = true;
      }
    }

    // Sync flag — cleared on the next accepted update (or set if any hold).
    next.isSyncing = isSyncingNext;

    // Non-monotonic fields (metadata, can change freely)
    if (partial.healthKitCalories !== undefined) next.healthKitCalories = partial.healthKitCalories;
    if (partial.estimatedCalories !== undefined) next.estimatedCalories = partial.estimatedCalories;
    if (partial.manualCalories !== undefined) next.manualCalories = partial.manualCalories;
    if (partial.walkingCalories !== undefined) next.walkingCalories = partial.walkingCalories;
    if (partial.source !== undefined) next.source = partial.source;
    if (partial.sourceLabel !== undefined) next.sourceLabel = partial.sourceLabel;
    if (partial.confidence !== undefined) next.confidence = partial.confidence;
    if (partial.permissionIssue !== undefined) next.permissionIssue = partial.permissionIssue;
    if (partial.isHealthKitAvailable !== undefined) next.isHealthKitAvailable = partial.isHealthKitAvailable;
    if (partial.isHealthKitAuthorized !== undefined) next.isHealthKitAuthorized = partial.isHealthKitAuthorized;
    if (partial.isPedometerAvailable !== undefined) next.isPedometerAvailable = partial.isPedometerAvailable;
    if (partial.isPedometerAuthorized !== undefined) next.isPedometerAuthorized = partial.isPedometerAuthorized;
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
