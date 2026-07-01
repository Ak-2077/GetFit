/**
 * Device-capability configuration for the frontend Device_Capability_Service
 * (Stage 47, Req 48).
 *
 * This module is pure TypeScript with NO Python and NO native
 * (`react-native` / `expo-*`) imports, so it is fully testable in Node.
 *
 * The per-tier recording settings mirror the AI service reference defaults in
 * `ai-service/app/analysis_v2/config_v2.py` for the mid-range tier (the
 * documented baseline), with the low-end / high-end tiers stepping down / up
 * around that baseline:
 *   COMPRESSION_TARGET_RESOLUTION = 720   -> mid-range resolution
 *   COMPRESSION_TARGET_FPS        = 30    -> mid-range frame sampling rate
 *   COMPRESSION_TARGET_QUALITY    = 0.85  -> mid-range upload quality (~85/100)
 *   COMPRESSION_TARGET_SIZE_MB    = 10    -> mid-range compression target (band [5, 15])
 *
 * Requirements: 48.1 (detect within 2s), 48.2 (same tier => identical settings),
 * 48.3 / 48.4 (monotonic non-decreasing low -> mid -> high), 48.5 (safe default).
 */

/**
 * Device performance tier. EXACTLY three values, ordered ascending in
 * capability: low-end < mid-range < high-end.
 */
export type DeviceTier = "low-end" | "mid-range" | "high-end";

/**
 * All device tiers in ascending capability order. Used to enumerate the tier
 * space and to check monotonicity of the settings table.
 */
export const DEVICE_TIERS = ["low-end", "mid-range", "high-end"] as const;

/**
 * The four recording settings a tier fully determines (Req 48.2). All values
 * are integers; `resolution`, `frameSamplingRate` and `uploadQuality` are
 * non-decreasing from low-end -> mid-range -> high-end (Req 48.3, 48.4), and
 * `compressionTarget` follows the same non-decreasing ordering.
 */
export interface RecordingSettings {
  /** Target compressed output size in megabytes (kept within [5, 15]). */
  compressionTarget: number;
  /** Target vertical resolution in pixels (e.g. 480, 720, 1080). */
  resolution: number;
  /** Frame sampling rate in frames per second. */
  frameSamplingRate: number;
  /** Upload quality on an integer 0..100 scale. */
  uploadQuality: number;
}

/**
 * The total tier -> settings table. This is the single source of truth for the
 * deterministic tier -> settings mapping (Req 48.2). Frozen so a resolved
 * profile can never mutate the shared defaults.
 *
 * Monotonic non-decreasing low-end -> mid-range -> high-end for every field.
 */
export const DEFAULT_TIER_SETTINGS: Readonly<Record<DeviceTier, RecordingSettings>> =
  Object.freeze({
    "low-end": Object.freeze({
      compressionTarget: 5,
      resolution: 480,
      frameSamplingRate: 15,
      uploadQuality: 70,
    }),
    "mid-range": Object.freeze({
      compressionTarget: 10,
      resolution: 720,
      frameSamplingRate: 30,
      uploadQuality: 85,
    }),
    "high-end": Object.freeze({
      compressionTarget: 15,
      resolution: 1080,
      frameSamplingRate: 60,
      uploadQuality: 100,
    }),
  }) as Readonly<Record<DeviceTier, RecordingSettings>>;

/** Detection time budget in milliseconds (Req 48.1: within 2 seconds). */
export const DEVICE_DETECTION_TIMEOUT_MS = 2000;

/**
 * Minimum benchmark score (dimensionless, higher = more capable) required to
 * classify a device into the mid-range tier. Below this the device is low-end.
 */
export const MID_RANGE_MIN_SCORE = 40;

/**
 * Minimum benchmark score required to classify a device into the high-end
 * tier. At or above this the device is high-end.
 */
export const HIGH_END_MIN_SCORE = 75;

/** Full device-capability configuration. */
export interface DeviceCapabilityConfig {
  /** Detection time budget in milliseconds (Req 48.1). */
  detectionTimeoutMs: number;
  /** Score threshold at/above which a device is mid-range (below => low-end). */
  midRangeMinScore: number;
  /** Score threshold at/above which a device is high-end. */
  highEndMinScore: number;
  /** Total tier -> settings table (Req 48.2). */
  settings: Readonly<Record<DeviceTier, RecordingSettings>>;
}

/** Default device-capability configuration. */
export const DEFAULT_DEVICE_CAPABILITY_CONFIG: DeviceCapabilityConfig = {
  detectionTimeoutMs: DEVICE_DETECTION_TIMEOUT_MS,
  midRangeMinScore: MID_RANGE_MIN_SCORE,
  highEndMinScore: HIGH_END_MIN_SCORE,
  settings: DEFAULT_TIER_SETTINGS,
};

/**
 * Resolve a full, validated `DeviceCapabilityConfig` from partial overrides.
 * Non-positive timeouts fall back to the default budget; thresholds that are
 * not finite fall back to the defaults. The tier -> settings table is used
 * as-is when overridden, otherwise the frozen defaults are used.
 */
export function resolveDeviceCapabilityConfig(
  overrides: Partial<DeviceCapabilityConfig> = {}
): DeviceCapabilityConfig {
  const detectionTimeoutMs =
    typeof overrides.detectionTimeoutMs === "number" && overrides.detectionTimeoutMs > 0
      ? overrides.detectionTimeoutMs
      : DEFAULT_DEVICE_CAPABILITY_CONFIG.detectionTimeoutMs;

  const midRangeMinScore = Number.isFinite(overrides.midRangeMinScore as number)
    ? (overrides.midRangeMinScore as number)
    : DEFAULT_DEVICE_CAPABILITY_CONFIG.midRangeMinScore;

  const highEndMinScore = Number.isFinite(overrides.highEndMinScore as number)
    ? (overrides.highEndMinScore as number)
    : DEFAULT_DEVICE_CAPABILITY_CONFIG.highEndMinScore;

  return {
    detectionTimeoutMs,
    midRangeMinScore,
    highEndMinScore,
    settings: overrides.settings ?? DEFAULT_DEVICE_CAPABILITY_CONFIG.settings,
  };
}
