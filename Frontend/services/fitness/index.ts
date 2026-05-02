/**
 * Fitness Service — Barrel Export
 * ──────────────────────────────────────────────────────────────
 * Single entry point for the fitness tracking system.
 * ──────────────────────────────────────────────────────────────
 */

export { HealthKitService } from './HealthKitService';
export { StepManager } from './StepManager';
export { CalorieManager } from './CalorieManager';
export { FitnessStore } from './FitnessStore';
export { FitnessService } from './FitnessService';

export type {
  HealthKitStepResult,
  HealthKitCalorieResult,
} from './HealthKitService';

export type {
  FitnessState,
  FitnessSource,
  FitnessListener,
} from './FitnessStore';

export type { StepResult } from './StepManager';
export type { CalorieResult } from './CalorieManager';
