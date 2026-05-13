/**
 * Fitness Service — Barrel Export
 * ──────────────────────────────────────────────────────────────
 * Single entry point for the fitness tracking system.
 * ──────────────────────────────────────────────────────────────
 */

export { HealthKitService } from './HealthKitService';
export { AndroidPedometerService } from './AndroidPedometerService';
export { PedometerService } from './PedometerService';
export { StepManager } from './StepManager';
export { CalorieManager } from './CalorieManager';
export { FitnessStore } from './FitnessStore';
export { FitnessService } from './FitnessService';
export { FitnessDataResolver } from './FitnessDataResolver';
export { CalorieReconciliationEngine } from './CalorieReconciliationEngine';
export type {
  MetricSnapshot,
  IncomingMetric,
  ReconciliationDecision,
} from './CalorieReconciliationEngine';
export {
  calculateBMR,
  estimateActiveCaloriesFromSteps,
  estimateBaselineActiveCaloriesElapsed,
  estimateCalories,
} from './CalorieEstimator';
export type {
  Gender,
  UserProfile,
  EstimationResult,
} from './CalorieEstimator';
export type { ResolvedFitnessData } from './FitnessDataResolver';
export type { PedometerStepReading } from './PedometerService';

export type {
  HealthKitStepResult,
  HealthKitCalorieResult,
} from './HealthKitService';

export type {
  PedometerStepResult,
} from './AndroidPedometerService';

export type {
  FitnessState,
  FitnessSource,
  FitnessListener,
} from './FitnessStore';

export type { StepResult } from './StepManager';
export type { CalorieResult } from './CalorieManager';

