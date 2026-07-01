/**
 * Video compression configuration for the frontend Video_Compression_Service.
 *
 * The default values mirror the AI service reference defaults documented in
 * `ai-service/app/analysis_v2/config_v2.py` (the Video Compression section,
 * Req 32.3). They are re-declared here in a frontend-appropriate, framework
 * independent form — this module is pure TypeScript with NO Python and NO
 * native (`react-native` / `expo-*`) imports, so it is fully testable in Node.
 *
 * Requirements: 32.3 (bitrate/quality/target size read from configuration,
 * target size within [5, 15] MB inclusive).
 */

/** One mebibyte in bytes. */
export const BYTES_PER_MB = 1024 * 1024;

/** Documented inclusive bounds for the configured target output size (Req 32.3). */
export const TARGET_SIZE_MIN_MB = 5;
export const TARGET_SIZE_MAX_MB = 15;

/**
 * Configuration for a single compression operation. All values are read from
 * configuration (Req 32.3); `Device_Capability_Service` (Req 48) may override
 * these per device tier before recording begins.
 */
export interface CompressionConfig {
  /** Target downscale resolution in vertical pixels (e.g. 1080 -> 720). */
  targetResolutionPx: number;
  /** Target frame rate in frames per second. */
  targetFps: number;
  /** Target video codec identifier. */
  codec: string;
  /** Target bitrate in kilobits per second. */
  targetBitrateKbps: number;
  /** Target quality metric in the unit interval [0, 1]. */
  targetQuality: number;
  /** Target compressed output size in megabytes; kept within [5, 15]. */
  targetSizeMb: number;
  /** Documented lower bound for the target size band, in megabytes. */
  targetSizeMinMb: number;
  /** Documented upper bound for the target size band, in megabytes. */
  targetSizeMaxMb: number;
  /** Maximum wall-clock time allotted to compression before falling back. */
  maxCompressionTimeMs: number;
}

/**
 * Default compression configuration.
 * Values mirror config_v2.py:
 *   COMPRESSION_TARGET_RESOLUTION = 720
 *   COMPRESSION_TARGET_FPS        = 30
 *   COMPRESSION_CODEC             = "h264"
 *   COMPRESSION_TARGET_BITRATE_KBPS = 2500
 *   COMPRESSION_TARGET_QUALITY    = 0.85
 *   COMPRESSION_TARGET_SIZE_MB    = 10.0  (band [5, 15])
 *   COMPRESSION_MAX_TIME_MS       = 30_000
 */
export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  targetResolutionPx: 720,
  targetFps: 30,
  codec: "h264",
  targetBitrateKbps: 2500,
  targetQuality: 0.85,
  targetSizeMb: 10,
  targetSizeMinMb: TARGET_SIZE_MIN_MB,
  targetSizeMaxMb: TARGET_SIZE_MAX_MB,
  maxCompressionTimeMs: 30_000,
};

/** Clamp a number into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Resolve a full, validated `CompressionConfig` from partial overrides.
 *
 * Out-of-range or invalid values are clamped/reset to safe defaults, mirroring
 * the `config_v2.py` field validators:
 *  - target size is clamped to the documented [5, 15] MB band (Req 32.3)
 *  - target quality is clamped to the unit interval [0, 1] (Req 32.4)
 *  - fps / resolution / bitrate / max-time fall back to defaults when <= 0
 */
export function resolveCompressionConfig(
  overrides: Partial<CompressionConfig> = {}
): CompressionConfig {
  const merged: CompressionConfig = { ...DEFAULT_COMPRESSION_CONFIG, ...overrides };

  const minMb = merged.targetSizeMinMb > 0 ? merged.targetSizeMinMb : TARGET_SIZE_MIN_MB;
  const maxMb = merged.targetSizeMaxMb > 0 ? merged.targetSizeMaxMb : TARGET_SIZE_MAX_MB;

  return {
    targetResolutionPx:
      merged.targetResolutionPx > 0
        ? merged.targetResolutionPx
        : DEFAULT_COMPRESSION_CONFIG.targetResolutionPx,
    targetFps: merged.targetFps > 0 ? merged.targetFps : DEFAULT_COMPRESSION_CONFIG.targetFps,
    codec: merged.codec || DEFAULT_COMPRESSION_CONFIG.codec,
    targetBitrateKbps:
      merged.targetBitrateKbps > 0
        ? merged.targetBitrateKbps
        : DEFAULT_COMPRESSION_CONFIG.targetBitrateKbps,
    targetQuality: clamp(merged.targetQuality, 0, 1),
    targetSizeMb: clamp(merged.targetSizeMb, minMb, maxMb),
    targetSizeMinMb: minMb,
    targetSizeMaxMb: maxMb,
    maxCompressionTimeMs:
      merged.maxCompressionTimeMs > 0
        ? merged.maxCompressionTimeMs
        : DEFAULT_COMPRESSION_CONFIG.maxCompressionTimeMs,
  };
}

/** Convert the configured target size (MB) into bytes. */
export function targetSizeBytes(config: CompressionConfig): number {
  return Math.round(config.targetSizeMb * BYTES_PER_MB);
}
