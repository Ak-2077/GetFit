/**
 * Property 27: Compression preserves resolution ceiling without upscaling.
 *
 * Validates: Requirements 32.2
 *
 * For any source video resolution and any valid compression config, the
 * `Video_Compression_Service` output resolution:
 *   - equals the source resolution when the source is at or below the target
 *     ceiling (never upscaled), and
 *   - equals the target ceiling when the source is above it,
 * i.e. output === min(source, target) and output <= source and
 * output <= target for every case.
 *
 * This exercises both the pure `resolveTargetResolution(sourceHeightPx, config)`
 * decision function and the `compress` path (whose `EncodeRequest`
 * `targetResolutionPx` must equal the same ceiling-limited value).
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/recording/videoCompression.resolution.property.test.ts \
 *   && node .tmp-pbt/recording/videoCompression.resolution.property.test.js
 *
 * The command compiles this test together with its imports (the harness +
 * videoCompression + config) into `.tmp-pbt/` and runs the emitted JS. It exits
 * 0 when all cases pass and non-zero (printing seed + counterexample) on the
 * first failure. Uses a seeded PRNG harness (no fast-check, no network).
 */

import {
  CompressionConfig,
  DEFAULT_COMPRESSION_CONFIG,
  resolveCompressionConfig,
} from "../config/compressionConfig";
import {
  CompressResult,
  CompressionDeps,
  EncodeRequest,
  EncodedResult,
  LocalVideo,
  VideoEncoder,
  compress,
  isCompressionError,
  resolveTargetResolution,
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

/**
 * Generate source heights that intentionally cover the interesting regions:
 * well below the ceiling, immediately around 720 (edge values), and well above.
 */
const sourceHeightGen: Generator<number> = oneof(
  integer(1, 719), // below the default ceiling
  choice([718, 719, 720, 721, 722]), // edge band around 720
  integer(720, 4320), // at/above the ceiling (up to 8K)
);

/**
 * Generate valid compression configs. We vary the ceiling itself (including the
 * default 720) so the property holds for arbitrary configured ceilings, not
 * just 720. All configs are normalised through `resolveCompressionConfig` so
 * they are always valid.
 */
const configGen: Generator<CompressionConfig> = map(
  record({
    targetResolutionPx: oneof(
      choice([480, 720, 1080]),
      integer(240, 2160),
    ),
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

/** A source video with the generated height (other fields are irrelevant here). */
const sourceVideoGen: Generator<{ height: number; config: CompressionConfig }> =
  record({
    height: sourceHeightGen,
    config: configGen,
  });

function makeSourceVideo(heightPx: number): LocalVideo {
  return {
    uri: "file:///original.mp4",
    sizeBytes: 20 * 1024 * 1024,
    heightPx,
    fps: 60,
    codec: "h264",
    persistent: true,
  };
}

/**
 * A capturing fake encoder: records the `EncodeRequest` it was handed so the
 * property can assert the ceiling-limited resolution actually reaches the
 * encoder, and returns a valid in-bounds, high-quality output.
 */
function makeCapturingEncoder(): { encoder: VideoEncoder; last: () => EncodeRequest | null } {
  let last: EncodeRequest | null = null;
  const encoder: VideoEncoder = {
    async encode(request: EncodeRequest): Promise<EncodedResult> {
      last = request;
      const video: LocalVideo = {
        uri: "file:///compressed.mp4",
        sizeBytes: 1024, // comfortably under any target size
        heightPx: request.targetResolutionPx,
        fps: request.targetFps,
        codec: request.codec,
        persistent: false,
      };
      return { video, qualityMetric: 1 };
    },
  };
  return { encoder, last: () => last };
}

// ---------------------------------------------------------------------------
// Property 27a — the pure decision function `resolveTargetResolution`.
// ---------------------------------------------------------------------------
function checkResolvePure({ height, config }: { height: number; config: CompressionConfig }): void {
  const target = config.targetResolutionPx;
  const output = resolveTargetResolution(height, config);
  const expected = Math.min(height, target);

  assert(output === expected, `output ${output} !== min(source=${height}, target=${target})=${expected}`);
  assert(output <= height, `output ${output} upscaled above source ${height}`);
  assert(output <= target, `output ${output} exceeds ceiling ${target}`);
  if (height <= target) {
    assert(output === height, `source ${height} <= target ${target} must be unchanged, got ${output}`);
  } else {
    assert(output === target, `source ${height} > target ${target} must clamp to ${target}, got ${output}`);
  }
}

async function checkCompressPath({
  height,
  config,
}: {
  height: number;
  config: CompressionConfig;
}): Promise<void> {
  const { encoder, last } = makeCapturingEncoder();
  const deps: CompressionDeps = {
    encoder,
    config,
    now: () => 0,
    delay: () => new Promise<void>(() => {}), // never times out
  };
  const result: CompressResult = await compress(makeSourceVideo(height), deps);
  assert(!isCompressionError(result), "expected compression success in the ceiling property");

  const request = last();
  assert(request !== null, "encoder was not invoked");
  const target = config.targetResolutionPx;
  const expected = Math.min(height, target);
  assert(
    request!.targetResolutionPx === expected,
    `EncodeRequest.targetResolutionPx ${request!.targetResolutionPx} !== min(${height}, ${target})=${expected}`,
  );
  assert(request!.targetResolutionPx <= height, "compress upscaled above source");
  assert(request!.targetResolutionPx <= target, "compress exceeded ceiling");
}

// ---------------------------------------------------------------------------
// Minimal assertion + inline runner helpers (kept local to the test).
// ---------------------------------------------------------------------------
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Drive the properties.
// ---------------------------------------------------------------------------

/**
 * The compress path is async, so we cannot use `forAll` (sync) directly for it.
 * We reproduce the same seeded generation loop and await each case.
 */
async function runCompressPathProperty(iterations: number): Promise<void> {
  const baseSeed = Date.now() >>> 0;
  for (let i = 0; i < iterations; i++) {
    const rng = makeRng((baseSeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const value = sourceVideoGen(rng);
    try {
      await checkCompressPath(value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Property 27b (compress path) failed on iteration ${i}\n` +
          `  seed:           ${baseSeed}\n` +
          `  iteration:      ${i}\n` +
          `  counterexample: ${JSON.stringify(value)}\n` +
          `  detail:         ${detail}`,
      );
    }
  }
}

async function main(): Promise<void> {
  // Property 27a — pure decision function (synchronous, seeded harness).
  let syncError: unknown = null;
  try {
    forAll(sourceVideoGen, checkResolvePure, { iterations: ITERATIONS });
    // eslint-disable-next-line no-console
    console.log(`PASS  Property 27a: resolveTargetResolution ceiling (no upscaling) [${ITERATIONS} cases]`);
  } catch (error) {
    syncError = error;
    // eslint-disable-next-line no-console
    console.error("FAIL  Property 27a: resolveTargetResolution ceiling");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
  }

  // Property 27b — full compress() path (async).
  let asyncError: unknown = null;
  try {
    await runCompressPathProperty(ITERATIONS);
    // eslint-disable-next-line no-console
    console.log(`PASS  Property 27b: compress() applies ceiling without upscaling [${ITERATIONS} cases]`);
  } catch (error) {
    asyncError = error;
    // eslint-disable-next-line no-console
    console.error("FAIL  Property 27b: compress() ceiling");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
  }

  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  if (syncError || asyncError) {
    // eslint-disable-next-line no-console
    console.error("\nProperty 27 failed.");
    if (proc) proc.exit(1);
    throw new Error("Property 27 failed");
  }
  // eslint-disable-next-line no-console
  console.log("\nProperty 27 passed (resolution ceiling preserved, no upscaling).");
  if (proc) proc.exit(0);
}

// Reference the shared harness `forAll`/`makeRng` are already used above.
void main();
