/**
 * Recording-assistant configuration for the frontend Recording_Assistant_Service.
 *
 * The refresh interval, maximum analysis latency, and severity ranking mirror
 * the AI service reference defaults documented in
 * `ai-service/app/analysis_v2/config_v2.py` (the Recording Assistant section,
 * Req 35 / 46):
 *   RECORDING_REFRESH_INTERVAL_MS      = 300
 *   RECORDING_MAX_ANALYSIS_LATENCY_MS  = 200
 *   RECORDING_SEVERITY_ORDER           = [multiple_people, body_cropped, ...]
 *
 * config_v2.py documents the ordering + timing knobs; the per-condition
 * DETECTION THRESHOLDS are frontend-local (the preview analysis runs on
 * device), declared here as configuration so every detection decision reads
 * its threshold from config (Req 35.5) rather than a hard-coded literal.
 *
 * This module is pure TypeScript with NO Python and NO native
 * (`react-native` / `expo-*`) imports, so it is fully testable in Node.
 *
 * Requirements: 35.1 (refresh interval + max latency), 35.3 (severity ranking),
 * 35.5 (every detection threshold / interval / latency read from configuration).
 */

/**
 * The set of adverse recording conditions the service can detect (Req 35.2).
 * Modeled as a string enum so conditions are a closed, exhaustive set and each
 * maps to exactly one corrective instruction (the bijection of Property 39).
 */
export enum RecordingCondition {
  MultiplePeople = "multiple_people",
  BodyCropped = "body_cropped",
  HeadMissing = "head_missing",
  FeetMissing = "feet_missing",
  DistanceTooFar = "distance_too_far",
  DistanceTooClose = "distance_too_close",
  CameraTooLow = "camera_too_low",
  CameraTooHigh = "camera_too_high",
  WrongOrientation = "wrong_orientation",
  PoorLighting = "poor_lighting",
  Backlight = "backlight",
  CameraShaking = "camera_shaking",
}

/**
 * Configured severity ranking used to order corrective instructions (Req 35.3),
 * most-blocking conditions first. Mirrors `RECORDING_SEVERITY_ORDER` in
 * config_v2.py exactly. The index of a condition in this array is its severity
 * rank (0 = most severe / highest priority).
 */
export const DEFAULT_RECORDING_SEVERITY_ORDER: readonly RecordingCondition[] = [
  RecordingCondition.MultiplePeople,
  RecordingCondition.BodyCropped,
  RecordingCondition.HeadMissing,
  RecordingCondition.FeetMissing,
  RecordingCondition.DistanceTooFar,
  RecordingCondition.DistanceTooClose,
  RecordingCondition.CameraTooLow,
  RecordingCondition.CameraTooHigh,
  RecordingCondition.WrongOrientation,
  RecordingCondition.PoorLighting,
  RecordingCondition.Backlight,
  RecordingCondition.CameraShaking,
];

/** Orientation the recording setup expects; landscape triggers wrong-orientation. */
export type PreviewOrientation = "portrait" | "landscape";

/**
 * Detection thresholds and timing for the Recording_Assistant_Service. Every
 * value is read from configuration (Req 35.5); a caller (or later a device
 * profile) may override any subset before the preview loop begins.
 */
export interface RecordingAssistantConfig {
  /** How often the live preview is analysed, in ms (Req 35.1). Mirrors config_v2.py. */
  refreshIntervalMs: number;
  /** Max latency to return updated guidance after a frame, in ms (Req 35.1). */
  maxAnalysisLatencyMs: number;
  /** Severity ranking (most-blocking first); index = severity rank (Req 35.3). */
  severityOrder: readonly RecordingCondition[];
  /** Orientation the setup expects; anything else is `wrong_orientation`. */
  expectedOrientation: PreviewOrientation;

  /** More than one detected person → `multiple_people`. */
  maxPeople: number;

  /**
   * Camera pitch band, in degrees (0 = level). Pitch above the max means the
   * camera sits too low (tilted up) → `camera_too_low`; below the min means it
   * sits too high (tilted down) → `camera_too_high`.
   */
  cameraTooLowPitchDeg: number;
  cameraTooHighPitchDeg: number;

  /** Fraction [0,1] of the body inside the frame; below → `body_cropped`. */
  minBodyVisibleFraction: number;

  /**
   * Fraction [0,1] of the frame the subject fills (a distance proxy):
   * above the max → subject too near → `distance_too_close`;
   * below the min → subject too far → `distance_too_far`.
   */
  maxSubjectFillFraction: number;
  minSubjectFillFraction: number;

  /** Average scene brightness [0,1]; below → `poor_lighting`. */
  minBrightness: number;
  /** Background-to-subject brightness ratio; at/above → `backlight`. */
  maxBacklightRatio: number;
  /** Inter-frame motion magnitude [0,1]; at/above → `camera_shaking`. */
  maxMotionMagnitude: number;
}

/**
 * Default recording-assistant configuration.
 * Timing + severity order mirror config_v2.py; detection thresholds are
 * frontend defaults (see module doc) chosen as conservative, actionable bands.
 */
export const DEFAULT_RECORDING_ASSISTANT_CONFIG: RecordingAssistantConfig = {
  refreshIntervalMs: 300,
  maxAnalysisLatencyMs: 200,
  severityOrder: DEFAULT_RECORDING_SEVERITY_ORDER,
  expectedOrientation: "portrait",
  maxPeople: 1,
  cameraTooLowPitchDeg: 15,
  cameraTooHighPitchDeg: -15,
  minBodyVisibleFraction: 0.9,
  maxSubjectFillFraction: 0.85,
  minSubjectFillFraction: 0.25,
  minBrightness: 0.25,
  maxBacklightRatio: 2.0,
  maxMotionMagnitude: 0.3,
};

/**
 * Resolve a full `RecordingAssistantConfig` from partial overrides, resetting
 * clearly-invalid values (non-finite / non-positive timings, empty severity
 * order) to the safe defaults. Threshold values are taken as-provided when
 * finite so callers can tune sensitivity freely.
 */
export function resolveRecordingAssistantConfig(
  overrides: Partial<RecordingAssistantConfig> = {}
): RecordingAssistantConfig {
  const merged: RecordingAssistantConfig = {
    ...DEFAULT_RECORDING_ASSISTANT_CONFIG,
    ...overrides,
  };

  const finite = (value: number, fallback: number): number =>
    Number.isFinite(value) ? value : fallback;
  const positive = (value: number, fallback: number): number =>
    Number.isFinite(value) && value > 0 ? value : fallback;

  return {
    refreshIntervalMs: positive(
      merged.refreshIntervalMs,
      DEFAULT_RECORDING_ASSISTANT_CONFIG.refreshIntervalMs
    ),
    maxAnalysisLatencyMs: positive(
      merged.maxAnalysisLatencyMs,
      DEFAULT_RECORDING_ASSISTANT_CONFIG.maxAnalysisLatencyMs
    ),
    severityOrder:
      merged.severityOrder && merged.severityOrder.length > 0
        ? merged.severityOrder
        : DEFAULT_RECORDING_SEVERITY_ORDER,
    expectedOrientation: merged.expectedOrientation,
    maxPeople: positive(merged.maxPeople, DEFAULT_RECORDING_ASSISTANT_CONFIG.maxPeople),
    cameraTooLowPitchDeg: finite(
      merged.cameraTooLowPitchDeg,
      DEFAULT_RECORDING_ASSISTANT_CONFIG.cameraTooLowPitchDeg
    ),
    cameraTooHighPitchDeg: finite(
      merged.cameraTooHighPitchDeg,
      DEFAULT_RECORDING_ASSISTANT_CONFIG.cameraTooHighPitchDeg
    ),
    minBodyVisibleFraction: finite(
      merged.minBodyVisibleFraction,
      DEFAULT_RECORDING_ASSISTANT_CONFIG.minBodyVisibleFraction
    ),
    maxSubjectFillFraction: finite(
      merged.maxSubjectFillFraction,
      DEFAULT_RECORDING_ASSISTANT_CONFIG.maxSubjectFillFraction
    ),
    minSubjectFillFraction: finite(
      merged.minSubjectFillFraction,
      DEFAULT_RECORDING_ASSISTANT_CONFIG.minSubjectFillFraction
    ),
    minBrightness: finite(
      merged.minBrightness,
      DEFAULT_RECORDING_ASSISTANT_CONFIG.minBrightness
    ),
    maxBacklightRatio: finite(
      merged.maxBacklightRatio,
      DEFAULT_RECORDING_ASSISTANT_CONFIG.maxBacklightRatio
    ),
    maxMotionMagnitude: finite(
      merged.maxMotionMagnitude,
      DEFAULT_RECORDING_ASSISTANT_CONFIG.maxMotionMagnitude
    ),
  };
}

/**
 * Severity rank of a condition per the configured order (0 = most severe).
 * Conditions absent from the order sort last (stable, after all ranked ones).
 */
export function severityRank(
  condition: RecordingCondition,
  order: readonly RecordingCondition[]
): number {
  const index = order.indexOf(condition);
  return index === -1 ? order.length : index;
}
