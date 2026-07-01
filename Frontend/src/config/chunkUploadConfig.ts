/**
 * Chunked-upload configuration for the frontend Chunk_Upload_Service.
 *
 * The default values mirror the AI service reference defaults documented in
 * `ai-service/app/analysis_v2/config_v2.py` (the Chunked Upload section,
 * Req 33). They are re-declared here in a frontend-appropriate, framework
 * independent form — this module is pure TypeScript with NO Python and NO
 * native (`react-native` / `expo-*`) imports, so it is fully testable in Node.
 *
 * Requirements:
 *  - 33.1  chunk size configured within [1, 50] MB inclusive
 *  - 33.4  a failing chunk is retried up to 3 times
 *  - 33.6/33.7  interrupted uploads resume within a 24-hour window
 */

/** One mebibyte in bytes. */
export const BYTES_PER_MB = 1024 * 1024;

/** Milliseconds in one hour. */
export const MS_PER_HOUR = 60 * 60 * 1000;

/** Documented inclusive bounds for the configured chunk size (Req 33.1). */
export const CHUNK_SIZE_MIN_MB = 1;
export const CHUNK_SIZE_MAX_MB = 50;

/** Maximum number of retries for a single failing chunk (Req 33.4). */
export const CHUNK_MAX_RETRIES = 3;

/** Resumability window for an interrupted upload, in hours (Req 33.6, 33.7). */
export const UPLOAD_RESUME_WINDOW_HOURS = 24;

/**
 * Configuration for a chunked upload session. All values are read from
 * configuration; `Device_Capability_Service` (Req 48) may override the chunk
 * size per device tier / network condition before an upload begins.
 */
export interface ChunkUploadConfig {
  /** Target per-chunk size in megabytes; kept within [1, 50] (Req 33.1). */
  chunkSizeMb: number;
  /** Documented lower bound for the chunk-size band, in megabytes. */
  chunkSizeMinMb: number;
  /** Documented upper bound for the chunk-size band, in megabytes. */
  chunkSizeMaxMb: number;
  /** Maximum retries for a single failing chunk (Req 33.4). */
  maxRetries: number;
  /** Resumability window for an interrupted upload, in hours (Req 33.6/33.7). */
  resumeWindowHours: number;
}

/**
 * Default chunked-upload configuration.
 * Values mirror config_v2.py:
 *   CHUNK_SIZE_MB              = 5.0   (band [1, 50])
 *   CHUNK_SIZE_MIN_MB          = 1.0
 *   CHUNK_SIZE_MAX_MB          = 50.0
 *   CHUNK_MAX_RETRIES          = 3
 *   UPLOAD_RESUME_WINDOW_HOURS = 24
 */
export const DEFAULT_CHUNK_UPLOAD_CONFIG: ChunkUploadConfig = {
  chunkSizeMb: 5,
  chunkSizeMinMb: CHUNK_SIZE_MIN_MB,
  chunkSizeMaxMb: CHUNK_SIZE_MAX_MB,
  maxRetries: CHUNK_MAX_RETRIES,
  resumeWindowHours: UPLOAD_RESUME_WINDOW_HOURS,
};

/** Clamp a number into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Resolve a full, validated `ChunkUploadConfig` from partial overrides.
 *
 * Out-of-range or invalid values are clamped/reset to safe defaults, mirroring
 * the `config_v2.py` field validators:
 *  - chunk size is clamped to the documented [1, 50] MB band (Req 33.1)
 *  - retries / window fall back to defaults when < 0 (retries) or <= 0 (window)
 */
export function resolveChunkUploadConfig(
  overrides: Partial<ChunkUploadConfig> = {}
): ChunkUploadConfig {
  const merged: ChunkUploadConfig = { ...DEFAULT_CHUNK_UPLOAD_CONFIG, ...overrides };

  const minMb = merged.chunkSizeMinMb > 0 ? merged.chunkSizeMinMb : CHUNK_SIZE_MIN_MB;
  const maxMb = merged.chunkSizeMaxMb > 0 ? merged.chunkSizeMaxMb : CHUNK_SIZE_MAX_MB;

  return {
    chunkSizeMb: clamp(merged.chunkSizeMb, minMb, maxMb),
    chunkSizeMinMb: minMb,
    chunkSizeMaxMb: maxMb,
    maxRetries:
      Number.isFinite(merged.maxRetries) && merged.maxRetries >= 0
        ? Math.floor(merged.maxRetries)
        : DEFAULT_CHUNK_UPLOAD_CONFIG.maxRetries,
    resumeWindowHours:
      merged.resumeWindowHours > 0
        ? merged.resumeWindowHours
        : DEFAULT_CHUNK_UPLOAD_CONFIG.resumeWindowHours,
  };
}

/** Convert the configured chunk size (MB) into whole bytes. */
export function chunkSizeBytes(config: ChunkUploadConfig): number {
  return Math.max(1, Math.round(config.chunkSizeMb * BYTES_PER_MB));
}

/** Convert the configured resume window (hours) into milliseconds. */
export function resumeWindowMs(config: ChunkUploadConfig): number {
  return Math.round(config.resumeWindowHours * MS_PER_HOUR);
}
