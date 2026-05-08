/**
 * useFitness.ts
 * ──────────────────────────────────────────────────────────────
 * React hook for consuming fitness data from the FitnessStore.
 *
 * • Subscribes to FitnessStore updates for reactive UI
 * • Returns stable memoized values to prevent unnecessary re-renders
 * • Provides refresh() for pull-to-refresh patterns
 * • Auto-cleans up subscription on unmount
 * ──────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { FitnessStore, FitnessState, FitnessSource } from '../services/fitness/FitnessStore';
import { FitnessService } from '../services/fitness/FitnessService';

/* ---------- Types ---------- */

export interface UseFitnessResult {
  /** Current step count for today */
  steps: number;
  /** Distance walked in km (estimated from steps) */
  distanceKm: number;
  /** Total calories burned today (HealthKit + manual) */
  caloriesBurned: number;
  /** Calories from HealthKit ActiveEnergyBurned */
  healthKitCalories: number;
  /** Estimated calories from step count (fallback) */
  estimatedCalories: number;
  /** Manual burn logs from backend */
  manualCalories: number;
  /** Walking/auto-tracked calories */
  walkingCalories: number;
  /** Data source: 'healthkit' | 'pedometer' | 'backend' | 'estimated' | 'none' */
  source: FitnessSource;
  /** Whether HealthKit is available on this device (iOS) */
  isHealthKitAvailable: boolean;
  /** Whether HealthKit permissions have been granted (iOS) */
  isHealthKitAuthorized: boolean;
  /** Whether Android pedometer hardware is available */
  isPedometerAvailable: boolean;
  /** Whether ACTIVITY_RECOGNITION permission has been granted (Android) */
  isPedometerAuthorized: boolean;
  /** Whether data is currently being fetched */
  isLoading: boolean;
  /** Timestamp of last successful data update */
  lastUpdated: number;
  /** Trigger a manual refresh (for pull-to-refresh) */
  refresh: () => Promise<void>;
}

/* ---------- Hook ---------- */

export function useFitness(): UseFitnessResult {
  const [state, setState] = useState<FitnessState>(FitnessStore.getState());
  const mountedRef = useRef(true);

  // Subscribe to store updates
  useEffect(() => {
    mountedRef.current = true;

    const unsubscribe = FitnessStore.subscribe((newState) => {
      if (mountedRef.current) {
        setState(newState);
      }
    });

    // Sync with current state (may have changed between render and effect)
    setState(FitnessStore.getState());

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  // Manual refresh handler
  const refresh = useCallback(async () => {
    await FitnessService.refreshAll(true);
  }, []);

  return {
    steps: state.steps,
    distanceKm: state.distanceKm,
    caloriesBurned: state.caloriesBurned,
    healthKitCalories: state.healthKitCalories,
    estimatedCalories: state.estimatedCalories,
    manualCalories: state.manualCalories,
    walkingCalories: state.walkingCalories,
    source: state.source,
    isHealthKitAvailable: state.isHealthKitAvailable,
    isHealthKitAuthorized: state.isHealthKitAuthorized,
    isPedometerAvailable: state.isPedometerAvailable,
    isPedometerAuthorized: state.isPedometerAuthorized,
    isLoading: state.isLoading,
    lastUpdated: state.lastUpdated,
    refresh,
  };
}
