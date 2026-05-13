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
 *   1. HealthKit Active Energy  (confidence 100)
 *   2. HealthKit Steps → estimated kcal (confidence 85)
 *   3. iPhone / Android pedometer → estimated kcal (confidence 65)
 *   4. Backend / cached steps   (confidence 55)
 *   5. BMR + light-activity baseline only (confidence 40)
 *
 * Manual workout calories (confidence 75) are *additive* on top of the
 * chosen source, never used as the primary source for steps.
 * ──────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';
import { HealthKitService } from './HealthKitService';
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
  /** True if calories are estimated (any non-HealthKit) */
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
      pedometerSteps,
      pedometerWeekSteps,
      hkWeekSteps,
      backendData,
    ] = await Promise.all([
      HealthKitService.initialized ? HealthKitService.getStepsToday() : Promise.resolve(null),
      HealthKitService.initialized
        ? HealthKitService.getActiveEnergyBurnedToday()
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
    // PedometerService.getStepsToday works on both iOS (CMPedometer) and
    // Android (expo-sensors step counter). It safely returns null when
    // unavailable / unauthorized.
    const pedoStepsToday = pedometerSteps?.steps ?? null;

    /* ── 2. Detect HealthKit denial via heuristic ────────────── */

    const permissionIssue = this._detectHealthKitDenial({
      hkInitialized: HealthKitService.initialized,
      hkStepsToday,
      hkCalsToday,
      hkWeekSteps,
      pedometerWeekSteps,
      pedoStepsToday,
    });

    /* ── 3. Choose steps source ──────────────────────────────── */

    const stepChoice = this._chooseSteps({
      hkStepsToday,
      pedoStepsToday,
      backendSteps: backendData.steps,
      permissionIssue,
    });

    /* ── 4. Choose calorie source ────────────────────────────── */

    const calorieChoice = this._chooseCalories({
      hkCalsToday,
      finalSteps: stepChoice.steps,
      stepSource: stepChoice.source,
      permissionIssue,
      profile,
    });

    /* ── 5. Compose ──────────────────────────────────────────── */

    const manualCalories = Math.max(0, Math.round(backendData.manualCalories));
    const distanceKm = Number((stepChoice.steps * STRIDE_M * 0.001).toFixed(2));
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
    pedoStepsToday: number | null;
    backendSteps: number;
    permissionIssue: boolean;
  }): { steps: number; source: FitnessSource; reason: string } {
    const { hkStepsToday, pedoStepsToday, backendSteps, permissionIssue } = opts;

    // Prefer HK only when it's actually returning data OR explicitly authorized
    if (!permissionIssue && hkStepsToday !== null && hkStepsToday > 0) {
      return { steps: hkStepsToday, source: 'healthkit', reason: 'hk-active' };
    }

    if (pedoStepsToday !== null && pedoStepsToday > 0) {
      return { steps: pedoStepsToday, source: 'pedometer', reason: 'pedometer' };
    }

    // Even when both are 0 today, prefer HK as the authoritative 0 if no permission issue
    if (!permissionIssue && hkStepsToday === 0) {
      return { steps: 0, source: 'healthkit', reason: 'hk-zero-genuine' };
    }

    if (backendSteps > 0) {
      return { steps: backendSteps, source: 'backend', reason: 'backend' };
    }

    return { steps: 0, source: 'none', reason: 'no-source' };
  }

  private _chooseCalories(opts: {
    hkCalsToday: number | null;
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
    const { hkCalsToday, finalSteps, stepSource, permissionIssue, profile } = opts;

    // 1. HealthKit Active Energy — gold standard
    if (!permissionIssue && hkCalsToday !== null && hkCalsToday > 0) {
      return {
        activeCalories: Math.round(hkCalsToday),
        source: 'healthkit',
        confidence: 100,
        estimated: false,
        reason: 'hk-active-energy',
      };
    }

    // 2. HealthKit steps but no HK Active Energy yet → estimate from HK steps
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

    // 3. Pedometer steps → estimate
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

    // 4. Backend steps → estimate
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

    // 5. HK genuinely zero today + authorized → trust the zero
    if (!permissionIssue && hkCalsToday === 0) {
      return {
        activeCalories: 0,
        source: 'healthkit',
        confidence: 95,
        estimated: false,
        reason: 'hk-zero-genuine',
      };
    }

    // 6. Last-resort baseline — never leave UI at 0 with permissions issue
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
   * iOS does not let us directly query READ-permission status (Apple
   * privacy). We infer denial by comparing HK to the pedometer over a
   * trailing window. If pedometer reports >0 steps in the last week
   * but HK reports 0, HealthKit Read access is almost certainly denied
   * for our scopes.
   */
  private _detectHealthKitDenial(opts: {
    hkInitialized: boolean;
    hkStepsToday: number | null;
    hkCalsToday: number | null;
    hkWeekSteps: number | null;
    pedometerWeekSteps: number | null;
    pedoStepsToday: number | null;
  }): boolean {
    if (Platform.OS !== 'ios') return false;
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
    if (source === 'pedometer') return 'Using motion tracking';
    if (source === 'backend') return 'Estimated from synced activity';
    if (source === 'estimated') return 'Estimated from your profile';
    return 'No activity data yet';
  }
}

/** Singleton */
export const FitnessDataResolver = new _FitnessDataResolver();
