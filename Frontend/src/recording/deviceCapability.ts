/**
 * Device_Capability_Service (Stage 47, Req 48) — on-device detection of the
 * device's performance tier that runs when a recording session starts, before
 * recording begins. The produced `DeviceCapabilityProfile` fixes the four
 * recording settings (compression target, resolution, frame sampling rate,
 * upload quality) for the session.
 *
 * PURE-LOGIC MODULE: this file contains NO top-level `react-native` / `expo-*`
 * imports. The actual device probing is abstracted behind the injected
 * {@link DeviceProbe} interface, and the "detect within 2s / timeout -> low-end
 * safe default" path uses an injected clock + timeout scheduler, so every
 * decision is fully unit/property testable in plain Node.
 *
 * A thin real adapter that wires `expo-device` / `expo-constants` lives in
 * `deviceCapability.native.ts` and is never imported by tests.
 *
 * Design: .kiro/specs/ai-exercise-analysis/design.md
 *   (Device_Capability_Service, Property 57).
 * Requirements: 48.1–48.5.
 */

import {
  DeviceCapabilityConfig,
  DeviceTier,
  RecordingSettings,
  resolveDeviceCapabilityConfig,
} from "../config/deviceCapabilityConfig";
import { StructuredError, makeStructuredError } from "../types/structuredError";

export type { DeviceTier, RecordingSettings } from "../config/deviceCapabilityConfig";
export { DEVICE_TIERS } from "../config/deviceCapabilityConfig";

/** Name reported as the originating stage on any StructuredError. */
export const DEVICE_CAPABILITY_STAGE = "device_capability";

/** Error code recorded when detection could not complete (Req 48.5). */
export const DEVICE_DETECTION_INCOMPLETE = "DEVICE_DETECTION_INCOMPLETE";

/**
 * Raw performance measurement produced by a {@link DeviceProbe}. A single
 * dimensionless `benchmarkScore` (higher = more capable) drives tier
 * classification; abstracting the metric keeps the pure logic independent of
 * any concrete probing implementation.
 */
export interface DeviceMetrics {
  /** Dimensionless capability score; higher means a faster device. */
  benchmarkScore: number;
}

/**
 * Abstraction over the platform capability probe (CPU/GPU/memory benchmark,
 * device model lookup, etc.). Implementations may resolve with
 * {@link DeviceMetrics} or reject/hang; the pure logic races the measurement
 * against the detection timeout and falls back to a safe default on
 * timeout/failure (Req 48.5). `measure` may be synchronous or asynchronous.
 */
export interface DeviceProbe {
  measure(): DeviceMetrics | Promise<DeviceMetrics>;
}

/**
 * The structured assessment of a device's performance tier (Req 48). The
 * `tier` fully determines the four settings (Req 48.2). `detectionCompleted`
 * is `false` on the safe-default path, in which case `detectionError` carries
 * the detection-incomplete indication (Req 48.5).
 */
export interface DeviceCapabilityProfile {
  /** Exactly one of low-end / mid-range / high-end. */
  tier: DeviceTier;
  /** Target vertical resolution in pixels. */
  resolution: number;
  /** Frame sampling rate in frames per second. */
  frameSamplingRate: number;
  /** Upload quality on an integer 0..100 scale. */
  uploadQuality: number;
  /** Target compressed output size in megabytes. */
  compressionTarget: number;
  /** `false` when a low-end safe default was produced (timeout/failure). */
  detectionCompleted: boolean;
  /** Present iff `detectionCompleted` is `false` (Req 48.5). */
  detectionError?: StructuredError;
}

/** Injected dependencies for {@link detectCapability}. */
export interface DetectCapabilityDeps {
  /** The platform probe used to measure device performance. */
  probe: DeviceProbe;
  /** Optional configuration overrides; defaults mirror config_v2.py. */
  config?: Partial<DeviceCapabilityConfig>;
  /** Monotonic clock in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Timeout scheduler. Resolves after `ms` milliseconds and is raced against
   * the probe. Injectable for deterministic tests. Defaults to `setTimeout`.
   */
  delay?: (ms: number) => Promise<void>;
}

/**
 * Classify raw {@link DeviceMetrics} into exactly one {@link DeviceTier}
 * (Req 48.1). Deterministic: identical metrics always map to the same tier.
 */
export function classifyTier(
  metrics: DeviceMetrics,
  config: DeviceCapabilityConfig
): DeviceTier {
  const score = metrics.benchmarkScore;
  if (Number.isFinite(score) && score >= config.highEndMinScore) return "high-end";
  if (Number.isFinite(score) && score >= config.midRangeMinScore) return "mid-range";
  return "low-end";
}

/**
 * Total function tier -> {@link RecordingSettings} (Req 48.2). Deterministic:
 * the same tier always yields identical values. Returns a fresh object so the
 * frozen defaults are never exposed for mutation.
 */
export function settingsForTier(
  tier: DeviceTier,
  config: DeviceCapabilityConfig = resolveDeviceCapabilityConfig()
): RecordingSettings {
  const s = config.settings[tier];
  return {
    compressionTarget: s.compressionTarget,
    resolution: s.resolution,
    frameSamplingRate: s.frameSamplingRate,
    uploadQuality: s.uploadQuality,
  };
}

/**
 * Build a completed {@link DeviceCapabilityProfile} for a classified tier.
 * The tier fully determines the four settings (Req 48.2).
 */
export function profileForTier(
  tier: DeviceTier,
  config: DeviceCapabilityConfig = resolveDeviceCapabilityConfig()
): DeviceCapabilityProfile {
  const settings = settingsForTier(tier, config);
  return {
    tier,
    resolution: settings.resolution,
    frameSamplingRate: settings.frameSamplingRate,
    uploadQuality: settings.uploadQuality,
    compressionTarget: settings.compressionTarget,
    detectionCompleted: true,
  };
}

/**
 * Produce the low-end safe-default profile used when detection cannot complete
 * within the time budget or fails (Req 48.5). `detectionCompleted` is `false`
 * and a `DEVICE_DETECTION_INCOMPLETE` StructuredError records the reason.
 */
export function safeDefaultProfile(
  reason: string,
  config: DeviceCapabilityConfig = resolveDeviceCapabilityConfig()
): DeviceCapabilityProfile {
  const settings = settingsForTier("low-end", config);
  return {
    tier: "low-end",
    resolution: settings.resolution,
    frameSamplingRate: settings.frameSamplingRate,
    uploadQuality: settings.uploadQuality,
    compressionTarget: settings.compressionTarget,
    detectionCompleted: false,
    detectionError: makeStructuredError(
      DEVICE_DETECTION_INCOMPLETE,
      reason,
      DEVICE_CAPABILITY_STAGE
    ),
  };
}

/** Default timeout scheduler backed by the ambient `setTimeout`. */
function defaultDelay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    (globalThis as { setTimeout: (cb: () => void, ms: number) => unknown }).setTimeout(
      resolve,
      ms
    );
  });
}

/** Sentinel used internally to detect the timeout branch of the race. */
const TIMEOUT = Symbol("device-detection-timeout");

/**
 * Detect the device performance tier and produce a
 * {@link DeviceCapabilityProfile} (Req 48.1).
 *
 * Behaviour:
 *  - measures the device via the injected {@link DeviceProbe}, racing the
 *    measurement against the configured detection budget (2s by default)
 *  - on success within the budget, classifies the device into exactly one tier
 *    and applies the tier's four settings (Req 48.1–48.4)
 *  - on timeout or probe failure, returns the low-end safe-default profile with
 *    `detectionCompleted === false` and a detection-incomplete indication
 *    (Req 48.5)
 *
 * Never throws on domain failure.
 */
export async function detectCapability(
  deps: DetectCapabilityDeps
): Promise<DeviceCapabilityProfile> {
  const config = resolveDeviceCapabilityConfig(deps.config);
  const delay = deps.delay ?? defaultDelay;

  let metrics: DeviceMetrics | typeof TIMEOUT;
  try {
    metrics = await Promise.race<DeviceMetrics | typeof TIMEOUT>([
      Promise.resolve(deps.probe.measure()),
      delay(config.detectionTimeoutMs).then(() => TIMEOUT),
    ]);
  } catch (error) {
    // Probe rejected: detection failed -> low-end safe default (Req 48.5).
    return safeDefaultProfile(
      `device detection failed: ${describeError(error)}`,
      config
    );
  }

  if (metrics === TIMEOUT) {
    return safeDefaultProfile(
      `device detection did not complete within ${config.detectionTimeoutMs}ms`,
      config
    );
  }

  const tier = classifyTier(metrics, config);
  return profileForTier(tier, config);
}

/** Best-effort, PII-free description of a thrown value. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
