/**
 * Recording_Assistant_Service (Stage 34, Req 35) — live, pre-recording guidance
 * produced by analyzing the camera preview before recording begins.
 *
 * PURE-LOGIC MODULE: this file contains NO top-level `react-native` / `expo-*`
 * imports. The actual per-frame preview inspection is abstracted behind the
 * injected {@link PreviewAnalyzer} interface, which converts an opaque
 * {@link PreviewFrame} into structured {@link PreviewSignals} (or a failure).
 * Every decision downstream of that — condition-detection thresholds, the
 * severity-ordered one-instruction-per-condition mapping (bijection), the
 * empty-when-ready result, and the non-blocking failure — is pure and fully
 * unit/property testable in plain Node with a fake analyzer.
 *
 * A thin real adapter that wires the actual camera preview (`expo-camera`)
 * lives in `recordingAssistant.native.ts` and is never imported by tests.
 *
 * Design: .kiro/specs/ai-exercise-analysis/design.md
 *   (Recording_Assistant_Service, Properties 39 & 40).
 * Requirements: 35.1–35.6.
 */

import {
  DEFAULT_RECORDING_ASSISTANT_CONFIG,
  PreviewOrientation,
  RecordingAssistantConfig,
  RecordingCondition,
  resolveRecordingAssistantConfig,
  severityRank,
} from "../config/recordingAssistantConfig";
import {
  StructuredError,
  isStructuredError,
  makeStructuredError,
} from "../types/structuredError";

/** Name reported as the originating stage on any StructuredError. */
export const RECORDING_ASSISTANT_STAGE = "recording_assistant";

/**
 * Error code returned when the preview frame is unavailable or analysis fails
 * (Req 35.6). This is NON-BLOCKING: the End_User may still begin recording.
 */
export const GUIDANCE_UNAVAILABLE = "GUIDANCE_UNAVAILABLE";

/**
 * Opaque handle to a single camera-preview frame. The pure logic never
 * inspects its contents; the injected {@link PreviewAnalyzer} turns it into
 * {@link PreviewSignals}. Kept intentionally minimal/structural so no native
 * type leaks into the pure module.
 */
export interface PreviewFrame {
  /** Monotonic capture timestamp in ms (for shake/motion estimation upstream). */
  timestampMs: number;
  /** Optional opaque payload the concrete analyzer understands. */
  data?: unknown;
}

/**
 * Structured measurements extracted from a single preview frame. These are the
 * inputs to the pure condition-detection logic; producing them (pose/scene
 * analysis) is the concrete analyzer's job. All fractions are in [0, 1].
 */
export interface PreviewSignals {
  /** Number of distinct people detected in the frame. */
  personCount: number;
  /** Camera pitch in degrees, 0 = level, positive = tilted up. */
  cameraPitchDeg: number;
  /** Fraction of the subject's body inside the frame bounds. */
  bodyVisibleFraction: number;
  /** Whether the subject's head is fully within the frame. */
  headVisible: boolean;
  /** Whether the subject's feet are fully within the frame. */
  feetVisible: boolean;
  /** Fraction of the frame area the subject occupies (distance proxy). */
  subjectFillFraction: number;
  /** Average scene brightness in [0, 1]. */
  brightness: number;
  /** Background-to-subject brightness ratio (>1 = brighter background). */
  backlightRatio: number;
  /** Inter-frame motion magnitude in [0, 1] (camera shake proxy). */
  motionMagnitude: number;
  /** Current preview orientation. */
  orientation: PreviewOrientation;
}

/**
 * A single corrective instruction. Exactly one is produced per detected
 * condition (the bijection of Property 39); `severity` is the condition's rank
 * in the configured severity order (0 = most severe).
 */
export interface CorrectiveInstruction {
  /** The detected condition this instruction addresses. */
  condition: RecordingCondition;
  /** The adjustment the End_User must make (names the required action). */
  adjustment: string;
  /** Severity rank from the configured order; lower = more blocking. */
  severity: number;
}

/**
 * Live guidance returned before recording. When `ready` is true the setup is
 * suitable and `instructions` is empty (Req 35.4); otherwise `instructions`
 * holds exactly one severity-ordered entry per detected condition (Req 35.3).
 */
export interface RecordingGuidance {
  ready: boolean;
  instructions: CorrectiveInstruction[];
}

/**
 * Abstraction over the platform preview inspection. Implementations turn a
 * {@link PreviewFrame} into {@link PreviewSignals}, or return a
 * {@link StructuredError} (unavailable / failed). Never throws on domain
 * failure — it returns the error branch so the pure logic can keep guidance
 * non-blocking.
 */
export interface PreviewAnalyzer {
  analyze(frame: PreviewFrame): PreviewSignals | StructuredError;
}

/** Injected dependencies for {@link analyzePreview}. */
export interface RecordingAssistantDeps {
  /** Converts a raw preview frame into structured signals (or a failure). */
  analyzer: PreviewAnalyzer;
  /** Optional configuration overrides; defaults mirror config_v2.py. */
  config?: Partial<RecordingAssistantConfig>;
}

/** The result of {@link analyzePreview}: guidance or a non-blocking error. */
export type AnalyzePreviewResult = RecordingGuidance | StructuredError;

/**
 * Human-readable adjustment copy for each condition. Every `RecordingCondition`
 * has exactly one entry so the condition→instruction mapping is total and
 * one-to-one (supports the Property 39 bijection). Each names both the detected
 * condition and the action the End_User must take (Req 35.3).
 */
const ADJUSTMENT_BY_CONDITION: Record<RecordingCondition, string> = {
  [RecordingCondition.MultiplePeople]:
    "Multiple people detected — make sure only the person exercising is in frame.",
  [RecordingCondition.BodyCropped]:
    "Body is cropped — step back or reframe so your whole body is visible.",
  [RecordingCondition.HeadMissing]:
    "Head is out of frame — tilt the camera up or step back so your head is visible.",
  [RecordingCondition.FeetMissing]:
    "Feet are out of frame — tilt the camera down or step back so your feet are visible.",
  [RecordingCondition.DistanceTooFar]:
    "You are too far away — move closer to the camera.",
  [RecordingCondition.DistanceTooClose]:
    "You are too close — move back from the camera.",
  [RecordingCondition.CameraTooLow]:
    "Camera is too low — raise it to about waist or chest height.",
  [RecordingCondition.CameraTooHigh]:
    "Camera is too high — lower it to about waist or chest height.",
  [RecordingCondition.WrongOrientation]:
    "Wrong orientation — rotate the device to the expected orientation.",
  [RecordingCondition.PoorLighting]:
    "Lighting is too dark — add more light to the room.",
  [RecordingCondition.Backlight]:
    "Strong backlight detected — face the light source or reduce the light behind you.",
  [RecordingCondition.CameraShaking]:
    "Camera is shaking — steady the device or prop it on a stable surface.",
};

/**
 * Detect the set of adverse recording conditions present in `signals`
 * according to the configured thresholds (Req 35.2, 35.5). Pure and
 * deterministic. Returns a de-duplicated list (each condition at most once).
 */
export function detectConditions(
  signals: PreviewSignals,
  config: RecordingAssistantConfig = DEFAULT_RECORDING_ASSISTANT_CONFIG
): RecordingCondition[] {
  const detected: RecordingCondition[] = [];

  if (signals.personCount > config.maxPeople) {
    detected.push(RecordingCondition.MultiplePeople);
  }
  if (signals.bodyVisibleFraction < config.minBodyVisibleFraction) {
    detected.push(RecordingCondition.BodyCropped);
  }
  if (!signals.headVisible) {
    detected.push(RecordingCondition.HeadMissing);
  }
  if (!signals.feetVisible) {
    detected.push(RecordingCondition.FeetMissing);
  }
  if (signals.subjectFillFraction < config.minSubjectFillFraction) {
    detected.push(RecordingCondition.DistanceTooFar);
  }
  if (signals.subjectFillFraction > config.maxSubjectFillFraction) {
    detected.push(RecordingCondition.DistanceTooClose);
  }
  if (signals.cameraPitchDeg > config.cameraTooLowPitchDeg) {
    detected.push(RecordingCondition.CameraTooLow);
  }
  if (signals.cameraPitchDeg < config.cameraTooHighPitchDeg) {
    detected.push(RecordingCondition.CameraTooHigh);
  }
  if (signals.orientation !== config.expectedOrientation) {
    detected.push(RecordingCondition.WrongOrientation);
  }
  if (signals.brightness < config.minBrightness) {
    detected.push(RecordingCondition.PoorLighting);
  }
  if (signals.backlightRatio >= config.maxBacklightRatio) {
    detected.push(RecordingCondition.Backlight);
  }
  if (signals.motionMagnitude >= config.maxMotionMagnitude) {
    detected.push(RecordingCondition.CameraShaking);
  }

  return detected;
}

/**
 * Build {@link RecordingGuidance} from a set of detected conditions: exactly
 * one instruction per condition (bijection), ordered by the configured
 * severity ranking, most-blocking first (Req 35.3). When no conditions are
 * present the guidance is marked `ready` with an empty list (Req 35.4).
 *
 * Duplicate conditions are collapsed so the mapping stays one-to-one.
 */
export function buildGuidance(
  conditions: readonly RecordingCondition[],
  config: RecordingAssistantConfig = DEFAULT_RECORDING_ASSISTANT_CONFIG
): RecordingGuidance {
  const unique = Array.from(new Set(conditions));

  const instructions: CorrectiveInstruction[] = unique
    .map((condition) => ({
      condition,
      adjustment: ADJUSTMENT_BY_CONDITION[condition],
      severity: severityRank(condition, config.severityOrder),
    }))
    // Stable severity ordering; ties broken by condition name for determinism.
    .sort((a, b) =>
      a.severity !== b.severity
        ? a.severity - b.severity
        : a.condition.localeCompare(b.condition)
    );

  return { ready: instructions.length === 0, instructions };
}

/** Narrow an {@link AnalyzePreviewResult} to the failure branch. */
export function isGuidanceUnavailable(
  result: AnalyzePreviewResult
): result is StructuredError {
  return isStructuredError(result);
}

/**
 * Analyze one camera-preview frame and return live {@link RecordingGuidance}
 * (Req 35.1–35.4). The injected {@link PreviewAnalyzer} extracts the
 * {@link PreviewSignals}; the pure logic detects conditions and maps them to a
 * severity-ordered set of corrective instructions.
 *
 * If the preview frame is unavailable or analysis fails, returns a
 * `GUIDANCE_UNAVAILABLE` {@link StructuredError} (Req 35.6). This is
 * NON-BLOCKING — it merely signals guidance is unavailable; the caller must
 * still allow the End_User to begin recording.
 *
 * Never throws on domain failure: a throwing analyzer is caught and mapped to
 * the same non-blocking error.
 */
export function analyzePreview(
  frame: PreviewFrame,
  deps: RecordingAssistantDeps
): AnalyzePreviewResult {
  const config = resolveRecordingAssistantConfig(deps.config);

  let signals: PreviewSignals | StructuredError;
  try {
    signals = deps.analyzer.analyze(frame);
  } catch (error) {
    return guidanceUnavailable(
      `preview analysis failed: ${describeError(error)}`
    );
  }

  if (isStructuredError(signals)) {
    // Re-badge any analyzer error as a non-blocking guidance-unavailable error
    // so the code/stage contract is uniform regardless of the analyzer.
    return guidanceUnavailable(signals.message);
  }

  const conditions = detectConditions(signals, config);
  return buildGuidance(conditions, config);
}

/** Build the standard non-blocking GUIDANCE_UNAVAILABLE StructuredError. */
function guidanceUnavailable(message: string): StructuredError {
  return makeStructuredError(GUIDANCE_UNAVAILABLE, message, RECORDING_ASSISTANT_STAGE);
}

/** Best-effort, PII-free description of a thrown value. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
