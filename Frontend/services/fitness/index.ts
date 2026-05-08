/**
 * Fitness Service — Barrel Export
 * ──────────────────────────────────────────────────────────────
 * Single entry point for the fitness tracking system.
 * ──────────────────────────────────────────────────────────────
 */

export { HealthKitService } from './HealthKitService';
export { AndroidPedometerService } from './AndroidPedometerService';
export { StepManager } from './StepManager';
export { CalorieManager } from './CalorieManager';
export { FitnessStore } from './FitnessStore';
export { FitnessService } from './FitnessService';

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

