/**
 * Property 29: Compression failure falls back to the unchanged original.
 *
 * Validates: Requirements 32.6
 *
 * For any compression that fails or exceeds the configured maximum compression
 * time, the `Video_Compression_Service`:
 *   - returns a `StructuredError` with code `COMPRESSION_FAILED` originating
 *     from stage `video_compression` and NEVER throws (32.6);
 *   - leaves the original `LocalVideo` completely unchanged (same object
 *     reference, identical fields, still `persistent === true`);
 *   - causes `resolveUploadSource(original, failure)` to return the ORIGINAL
 *     video as the fallback upload source (32.6);
 *   - makes `discardCompressed(failure, { tempStore })` a no-op — no compressed
 *     artifact exists, so the temp store is never asked to delete anything.
 *
 * This property exhaustively exercises ALL four documented failure modes and
 * confirms the same fallback behaviour holds for each:
 *   Mode 1 — encoder rejects (throws / rejected promise);
 *   Mode 2 — encoder times out (injected `delay` resolves before `encode`,
 *            with an `encode` that never resolves — forcing the TIMEOUT branch
 *            deterministically, no real timers);
 *   Mode 3 — encoder returns an output whose size exceeds the target (32.9
 *            violation);
 *   Mode 4 — encoder returns quality below the configured targetQuality (32.4
 *            violation).
 *
 * Cases are distributed across all four modes (well over 100 total).
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/recording/videoCompression.fallback.property.test.ts \
 *   && node .tmp-pbt/recording/videoCompression.fallback.property.test.js
 *
 * The command compiles this test together with its imports (the harness +
 * videoCompression + config) into `.tmp-pbt/` and runs the emitted JS. It exits
 * 0 when all cases pass and non-zero (printing seed + counterexample) on the
 * first failure. Uses the seeded PRNG harness (no fast-check, no network). All
 * timing is driven through the injected `delay` so no real timers fire.
 */

import {
  CompressionConfig,
  DEFAULT_COMPRESSION_CONFIG,
  resolveCompressionConfig,
  targetSizeBytes,
} from "../config/compressionConfig";
import {
  COMPRESSION_FAILED,
  CompressResult,
  CompressionDeps,
  EncodeRequest,
  EncodedResult,
  LocalVideo,
  TempStore,
  VideoEncoder,
  VIDEO_COMPRESSION_STAGE,
  compress,
  discardCompressed,
  isCompressionError,
  resolveUploadSource,
} from "./videoCompression";
import {
  Generator,
  choice,
  float,
  integer,
  makeRng,
  map,
  oneof,
  record,
} from "../testing/propertyHarness";
import { isStructuredError } from "../types/structuredError";

/** Cases per failure mode; 4 modes => 480 total cases (>= 100 across modes). */
const ITERATIONS_PER_MODE = 120;

/** The four documented failure modes. */
type FailureMode = "reject" | "timeout" | "oversize" | "low_quality";

const ORIGINAL_URI = "file:///original-recording.mp4";

/**
 * Base config generator. `targetQuality` is kept strictly positive so the
 * "quality below target" mode always has a violating quality available; every
 * config remains valid because it is normalised through
 * `resolveCompressionConfig`.
 */
const configGen: Generator<CompressionConfig> = map(
  record({
    targetResolutionPx: oneof(choice([480, 720, 1080]), integer(240, 2160)),
    targetFps: choice([24, 30, 60]),
    targetBitrateKbps: integer(500, 8000),
    // Strictly > 0 so mode 4 can always produce quality < targetQuality.
    targetQuality: float(0.05, 1),
    targetSizeMb: float(5, 15),
    maxCompressionTimeMs: integer(1000, 60000),
  }),
  (raw) =>
    resolveCompressionConfig({
      ...raw,
      codec: DEFAULT_COMPRESSION_CONFIG.codec,
    }),
);

interface Scenario {
  mode: FailureMode;
  config: CompressionConfig;
  originalSize: number;
  heightPx: number;
  /** For "oversize": how far above the ceiling the encoder output sits. */
  oversizeBy: number;
  /** For "low_quality": the sub-target quality the encoder reports. */
  lowQuality: number;
  /** For "low_quality"/"oversize": a within-bounds output size. */
  outputSize: number;
}

function scenarioGenFor(mode: FailureMode): Generator<Scenario> {
  return (rng) => {
    const config = configGen(rng);
    const maxBytes = targetSizeBytes(config);
    const originalSize = integer(1, 40 * 1024 * 1024)(rng);
    const heightPx = integer(240, 2160)(rng);
    const oversizeBy = integer(1, 8 * 1024 * 1024)(rng);
    // A quality strictly below the target (target is > 0 by construction).
    const lowQuality = float(0, config.targetQuality)(rng) * 0.999999;
    const outputSize = integer(0, maxBytes)(rng);
    return {
      mode,
      config,
      originalSize,
      heightPx,
      oversizeBy,
      lowQuality,
      outputSize,
    };
  };
}

function makeOriginal(sizeBytes: number, heightPx: number): LocalVideo {
  return {
    uri: ORIGINAL_URI,
    sizeBytes,
    heightPx,
    fps: 60,
    codec: "h264",
    persistent: true,
  };
}

/** A never-resolving promise (never settles). */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** Snapshot the original's fields for an unchanged-comparison after compress. */
function snapshot(v: LocalVideo): LocalVideo {
  return {
    uri: v.uri,
    sizeBytes: v.sizeBytes,
    heightPx: v.heightPx,
    fps: v.fps,
    codec: v.codec,
    persistent: v.persistent,
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
 * Build the deps for a given failure mode. Each mode forces exactly one failure
 * branch of `compress` deterministically:
 *  - reject:      encoder rejects; delay never resolves.
 *  - timeout:     encoder never resolves; delay resolves immediately (TIMEOUT).
 *  - oversize:    encoder resolves with size > target; delay never resolves.
 *  - low_quality: encoder resolves within size but quality < target; delay
 *                 never resolves.
 */
function makeDeps(
  scenario: Scenario,
  store: TempStore,
): CompressionDeps {
  const { mode, config } = scenario;
  const maxBytes = targetSizeBytes(config);

  let encoder: VideoEncoder;
  let delay: (ms: number) => Promise<void>;

  switch (mode) {
    case "reject":
      encoder = {
        encode(): Promise<EncodedResult> {
          return Promise.reject(new Error("encoder blew up"));
        },
      };
      delay = () => pending<void>();
      break;
    case "timeout":
      encoder = {
        encode(): Promise<EncodedResult> {
          return pending<EncodedResult>();
        },
      };
      // Resolves immediately, winning the race -> TIMEOUT branch.
      delay = () => Promise.resolve();
      break;
    case "oversize":
      encoder = {
        async encode(request: EncodeRequest): Promise<EncodedResult> {
          const video: LocalVideo = {
            uri: "file:///compressed-oversize.mp4",
            sizeBytes: maxBytes + scenario.oversizeBy,
            heightPx: request.targetResolutionPx,
            fps: request.targetFps,
            codec: request.codec,
            persistent: true,
          };
          // Quality is fine; the size check fails first.
          return { video, qualityMetric: 1 };
        },
      };
      delay = () => pending<void>();
      break;
    case "low_quality":
      encoder = {
        async encode(request: EncodeRequest): Promise<EncodedResult> {
          const video: LocalVideo = {
            uri: "file:///compressed-lowq.mp4",
            sizeBytes: scenario.outputSize, // within [0, maxBytes]
            heightPx: request.targetResolutionPx,
            fps: request.targetFps,
            codec: request.codec,
            persistent: true,
          };
          return { video, qualityMetric: scenario.lowQuality };
        },
      };
      delay = () => pending<void>();
      break;
  }

  return { encoder, config, delay, tempStore: store };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function checkFallback(scenario: Scenario): Promise<void> {
  const original = makeOriginal(scenario.originalSize, scenario.heightPx);
  const before = snapshot(original);
  const { store, deleted } = makeRecordingTempStore();
  const deps = makeDeps(scenario, store);

  // compress must never throw on domain failure.
  let result: CompressResult;
  try {
    result = await compress(original, deps);
  } catch (error) {
    throw new Error(
      `compress threw instead of returning a StructuredError: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // 32.6 — result is a StructuredError with the right code + stage.
  assert(isStructuredError(result), "expected a StructuredError result");
  assert(isCompressionError(result), "isCompressionError should narrow the failure");
  const err = result as { code: string; stage: string; message: string };
  assert(
    err.code === COMPRESSION_FAILED,
    `expected code ${COMPRESSION_FAILED}, got ${err.code}`,
  );
  assert(
    err.stage === VIDEO_COMPRESSION_STAGE,
    `expected stage ${VIDEO_COMPRESSION_STAGE}, got ${err.stage}`,
  );
  assert(typeof err.message === "string" && err.message.length > 0, "message must be non-empty");

  // Original bytes remain unchanged: identical fields, still persistent.
  assert(original.uri === before.uri, "original uri changed");
  assert(original.sizeBytes === before.sizeBytes, "original sizeBytes changed");
  assert(original.heightPx === before.heightPx, "original heightPx changed");
  assert(original.fps === before.fps, "original fps changed");
  assert(original.codec === before.codec, "original codec changed");
  assert(original.persistent === true, "original must remain persistent === true");

  // 32.6 — the fallback upload source is the ORIGINAL (same reference).
  const uploadSource = resolveUploadSource(original, result);
  assert(uploadSource === original, "resolveUploadSource must return the original on failure");
  assert(uploadSource.uri === ORIGINAL_URI, "fallback upload source is not the original uri");

  // discardCompressed is a no-op on failure: nothing to delete.
  await discardCompressed(result, { tempStore: store });
  assert(
    deleted.length === 0,
    `discardCompressed must not delete anything on failure; deleted ${JSON.stringify(deleted)}`,
  );
}

async function runModeProperty(
  mode: FailureMode,
  iterations: number,
): Promise<void> {
  const baseSeed = Date.now() >>> 0;
  const gen = scenarioGenFor(mode);
  for (let i = 0; i < iterations; i++) {
    const rng = makeRng((baseSeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const value = gen(rng);
    try {
      await checkFallback(value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Property 29 (${mode}) failed on iteration ${i}\n` +
          `  seed:           ${baseSeed}\n` +
          `  iteration:      ${i}\n` +
          `  counterexample: ${JSON.stringify({
            mode: value.mode,
            targetSizeMb: value.config.targetSizeMb,
            targetQuality: value.config.targetQuality,
            maxCompressionTimeMs: value.config.maxCompressionTimeMs,
            originalSize: value.originalSize,
            oversizeBy: value.oversizeBy,
            lowQuality: value.lowQuality,
            outputSize: value.outputSize,
          })}\n` +
          `  detail:         ${detail}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const modes: FailureMode[] = ["reject", "timeout", "oversize", "low_quality"];
  const failures: string[] = [];

  for (const mode of modes) {
    try {
      await runModeProperty(mode, ITERATIONS_PER_MODE);
      // eslint-disable-next-line no-console
      console.log(
        `PASS  Property 29 [${mode}]: failure -> COMPRESSION_FAILED, original unchanged, fallback = original [${ITERATIONS_PER_MODE} cases]`,
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      // eslint-disable-next-line no-console
      console.error(`FAIL  Property 29 [${mode}]`);
      // eslint-disable-next-line no-console
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\nProperty 29 failed (${failures.length} mode(s)).`);
    if (proc) proc.exit(1);
    throw new Error("Property 29 failed");
  }
  // eslint-disable-next-line no-console
  console.log(
    `\nProperty 29 passed across all ${modes.length} failure modes ` +
      `(${modes.length * ITERATIONS_PER_MODE} cases): compression failure falls back to the unchanged original.`,
  );
  if (proc) proc.exit(0);
}

void main();
