/**
 * FitnessService.ts
 * ──────────────────────────────────────────────────────────────
 * Central orchestrator for the fitness tracking system.
 *
 * • Coordinates StepManager + CalorieManager
 * • Manages HealthKit initialization + observers
 * • Debounces refresh calls (5s minimum between successful fetches)
 * • Handles foreground/background lifecycle
 * • Provides a single refreshAll() for UI consumption
 * ──────────────────────────────────────────────────────────────
 */

import { Platform, AppState, AppStateStatus } from 'react-native';
import { HealthKitService } from './HealthKitService';
import { StepManager } from './StepManager';
import { CalorieManager } from './CalorieManager';
import { FitnessStore } from './FitnessStore';

/* ---------- Constants ---------- */

const DEBOUNCE_MS = 5_000; // Minimum between successful refreshes
const POLL_INTERVAL_MS = 20_000; // Auto-refresh when active
const DAY_CHECK_INTERVAL_MS = 60_000; // Check for day boundary every minute

/* ---------- Service ---------- */

class _FitnessService {
  private _initialized = false;
  private _lastRefresh = 0;
  private _refreshing = false;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _dayCheckTimer: ReturnType<typeof setInterval> | null = null;
  private _appStateSubscription: any = null;
  private _lastDayKey: string = '';

  /**
   * Initialize the fitness tracking system.
   * Call once after auth is confirmed (e.g. in _layout.tsx).
   *
   * @param userWeightKg — Optional user weight for calorie estimation fallback
   */
  async initialize(userWeightKg?: number): Promise<void> {
    if (this._initialized) {
      console.log('[FitnessService] Already initialized');
      return;
    }

    console.log('[FitnessService] Initializing...');

    // Restore cached state first for instant UI
    await FitnessStore.restoreFromCache();

    // Set user weight for calorie estimation
    if (userWeightKg && userWeightKg > 0) {
      CalorieManager.setUserWeight(userWeightKg);
    }

    // Check HealthKit availability
    const isAvailable = HealthKitService.isAvailable();
    FitnessStore.update({ isHealthKitAvailable: isAvailable });

    // Initialize HealthKit (iOS only)
    if (isAvailable) {
      const authorized = await HealthKitService.initialize();
      FitnessStore.update({ isHealthKitAuthorized: authorized });

      if (authorized) {
        // Set up background observer for step updates
        HealthKitService.observeSteps(() => {
          this._onHealthKitUpdate();
        });

        // Try to get weight from HealthKit
        const weight = await HealthKitService.getLatestWeight();
        if (weight) {
          CalorieManager.setUserWeight(weight);
        }
      }
    }

    // Set up day boundary tracking
    this._lastDayKey = this._getTodayKey();
    this._dayCheckTimer = setInterval(() => this._checkDayBoundary(), DAY_CHECK_INTERVAL_MS);

    // Listen for app state changes
    this._appStateSubscription = AppState.addEventListener('change', this._onAppStateChange);

    this._initialized = true;

    // First fetch
    await this.refreshAll(true);

    // Start auto-polling
    this._startPolling();

    console.log('[FitnessService] Initialized successfully');
  }

  /**
   * Refresh all fitness data (steps + calories).
   * Debounced — won't re-fetch if last successful fetch was < 5s ago.
   *
   * @param force — Bypass debounce
   */
  async refreshAll(force = false): Promise<void> {
    const now = Date.now();

    // Debounce guard
    if (!force && now - this._lastRefresh < DEBOUNCE_MS) {
      console.log(
        `[FitnessService] debounced: skipping refresh (last: ${Math.round((now - this._lastRefresh) / 1000)}s ago)`
      );
      return;
    }

    // Re-entrancy guard
    if (this._refreshing) {
      console.log('[FitnessService] refresh already in progress');
      return;
    }

    this._refreshing = true;

    try {
      // Fetch steps and calories in parallel
      const [stepResult, calorieResult] = await Promise.all([
        StepManager.fetch(force),
        CalorieManager.fetch(StepManager.getCached().steps, force),
      ]);

      // Update the central store with both results
      FitnessStore.update({
        steps: stepResult.steps,
        distanceKm: stepResult.distanceKm,
        caloriesBurned: calorieResult.totalCaloriesBurned,
        healthKitCalories: calorieResult.healthKitCalories,
        estimatedCalories: calorieResult.estimatedCalories,
        manualCalories: calorieResult.manualCalories,
        walkingCalories: calorieResult.walkingCalories,
        source: stepResult.source === 'healthkit' ? 'healthkit' : calorieResult.source,
        isLoading: false,
      });

      this._lastRefresh = Date.now();

      console.log(
        `[FitnessService] refresh complete | steps: ${stepResult.steps} | burn: ${calorieResult.totalCaloriesBurned} | source: ${stepResult.source}`
      );
    } catch (e) {
      console.warn('[FitnessService] refresh error:', e);
      FitnessStore.update({ isLoading: false });
    } finally {
      this._refreshing = false;
    }
  }

  /**
   * Get a synchronous snapshot of current state.
   * For immediate UI rendering without waiting for async fetch.
   */
  getSnapshot() {
    return FitnessStore.getState();
  }

  /**
   * Update user weight (called when profile data loads).
   */
  setUserWeight(weightKg: number): void {
    if (weightKg > 0) {
      CalorieManager.setUserWeight(weightKg);
    }
  }

  /**
   * Start auto-polling. Called on initialization and when app returns to foreground.
   */
  startPolling(): void {
    this._startPolling();
  }

  /**
   * Stop auto-polling. Called when app goes to background.
   */
  stopPolling(): void {
    this._stopPolling();
  }

  /**
   * Clean up all resources.
   */
  destroy(): void {
    this._stopPolling();
    if (this._dayCheckTimer) {
      clearInterval(this._dayCheckTimer);
      this._dayCheckTimer = null;
    }
    if (this._appStateSubscription) {
      this._appStateSubscription.remove();
      this._appStateSubscription = null;
    }
    this._initialized = false;
    console.log('[FitnessService] Destroyed');
  }

  /* ── Internal ── */

  private _startPolling(): void {
    this._stopPolling();
    this._pollTimer = setInterval(() => {
      this.refreshAll(false);
    }, POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private _onAppStateChange = (state: AppStateStatus): void => {
    if (state === 'active') {
      console.log('[FitnessService] App returned to foreground — refreshing');
      this._checkDayBoundary();
      this.refreshAll(true);
      this._startPolling();
    } else if (state === 'background') {
      console.log('[FitnessService] App moved to background — stopping poll');
      this._stopPolling();
    }
  };

  /**
   * Called when HealthKit observer fires (new step/energy data available).
   */
  private _onHealthKitUpdate(): void {
    console.log('[FitnessService] HealthKit observer triggered — refreshing');
    // Force refresh but respect a shorter debounce for observer triggers
    const now = Date.now();
    if (now - this._lastRefresh > 3000) {
      this.refreshAll(true);
    }
  }

  /**
   * Check if we've crossed a day boundary and reset managers if so.
   */
  private _checkDayBoundary(): void {
    const currentDay = this._getTodayKey();
    if (currentDay !== this._lastDayKey) {
      console.log(`[FitnessService] Day boundary: ${this._lastDayKey} → ${currentDay}`);
      this._lastDayKey = currentDay;
      StepManager.resetForNewDay();
      CalorieManager.resetForNewDay();
      this._lastRefresh = 0; // Allow immediate refresh
    }
  }

  private _getTodayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
  }
}

/** Singleton */
export const FitnessService = new _FitnessService();
