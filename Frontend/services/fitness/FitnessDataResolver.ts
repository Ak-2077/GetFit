/**
 * FitnessDataResolver.ts
 * ──────────────────────────────────────────────────────────────
 * Central data-resolution layer for the fitness tracking system.
 *
 * Combines all available step + calorie sources, scores each by a
 * confidence model, detects HealthKit permission issues vs genuine
 * inactivity, and emits a single clean snapshot for the UI.
 *
 * Priority (steps + active calories):
 *   1. HealthKit Active Energy  (confidence 100)  — iOS
 *   2. Health Connect           (confidence 95)   — Android
 *   3. HealthKit Steps → estimated kcal (confidence 85)
 *   4. Health Connect Steps → estimated kcal (confidence 90)
 *   5. iPhone / Android pedometer → estimated kcal (confidence 65)
 *   6. Backend / cached steps   (confidence 55)
 *   7. BMR + light-activity baseline only (confidence 40)
 *
 * Manual workout calories (confidence 75) are *additive* on top of the
 * chosen source, never used as the primary source for steps.
 * ──────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';
import { HealthKitService } from './HealthKitService';
import { HealthConnectService } from './HealthConnectService';
import { PedometerService } from './PedometerService';
import { getCaloriesBurn, getStepsToday } from '../api';
import {
  estimateActiveCaloriesFromSteps,
  estimateBaselineActiveCaloriesElapsed,
  UserProfile,
} from './CalorieEstimator';
import type { FitnessSource } from './FitnessStore';

/* ---------- Types ---------- */

export interface ResolvedFitnessData {
  steps: number;
  calories: number;
  /** Active calories from chosen source (excludes manual workouts) */
  activeCalories: number;
  /** Manually-logged workout calories from backend */
  manualCalories: number;
  /** Distance km derived from final step count */
  distanceKm: number;
  /** Primary source identifier */
  source: FitnessSource;
  /** Human-readable source label for the UI */
  sourceLabel: string;
  /** 0–100 confidence score for the chosen calorie source */
  confidence: number;
  /** True if calories are estimated (any non-HealthKit/HC) */
  estimated: boolean;
  /** True if HealthKit appears denied (heuristic) */
  permissionIssue: boolean;
  /** Diagnostic info for logs / debug UI */
  reason: string;
}

interface ResolveInput {
  profile: Partial<UserProfile>;
}

/* ---------- Constants ---------- */

const STRIDE_M = 0.762; // ~average adult stride
const TRAILING_DAYS_FOR_DENIAL_CHECK = 7;

/* ---------- Resolver ---------- */

class _FitnessDataResolver {
  /**
   * Resolve all sources and produce a single best-effort snapshot.
   * This is a *read* operation — no caching, no side effects beyond
   * upstream service calls (which have their own throttles).
   */
  async resolve(input: ResolveInput): Promise<ResolvedFitnessData> {
    const { profile } = input;

    /* ── 1. Collect from all sources in parallel ─────────────── */

    const [
      hkSteps,
      hkActiveCals,
      hcSteps,
      hcActiveCals,
      hcDistance,
      pedometerSteps,
      pedometerWeekSteps,
      hkWeekSteps,
      backendData,
    ] = await Promise.all([
      HealthKitService.initialized ? HealthKitService.getStepsToday() : Promise.resolve(null),
      HealthKitService.initialized
        ? HealthKitService.getActiveEnergyBurnedToday()
        : Promise.resolve(null),
      // Health Connect — Android only (no-ops on iOS internally)
      Platform.OS === 'android' && HealthConnectService.initialized && HealthConnectService.authorized
        ? HealthConnectService.getStepsToday()
        : Promise.resolve(null),
      Platform.OS === 'android' && HealthConnectService.initialized && HealthConnectService.authorized
        ? HealthConnectService.getActiveCaloriesToday()
        : Promise.resolve(null),
      Platform.OS === 'android' && HealthConnectService.initialized && HealthConnectService.authorized
        ? HealthConnectService.getDistanceToday()
        : Promise.resolve(null),
      PedometerService.getStepsToday(),
      Platform.OS === 'ios'
        ? PedometerService.getStepsTrailingDays(TRAILING_DAYS_FOR_DENIAL_CHECK)
        : Promise.resolve(null),
      HealthKitService.initialized
        ? HealthKitService.getStepsTrailingDays(TRAILING_DAYS_FOR_DENIAL_CHECK)
        : Promise.resolve(null),
      this._fetchBackend(),
    ]);

    const hkStepsToday = hkSteps?.value ?? null;
    const hkCalsToday = hkActiveCals?.value ?? null;
    const hcStepsToday = hcSteps?.value ?? null;
    const hcCalsToday = hcActiveCals?.value ?? null;
    const hcDistanceM = hcDistance?.value ?? null;
    // PedometerService.getStepsToday works on both iOS (CMPedometer) and
    // Android (expo-sensors step counter). It safely returns null when
    // unavailable / unauthorized.
    const pedoStepsToday = pedometerSteps?.steps ?? null;

    /* ── 2. Detect HealthKit denial via heuristic ────────────── */

    const permissionIssue = this._detectPermissionIssue({
      hkInitialized: HealthKitService.initialized,
      hkStepsToday,
      hkCalsToday,
      hkWeekSteps,
      pedometerWeekSteps,
      pedoStepsToday,
      hcStepsToday,
    });

    /* ── 3. Choose steps source ──────────────────────────────── */

    const stepChoice = this._chooseSteps({
      hkStepsToday,
      hcStepsToday,
      pedoStepsToday,
      backendSteps: backendData.steps,
      permissionIssue,
    });

    /* ── 4. Choose calorie source ────────────────────────────── */

    const calorieChoice = this._chooseCalories({
      hkCalsToday,
      hcCalsToday,
      finalSteps: stepChoice.steps,
      stepSource: stepChoice.source,
      permissionIssue,
      profile,
    });

    /* ── 5. Compose ──────────────────────────────────────────── */

    const manualCalories = Math.max(0, Math.round(backendData.manualCalories));

    // Prefer HC distance if available (measured), otherwise estimate from steps
    let distanceKm: number;
    if (hcDistanceM !== null && hcDistanceM > 0) {
      distanceKm = Number((hcDistanceM * 0.001).toFixed(2));
    } else {
      distanceKm = Number((stepChoice.steps * STRIDE_M * 0.001).toFixed(2));
    }

    const totalCalories = calorieChoice.activeCalories + manualCalories;

    // Primary source label uses the calorie source; manual is additive
    const source: FitnessSource = calorieChoice.source;
    const sourceLabel = this._sourceLabel(source, !!calorieChoice.estimated);
    const reason = `steps:${stepChoice.reason} | cals:${calorieChoice.reason}`;

    const snapshot: ResolvedFitnessData = {
      steps: stepChoice.steps,
      calories: totalCalories,
      activeCalories: calorieChoice.activeCalories,
      manualCalories,
      distanceKm,
      source,
      sourceLabel,
      confidence: calorieChoice.confidence,
      estimated: !!calorieChoice.estimated,
      permissionIssue,
      reason,
    };

    console.log(
      `[FitnessResolver] steps=${snapshot.steps} (${stepChoice.source}) | ` +
        `cals=${snapshot.calories} (${snapshot.source}, conf=${snapshot.confidence}, ` +
        `estimated=${snapshot.estimated}) | permIssue=${snapshot.permissionIssue}`
    );

    return snapshot;
  }

  /* ── Source selection ──────────────────────────────────────── */

  private _chooseSteps(opts: {
    hkStepsToday: number | null;
    hcStepsToday: number | null;
    pedoStepsToday: number | null;
    backendSteps: number;
    permissionIssue: boolean;
  }): { steps: number; source: FitnessSource; reason: string } {
    const { hkStepsToday, hcStepsToday, pedoStepsToday, backendSteps, permissionIssue } = opts;

    // 1. HealthKit (iOS) — prefer when actively returning data
    if (!permissionIssue && hkStepsToday !== null && hkStepsToday > 0) {
      return { steps: hkStepsToday, source: 'healthkit', reason: 'hk-active' };
    }

    // 2. Health Connect (Android) — persistent historical data
    if (hcStepsToday !== null && hcStepsToday > 0) {
      return { steps: hcStepsToday, source: 'health_connect', reason: 'hc-active' };
    }

    // 3. Pedometer (CMPedometer iOS fallback / Android watcher)
    if (pedoStepsToday !== null && pedoStepsToday > 0) {
      return { steps: pedoStepsToday, source: 'pedometer', reason: 'pedometer' };
    }

    // Even when both are 0 today, prefer HK as the authoritative 0 if no permission issue
    if (!permissionIssue && hkStepsToday === 0) {
      return { steps: 0, source: 'healthkit', reason: 'hk-zero-genuine' };
    }

    // HC zero is also authoritative when available
    if (hcStepsToday === 0 && hcStepsToday !== null) {
      return { steps: 0, source: 'health_connect', reason: 'hc-zero-genuine' };
    }

    // Pedometer returning 0 means the service IS running (user just hasn't walked)
    if (pedoStepsToday !== null && pedoStepsToday === 0) {
      return { steps: 0, source: 'pedometer', reason: 'pedometer-zero-genuine' };
    }

    if (backendSteps > 0) {
      return { steps: backendSteps, source: 'backend', reason: 'backend' };
    }

    return { steps: 0, source: 'none', reason: 'no-source' };
  }

  private _chooseCalories(opts: {
    hkCalsToday: number | null;
    hcCalsToday: number | null;
    finalSteps: number;
    stepSource: FitnessSource;
    permissionIssue: boolean;
    profile: Partial<UserProfile>;
  }): {
    activeCalories: number;
    source: FitnessSource;
    confidence: number;
    estimated: boolean;
    reason: string;
  } {
    const { hkCalsToday, hcCalsToday, finalSteps, stepSource, permissionIssue, profile } = opts;

    // 1. HealthKit Active Energy — gold standard (iOS)
    if (!permissionIssue && hkCalsToday !== null && hkCalsToday > 0) {
      return {
        activeCalories: Math.round(hkCalsToday),
        source: 'healthkit',
        confidence: 100,
        estimated: false,
        reason: 'hk-active-energy',
      };
    }

    // 2. Health Connect Active Calories — gold standard (Android)
    if (hcCalsToday !== null && hcCalsToday > 0) {
      return {
        activeCalories: Math.round(hcCalsToday),
        source: 'health_connect',
        confidence: 95,
        estimated: false,
        reason: 'hc-active-energy',
      };
    }

    // 3. HealthKit steps but no HK Active Energy yet → estimate from HK steps
    if (!permissionIssue && stepSource === 'healthkit' && finalSteps > 0) {
      const est = estimateActiveCaloriesFromSteps(finalSteps, profile);
      return {
        activeCalories: est,
        source: 'healthkit',
        confidence: 85,
        estimated: true,
        reason: 'hk-steps→est',
      };
    }

    // 4. Health Connect steps but no HC Active Calories → estimate from HC steps
    if (stepSource === 'health_connect' && finalSteps > 0) {
      const est = estimateActiveCaloriesFromSteps(finalSteps, profile);
      return {
        activeCalories: est,
        source: 'health_connect',
        confidence: 90,
        estimated: true,
        reason: 'hc-steps→est',
      };
    }

    // 5. Pedometer steps → estimate
    if (stepSource === 'pedometer' && finalSteps > 0) {
      const est = estimateActiveCaloriesFromSteps(finalSteps, profile);
      return {
        activeCalories: est,
        source: 'pedometer',
        confidence: 65,
        estimated: true,
        reason: 'pedometer-steps→est',
      };
    }

    // 6. Backend steps → estimate
    if (stepSource === 'backend' && finalSteps > 0) {
      const est = estimateActiveCaloriesFromSteps(finalSteps, profile);
      return {
        activeCalories: est,
        source: 'backend',
        confidence: 55,
        estimated: true,
        reason: 'backend-steps→est',
      };
    }

    // 7. HK genuinely zero today + authorized → trust the zero
    if (!permissionIssue && hkCalsToday === 0) {
      return {
        activeCalories: 0,
        source: 'healthkit',
        confidence: 95,
        estimated: false,
        reason: 'hk-zero-genuine',
      };
    }

    // 7b. HC genuinely zero today → trust the zero
    if (hcCalsToday === 0 && hcCalsToday !== null) {
      return {
        activeCalories: 0,
        source: 'health_connect',
        confidence: 90,
        estimated: false,
        reason: 'hc-zero-genuine',
      };
    }

    // 8. Last-resort baseline — never leave UI at 0 with permissions issue
    const baseline = estimateBaselineActiveCaloriesElapsed(profile);
    return {
      activeCalories: baseline,
      source: 'estimated',
      confidence: 40,
      estimated: true,
      reason: 'baseline-bmr',
    };
  }

  /* ── Permission heuristic ──────────────────────────────────── */

  /**
   * Detect permission issues on both platforms:
   *
   * iOS:  Apple does not let us directly query READ-permission status.
   *       We infer denial by comparing HK to the pedometer over a
   *       trailing window.
   *
   * Android: If Health Connect is available but not authorized, AND the
   *          pedometer is also not delivering data → permission issue.
   */
  private _detectPermissionIssue(opts: {
    hkInitialized: boolean;
    hkStepsToday: number | null;
    hkCalsToday: number | null;
    hkWeekSteps: number | null;
    pedometerWeekSteps: number | null;
    pedoStepsToday: number | null;
    hcStepsToday: number | null;
  }): boolean {
    // ── iOS: HealthKit denial heuristic ──
    if (Platform.OS === 'ios') {
      if (!opts.hkInitialized) return false;

      const hkAllZero =
        (opts.hkStepsToday === 0 || opts.hkStepsToday === null) &&
        (opts.hkCalsToday === 0 || opts.hkCalsToday === null) &&
        (opts.hkWeekSteps === 0 || opts.hkWeekSteps === null);

      const pedoHasData =
        (opts.pedometerWeekSteps !== null && opts.pedometerWeekSteps > 0) ||
        (opts.pedoStepsToday !== null && opts.pedoStepsToday > 0);

      return hkAllZero && pedoHasData;
    }

    // ── Android: No data from any source ──
    if (Platform.OS === 'android') {
      const hasHCData = opts.hcStepsToday !== null && opts.hcStepsToday >= 0;
      const hasPedoData = opts.pedoStepsToday !== null && opts.pedoStepsToday > 0;

      // If Health Connect is delivering data, no permission issue
      if (hasHCData) return false;

      // If pedometer is delivering data, no permission issue
      if (hasPedoData) return false;

      // Pedometer is connected and returning 0 (user hasn't walked) → NOT a permission issue
      // pedoStepsToday === null means service unreachable; === 0 means it's working fine
      if (opts.pedoStepsToday !== null) return false;

      // Neither HC nor pedometer are providing data — likely a permission/availability issue
      const hcAvailable = HealthConnectService.available;
      const hcAuthorized = HealthConnectService.authorized;

      // HC available but not authorized → permission issue
      if (hcAvailable && !hcAuthorized) return true;

      // No data sources at all and it's been attempted
      return true;
    }

    return false;
  }

  /* ── Backend ──────────────────────────────────────────────── */

  private async _fetchBackend(): Promise<{ steps: number; manualCalories: number }> {
    let steps = 0;
    let manualCalories = 0;
    try {
      const [stepRes, burnRes] = await Promise.all([
        getStepsToday().catch(() => null),
        getCaloriesBurn().catch(() => null),
      ]);
      steps = Math.max(0, Number((stepRes as any)?.data?.steps || 0));
      manualCalories = Math.max(
        0,
        Number((burnRes as any)?.data?.manualCaloriesBurned || 0)
      );
    } catch {
      // silent — offline is fine
    }
    return { steps, manualCalories };
  }

  /* ── Labels ───────────────────────────────────────────────── */

  private _sourceLabel(source: FitnessSource, estimated: boolean): string {
    if (source === 'healthkit' && !estimated) return 'Tracked by Apple Health';
    if (source === 'healthkit' && estimated) return 'Estimated from Apple Health steps';
    if (source === 'health_connect' && !estimated) return 'Tracked by Health Connect';
    if (source === 'health_connect' && estimated) return 'Estimated from Health Connect steps';
    if (source === 'pedometer') return 'Using motion tracking';
    if (source === 'backend') return 'Estimated from synced activity';
    if (source === 'estimated') return 'Estimated from your profile';
    return 'No activity data yet';
  }
}

/** Singleton */
export const FitnessDataResolver = new _FitnessDataResolver();
