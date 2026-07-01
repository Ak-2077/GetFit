/**
 * Property 28: Successful compression is bounded, sufficient, and
 * metadata-consistent.
 *
 * Validates: Requirements 32.1, 32.4, 32.5, 32.7, 32.8, 32.9
 *
 * For any video that compresses successfully (the injected encoder returns an
 * output whose size is within the configured target size AND whose measured
 * quality is at or above the configured target quality):
 *   - `compress` returns a success, NOT a `StructuredError` (32.1);
 *   - the compressed size does not exceed the configured target output size
 *     (32.9) and the quality metric is >= the configured target quality (32.4);
 *   - the produced `CompressionMetadata` is consistent (32.7):
 *       originalSize   === input video size,
 *       compressedSize === output video size,
 *       compressionRatio === compressedSize / originalSize (float tolerance),
 *       compressionTime  >= 0;
 *   - the success output is transient (`persistent === false`) and
 *     `discardCompressed` deletes exactly the output uri from the injected
 *     `TempStore`, so no compressed video remains in persistent storage after
 *     upload (32.8);
 *   - the uploaded payload is the compressed output, never the original —
 *     `resolveUploadSource(original, success)` returns the compressed output
 *     (32.5).
 *
 * A companion synchronous sub-property exercises the pure
 * `computeCompressionMetadata` ratio/definition directly.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/recording/videoCompression.bounds.property.test.ts \
 *   && node .tmp-pbt/recording/videoCompression.bounds.property.test.js
 *
 * The command compiles this test together with its imports (the harness +
 * videoCompression + config) into `.tmp-pbt/` and runs the emitted JS. It exits
 * 0 when all cases pass and non-zero (printing seed + counterexample) on the
 * first failure. Uses a seeded PRNG harness (no fast-check, no network). All
 * timing is driven through injected `now`/`delay` so no real timers fire.
 */

import {
  CompressionConfig,
  DEFAULT_COMPRESSION_CONFIG,
  resolveCompressionConfig,
  targetSizeBytes,
} from "../config/compressionConfig";
import {
  CompressResult,
  CompressionDeps,
  CompressionSuccess,
  EncodeRequest,
  EncodedResult,
  LocalVideo,
  TempStore,
  VideoEncoder,
  compress,
  computeCompressionMetadata,
  discardCompressed,
  isCompressionError,
  resolveUploadSource,
} from "./videoCompression";
import {
  Generator,
  choice,
  float,
  forAll,
  integer,
  makeRng,
  map,
  oneof,
  record,
} from "../testing/propertyHarness";

const ITERATIONS = 200;

/** Relative tolerance for the compressionRatio float comparison. */
const RATIO_TOLERANCE = 1e-9;

/**
 * Generate valid compression configs, varying the target size band (which
 * controls the maximum output bytes) and target quality (the sufficiency
 * threshold). Everything is normalised through `resolveCompressionConfig` so
 * the config is always valid.
 */
const configGen: Generator<CompressionConfig> = map(
  record({
    targetResolutionPx: oneof(choice([480, 720, 1080]), integer(240, 2160)),
    targetFps: choice([24, 30, 60]),
    targetBitrateKbps: integer(500, 8000),
    targetQuality: float(0, 1),
    targetSizeMb: float(5, 15),
    maxCompressionTimeMs: integer(1000, 60000),
  }),
  (raw) =>
    resolveCompressionConfig({
      ...raw,
      codec: DEFAULT_COMPRESSION_CONFIG.codec,
    }),
);

/**
 * One generated success scenario: a config plus the original size, the
 * compressed size (constrained to be within the target ceiling), the quality
 * (constrained to be at/above the target quality) and a non-negative elapsed
 * compression time.
 */
interface Scenario {
  config: CompressionConfig;
  originalSize: number;
  compressedSize: number;
  quality: number;
  heightPx: number;
  /** Milliseconds the fake clock advances between start and finish. */
  elapsedMs: number;
}

const scenarioGen: Generator<Scenario> = (rng) => {
  const config = configGen(rng);
  const maxBytes = targetSizeBytes(config);

  // Compressed size is any value within the success band [0, maxBytes] (32.9),
  // biased to also hit the exact ceiling edge.
  const compressedSize = oneof(
    integer(0, maxBytes),
    choice([0, 1, maxBytes - 1, maxBytes]),
  )(rng);

  // Original size is an arbitrary real recording size >= 1 (so the ratio is
  // well defined). Cover cases where the "compressed" output is smaller,
  // equal, or even larger than the original — the success predicate depends
  // only on the target size/quality, not on shrinking.
  const originalSize = integer(1, 40 * 1024 * 1024)(rng);

  // Quality is at/above the configured target quality (32.4).
  const quality = float(config.targetQuality, 1)(rng);

  const heightPx = integer(240, 2160)(rng);
  const elapsedMs = integer(0, 5000)(rng);

  return { config, originalSize, compressedSize, quality, heightPx, elapsedMs };
};

function makeOriginal(sizeBytes: number, heightPx: number): LocalVideo {
  return {
    uri: "file:///original.mp4",
    sizeBytes,
    heightPx,
    fps: 60,
    codec: "h264",
    persistent: true,
  };
}

const COMPRESSED_URI = "file:///compressed-transient.mp4";

/**
 * A fake encoder that returns a configurable in-bounds, sufficient-quality
 * output. `persistent` is deliberately set to `true` on the raw encoder output
 * so the test proves that `compress` (not the encoder) forces transience.
 */
function makeFakeEncoder(
  compressedSize: number,
  quality: number,
): VideoEncoder {
  return {
    async encode(request: EncodeRequest): Promise<EncodedResult> {
      const video: LocalVideo = {
        uri: COMPRESSED_URI,
        sizeBytes: compressedSize,
        heightPx: request.targetResolutionPx,
        fps: request.targetFps,
        codec: request.codec,
        persistent: true, // compress() must override this to false (32.8)
      };
      return { video, qualityMetric: quality };
    },
  };
}

/** A TempStore that records every uri it was asked to delete. */
function makeRecordingTempStore(): { store: TempStore; deleted: string[] } {
  const deleted: string[] = [];
  const store: TempStore = {
    async delete(uri: string): Promise<void> {
      deleted.push(uri);
    },
  };
  return { store, deleted };
}

/**
 * A monotonic fake clock: the first read returns `t0`, the second returns
 * `t0 + elapsedMs`. `compress` reads `now()` exactly at start and once after
 * the encode, so the recorded `compressionTime` must equal `elapsedMs`.
 */
function makeClock(t0: number, elapsedMs: number): () => number {
  let call = 0;
  return () => {
    const value = call === 0 ? t0 : t0 + elapsedMs;
    call += 1;
    return value;
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function approxEqual(a: number, b: number, tol: number): boolean {
  const diff = Math.abs(a - b);
  return diff <= tol || diff <= tol * Math.max(Math.abs(a), Math.abs(b));
}

// ---------------------------------------------------------------------------
// Property 28a — computeCompressionMetadata is ratio-consistent (pure).
// ---------------------------------------------------------------------------
const metaInputGen: Generator<{
  originalSize: number;
  compressedSize: number;
  time: number;
}> = record({
  originalSize: integer(1, 40 * 1024 * 1024),
  compressedSize: integer(0, 40 * 1024 * 1024),
  time: integer(0, 60000),
});

function checkMetadataPure({
  originalSize,
  compressedSize,
  time,
}: {
  originalSize: number;
  compressedSize: number;
  time: number;
}): void {
  const meta = computeCompressionMetadata(originalSize, compressedSize, time);
  assert(meta.originalSize === originalSize, "metadata originalSize mismatch");
  assert(meta.compressedSize === compressedSize, "metadata compressedSize mismatch");
  assert(meta.compressionTime === time, "metadata compressionTime mismatch");
  assert(meta.compressionTime >= 0, "metadata compressionTime negative");
  assert(
    approxEqual(meta.compressionRatio, compressedSize / originalSize, RATIO_TOLERANCE),
    `ratio ${meta.compressionRatio} !== ${compressedSize}/${originalSize}`,
  );
}

// ---------------------------------------------------------------------------
// Property 28b — full compress() success path (async).
// ---------------------------------------------------------------------------
async function checkSuccessPath(scenario: Scenario): Promise<void> {
  const { config, originalSize, compressedSize, quality, heightPx, elapsedMs } =
    scenario;
  const maxBytes = targetSizeBytes(config);

  // Precondition sanity: this scenario is a genuine success case.
  assert(compressedSize <= maxBytes, "scenario compressedSize exceeds target (bad generator)");
  assert(quality >= config.targetQuality, "scenario quality below target (bad generator)");

  const original = makeOriginal(originalSize, heightPx);
  const { store, deleted } = makeRecordingTempStore();
  const deps: CompressionDeps = {
    encoder: makeFakeEncoder(compressedSize, quality),
    config,
    now: makeClock(1_000, elapsedMs),
    // Injected delay never resolves, so the timeout branch never fires.
    delay: () => new Promise<void>(() => {}),
    tempStore: store,
  };

  const result: CompressResult = await compress(original, deps);

  // 32.1 — success, not a StructuredError.
  assert(!isCompressionError(result), "expected success, got a StructuredError");
  const success = result as CompressionSuccess;

  // 32.9 — compressed size within the configured target size.
  assert(
    success.output.sizeBytes <= maxBytes,
    `output ${success.output.sizeBytes} exceeds target ${maxBytes}`,
  );
  assert(
    success.output.sizeBytes === compressedSize,
    "output size does not match encoder output",
  );

  // 32.8 — success output is transient.
  assert(success.output.persistent === false, "success output must be transient");

  // 32.7 — metadata consistency.
  const meta = success.meta;
  assert(meta.originalSize === originalSize, `meta.originalSize ${meta.originalSize} !== ${originalSize}`);
  assert(
    meta.compressedSize === compressedSize,
    `meta.compressedSize ${meta.compressedSize} !== ${compressedSize}`,
  );
  assert(
    approxEqual(meta.compressionRatio, compressedSize / originalSize, RATIO_TOLERANCE),
    `meta.compressionRatio ${meta.compressionRatio} !== ${compressedSize}/${originalSize}`,
  );
  assert(meta.compressionTime >= 0, `meta.compressionTime ${meta.compressionTime} < 0`);
  assert(
    meta.compressionTime === elapsedMs,
    `meta.compressionTime ${meta.compressionTime} !== injected elapsed ${elapsedMs}`,
  );

  // 32.5 — the uploaded payload is the compressed output, never the original.
  const uploadSource = resolveUploadSource(original, result);
  assert(uploadSource === success.output, "resolveUploadSource must return the compressed output");
  assert(uploadSource.uri === COMPRESSED_URI, "upload source is not the compressed uri");
  assert(uploadSource.uri !== original.uri, "upload source must not be the original");

  // 32.8 — discardCompressed deletes exactly the output uri; no compressed
  // artifact remains after upload. The original is never deleted.
  await discardCompressed(result, { tempStore: store });
  assert(deleted.length === 1, `expected exactly one delete, got ${deleted.length}`);
  assert(deleted[0] === success.output.uri, `deleted ${deleted[0]} !== output uri ${success.output.uri}`);
  assert(!deleted.includes(original.uri), "original must never be deleted/discarded");
}

/**
 * The compress path is async, so we reproduce the harness's seeded generation
 * loop (matching `forAll`'s sub-seed derivation) and await each case.
 */
async function runSuccessPathProperty(iterations: number): Promise<void> {
  const baseSeed = Date.now() >>> 0;
  for (let i = 0; i < iterations; i++) {
    const rng = makeRng((baseSeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const value = scenarioGen(rng);
    try {
      await checkSuccessPath(value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Property 28b (compress success path) failed on iteration ${i}\n` +
          `  seed:           ${baseSeed}\n` +
          `  iteration:      ${i}\n` +
          `  counterexample: ${JSON.stringify({
            targetSizeMb: value.config.targetSizeMb,
            targetQuality: value.config.targetQuality,
            originalSize: value.originalSize,
            compressedSize: value.compressedSize,
            quality: value.quality,
            elapsedMs: value.elapsedMs,
          })}\n` +
          `  detail:         ${detail}`,
      );
    }
  }
}

async function main(): Promise<void> {
  // Property 28a — pure metadata ratio definition (synchronous harness).
  let syncError: unknown = null;
  try {
    forAll(metaInputGen, checkMetadataPure, { iterations: ITERATIONS });
    // eslint-disable-next-line no-console
    console.log(`PASS  Property 28a: computeCompressionMetadata ratio-consistent [${ITERATIONS} cases]`);
  } catch (error) {
    syncError = error;
    // eslint-disable-next-line no-console
    console.error("FAIL  Property 28a: computeCompressionMetadata");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
  }

  // Property 28b — full compress() success path (async).
  let asyncError: unknown = null;
  try {
    await runSuccessPathProperty(ITERATIONS);
    // eslint-disable-next-line no-console
    console.log(
      `PASS  Property 28b: compress() success is bounded, sufficient, metadata-consistent [${ITERATIONS} cases]`,
    );
  } catch (error) {
    asyncError = error;
    // eslint-disable-next-line no-console
    console.error("FAIL  Property 28b: compress() success path");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
  }

  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  if (syncError || asyncError) {
    // eslint-disable-next-line no-console
    console.error("\nProperty 28 failed.");
    if (proc) proc.exit(1);
    throw new Error("Property 28 failed");
  }
  // eslint-disable-next-line no-console
  console.log("\nProperty 28 passed (successful compression is bounded, sufficient, metadata-consistent).");
  if (proc) proc.exit(0);
}

void main();
