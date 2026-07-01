/**
 * Video_Compression_Service (Stage 31, Req 32) — on-device compression that
 * runs before any upload begins.
 *
 * PURE-LOGIC MODULE: this file contains NO top-level `react-native` / `expo-*`
 * imports. The actual on-device encoding is abstracted behind the injected
 * {@link VideoEncoder} interface, so every decision (resolution ceiling,
 * no-upscaling, size/quality bounds, ratio math, failure -> original fallback,
 * metadata) is fully unit/property testable with a fake encoder in plain Node.
 *
 * A thin real adapter that wires `expo-av` / `expo-file-system` lives in
 * `videoCompression.native.ts` and is never imported by tests.
 *
 * Design: .kiro/specs/ai-exercise-analysis/design.md (Video_Compression_Service,
 * Properties 27, 28, 29).
 * Requirements: 32.1–32.9.
 */

import {
  CompressionConfig,
  resolveCompressionConfig,
  targetSizeBytes,
} from "../config/compressionConfig";
import {
  StructuredError,
  isStructuredError,
  makeStructuredError,
} from "../types/structuredError";

/** Name reported as the originating stage on any StructuredError. */
export const VIDEO_COMPRESSION_STAGE = "video_compression";

/** Error code returned when compression fails or times out (Req 32.6). */
export const COMPRESSION_FAILED = "COMPRESSION_FAILED";

/**
 * A video that physically exists on the device (original recording or a
 * compressed temporary artifact).
 */
export interface LocalVideo {
  /** Location of the video bytes on device (file uri or opaque handle). */
  uri: string;
  /** Size of the video in bytes. */
  sizeBytes: number;
  /** Vertical resolution in pixels (e.g. 720, 1080). */
  heightPx: number;
  /** Frame rate in frames per second. */
  fps: number;
  /** Video codec identifier (e.g. "h264"). */
  codec: string;
  /**
   * Whether this artifact is retained in persistent storage. Compressed
   * outputs are transient (`false`); they must never persist after upload
   * (Req 32.8).
   */
  persistent: boolean;
}

/**
 * Structured record of a compression operation (Req 32.7).
 * `compressionRatio === compressedSize / originalSize`.
 */
export interface CompressionMetadata {
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  /** Wall-clock compression time in milliseconds. */
  compressionTime: number;
}

/** Request handed to the injected encoder describing the desired output. */
export interface EncodeRequest {
  source: LocalVideo;
  /** Target vertical resolution (already ceiling-limited, never upscaling). */
  targetResolutionPx: number;
  targetFps: number;
  codec: string;
  targetBitrateKbps: number;
  targetSizeBytes: number;
  targetQuality: number;
}

/** Result produced by the injected encoder on success. */
export interface EncodedResult {
  /** The compressed video artifact (transient). */
  video: LocalVideo;
  /** Measured quality metric in [0, 1] for the produced output (Req 32.4). */
  qualityMetric: number;
}

/**
 * Abstraction over the platform video transcoder. Implementations may reject
 * (compression failure) or resolve with an {@link EncodedResult}. The pure
 * decision logic enforces the resolution ceiling, size/quality bounds and
 * timeout independently of the concrete encoder.
 */
export interface VideoEncoder {
  encode(request: EncodeRequest): Promise<EncodedResult>;
}

/**
 * Transient storage for compressed artifacts. Injected so the "never persist
 * after upload" guarantee (Req 32.8) is testable without touching the device
 * file system.
 */
export interface TempStore {
  /** Securely delete a transient artifact by uri. */
  delete(uri: string): Promise<void>;
}

/** Injected dependencies for {@link compress}. */
export interface CompressionDeps {
  encoder: VideoEncoder;
  /** Optional configuration overrides; defaults mirror config_v2.py. */
  config?: Partial<CompressionConfig>;
  /** Monotonic clock in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Timeout scheduler. Resolves after `ms` milliseconds and is raced against
   * the encoder. Injectable for deterministic tests. Defaults to `setTimeout`.
   */
  delay?: (ms: number) => Promise<void>;
  /** Optional transient store used by {@link discardCompressed}. */
  tempStore?: TempStore;
}

/**
 * Successful compression outcome: the compressed output plus its metadata.
 * Matches the design signature `{ output; meta }`.
 */
export interface CompressionSuccess {
  output: LocalVideo;
  meta: CompressionMetadata;
}

/**
 * The result of {@link compress}: either a {@link CompressionSuccess} or a
 * {@link StructuredError} with code `COMPRESSION_FAILED` (Req 32.6).
 */
export type CompressResult = CompressionSuccess | StructuredError;

/**
 * Determine the target output resolution enforcing the ceiling WITHOUT ever
 * upscaling (Req 32.2, Property 27):
 *  - source at or below the configured target -> keep the source resolution
 *  - source above the configured target       -> clamp to the target
 *
 * @returns the output vertical resolution in pixels.
 */
export function resolveTargetResolution(
  sourceHeightPx: number,
  config: CompressionConfig
): number {
  return Math.min(sourceHeightPx, config.targetResolutionPx);
}

/**
 * Compute {@link CompressionMetadata} with `compressionRatio` defined as
 * `compressedSize / originalSize` (Req 32.7). An original size of 0 yields a
 * ratio of 0 to avoid division by zero.
 */
export function computeCompressionMetadata(
  originalSize: number,
  compressedSize: number,
  compressionTime: number
): CompressionMetadata {
  const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 0;
  return { originalSize, compressedSize, compressionRatio, compressionTime };
}

/** Narrow a {@link CompressResult} to the failure branch. */
export function isCompressionError(result: CompressResult): result is StructuredError {
  return isStructuredError(result);
}

/**
 * Select the payload the Chunk_Upload_Service should upload:
 *  - success -> the compressed output (original excluded, Req 32.5)
 *  - failure -> the unchanged original as the fallback (Req 32.6)
 */
export function resolveUploadSource(
  original: LocalVideo,
  result: CompressResult
): LocalVideo {
  return isCompressionError(result) ? original : result.output;
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
const TIMEOUT = Symbol("compression-timeout");

/**
 * Compress `video` on device before upload (Req 32.1).
 *
 * Behaviour:
 *  - enforces the resolution ceiling without upscaling (Req 32.2)
 *  - reads bitrate/quality/target size from configuration (Req 32.3)
 *  - a result is only a success when the compressed size does not exceed the
 *    configured target size (Req 32.9) AND the measured quality is at or above
 *    the configured target quality (Req 32.4)
 *  - on success, produces {@link CompressionMetadata} with ratio =
 *    compressed/original (Req 32.7)
 *  - on failure, encoder rejection, or exceeding the configured maximum
 *    compression time, returns a `COMPRESSION_FAILED` StructuredError and
 *    leaves the original bytes unchanged (Req 32.6)
 *
 * This function never persists the original and never throws on domain
 * failure. The returned success output is transient; callers must call
 * {@link discardCompressed} after upload (Req 32.8).
 */
export async function compress(
  video: LocalVideo,
  deps: CompressionDeps
): Promise<CompressResult> {
  const config = resolveCompressionConfig(deps.config);
  const now = deps.now ?? Date.now;
  const delay = deps.delay ?? defaultDelay;

  const start = now();
  const outputResolution = resolveTargetResolution(video.heightPx, config);
  const maxBytes = targetSizeBytes(config);

  const request: EncodeRequest = {
    source: video,
    targetResolutionPx: outputResolution,
    targetFps: config.targetFps,
    codec: config.codec,
    targetBitrateKbps: config.targetBitrateKbps,
    targetSizeBytes: maxBytes,
    targetQuality: config.targetQuality,
  };

  let encoded: EncodedResult | typeof TIMEOUT;
  try {
    encoded = await Promise.race<EncodedResult | typeof TIMEOUT>([
      deps.encoder.encode(request),
      delay(config.maxCompressionTimeMs).then(() => TIMEOUT),
    ]);
  } catch (error) {
    // Encoder rejected: compression failed, original retained unchanged.
    return failure(
      `compression failed: ${describeError(error)}`
    );
  }

  if (encoded === TIMEOUT) {
    return failure(
      `compression exceeded the maximum time of ${config.maxCompressionTimeMs}ms`
    );
  }

  const elapsed = Math.max(0, now() - start);

  // A success must be within the target size and at/above target quality.
  if (encoded.video.sizeBytes > maxBytes) {
    return failure(
      `compressed size ${encoded.video.sizeBytes} exceeds target ${maxBytes} bytes`
    );
  }
  if (encoded.qualityMetric < config.targetQuality) {
    return failure(
      `quality ${encoded.qualityMetric} below target ${config.targetQuality}`
    );
  }

  const output: LocalVideo = { ...encoded.video, persistent: false };
  const meta = computeCompressionMetadata(
    video.sizeBytes,
    output.sizeBytes,
    elapsed
  );
  return { output, meta };
}

/**
 * Discard the compressed artifact after upload so no compressed video remains
 * in persistent storage (Req 32.8). Safe to call with a failure result (no-op)
 * and safe when no {@link TempStore} is configured.
 */
export async function discardCompressed(
  result: CompressResult,
  deps: Pick<CompressionDeps, "tempStore">
): Promise<void> {
  if (isCompressionError(result)) return;
  if (!deps.tempStore) return;
  await deps.tempStore.delete(result.output.uri);
}

/** Build the standard COMPRESSION_FAILED StructuredError. */
function failure(message: string): StructuredError {
  return makeStructuredError(COMPRESSION_FAILED, message, VIDEO_COMPRESSION_STAGE);
}

/** Best-effort, PII-free description of a thrown value. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
