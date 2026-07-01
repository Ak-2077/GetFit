/**
 * Property 32: Bounded retry never re-sends verified chunks; exhaustion halts
 * and reports.
 *
 * Validates: Requirements 33.4, 33.5
 *
 * For any sequence of transient chunk failures:
 *   - `uploadChunkWithRetry` makes at most `maxRetries + 1` attempts per chunk
 *     and stops as soon as the chunk verifies (a chunk that succeeds on attempt
 *     k performs exactly k+1 attempts);
 *   - driving the full engine, the total number of transport attempts per chunk
 *     never exceeds `maxRetries + 1`;
 *   - already-verified chunks are never re-uploaded on a re-run (Req 33.4);
 *   - when a chunk exhausts its retry budget the outcome is `failed`, names the
 *     chunk via `failedChunkIndex`, and carries a `CHUNK_UPLOAD_FAILED`
 *     StructuredError (Req 33.5);
 *   - every chunk verified before the failure remains verified.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/upload/chunkUpload.retry.property.test.ts \
 *   && node .tmp-pbt/upload/chunkUpload.retry.property.test.js
 *
 * The upload path is async, so we reproduce the harness's seeded generation
 * loop (matching `forAll`'s sub-seed derivation) and await each case. Uses the
 * seeded PRNG harness (no fast-check, no network). Exits 0 on success and
 * non-zero (printing seed + counterexample) on the first failure.
 *
 * NOTE ON CHUNK SIZING: the config clamps chunk size to the [1, 50] MB band by
 * default. To exercise many small chunks cheaply we override `chunkSizeMinMb`
 * to a tiny positive value so the *real* engine/config path yields exact,
 * byte-sized chunks (see `configForChunkBytes`). This keeps the production code
 * path under test while keeping files tiny and runs fast.
 */

import {
  CHUNK_UPLOAD_FAILED,
  CHUNK_UPLOAD_STAGE,
  ChunkUploadResult,
  ChunkUploader,
  Hasher,
  UploadChunk,
  createChunkUpload,
  partitionFile,
  uploadChunkWithRetry,
} from "./chunkUpload";
import { ChunkUploadConfig } from "../config/chunkUploadConfig";
import { Generator, integer, makeRng } from "../testing/propertyHarness";

const ITERATIONS = 200;

function makeFakeHasher(): Hasher {
  return {
    sha256(bytes: Uint8Array): string {
      let out = `${bytes.length}:`;
      for (let i = 0; i < bytes.length; i += 1) {
        out += bytes[i]!.toString(16).padStart(2, "0");
      }
      return out;
    },
  };
}

/** Config overrides that make the engine partition into exactly `b`-byte chunks. */
function configForChunkBytes(b: number, maxRetries?: number): Partial<ChunkUploadConfig> {
  const cfg: Partial<ChunkUploadConfig> = {
    chunkSizeMb: b / (1024 * 1024),
    chunkSizeMinMb: 1e-9,
    chunkSizeMaxMb: 50,
  };
  if (maxRetries !== undefined) cfg.maxRetries = maxRetries;
  return cfg;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** How a scripted failure manifests before a chunk finally succeeds. */
type FailureMode = "throw" | "mismatch";

/** Per-chunk upload plan: fail `failures` times (in `mode`) then succeed. */
interface ChunkPlan {
  failures: number;
  mode: FailureMode;
}

/** A mutable control the fake transport reads on each call. */
interface UploaderControl {
  /** When true, every attempt succeeds regardless of the plan. */
  forceSuccess: boolean;
}

/**
 * A deterministic fake transport. For chunk `index`, the first `plan.failures`
 * attempts fail (throwing or returning a mismatched checksum) and every
 * subsequent attempt returns the correct `serverChecksum` (the chunk's own
 * sha256, so it verifies). Records every received chunk index in order and the
 * attempt count per index. A `forceSuccess` flag lets a later run always
 * succeed (used to prove verified chunks are never re-sent).
 */
function makeFakeUploader(
  plan: Map<number, ChunkPlan>,
  control: UploaderControl,
): {
  uploader: ChunkUploader;
  receivedOrder: number[];
  attemptsByIndex: Map<number, number>;
} {
  const receivedOrder: number[] = [];
  const attemptsByIndex = new Map<number, number>();

  const uploader: ChunkUploader = {
    async uploadChunk(chunk: UploadChunk): Promise<ChunkUploadResult> {
      receivedOrder.push(chunk.index);
      const attemptNo = attemptsByIndex.get(chunk.index) ?? 0; // 0-based
      attemptsByIndex.set(chunk.index, attemptNo + 1);

      if (control.forceSuccess) return { serverChecksum: chunk.sha256 };

      const spec = plan.get(chunk.index) ?? { failures: 0, mode: "mismatch" };
      if (attemptNo < spec.failures) {
        if (spec.mode === "throw") {
          throw new Error(`transient transport failure (chunk ${chunk.index})`);
        }
        return { serverChecksum: `WRONG-${chunk.index}-${attemptNo}` };
      }
      return { serverChecksum: chunk.sha256 };
    },
  };

  return { uploader, receivedOrder, attemptsByIndex };
}

function makeBytes(len: number, rng: Parameters<Generator<number>>[0]): Uint8Array {
  const arr = new Uint8Array(len);
  const byte = integer(0, 255);
  for (let i = 0; i < len; i += 1) arr[i] = byte(rng);
  return arr;
}

interface Scenario {
  bytes: Uint8Array;
  chunkBytes: number;
  maxRetries: number;
  plan: Map<number, ChunkPlan>;
}

const scenarioGen: Generator<Scenario> = (rng) => {
  const chunkBytes = integer(1, 16)(rng);
  const chunkCount = integer(1, 8)(rng);
  const len = chunkBytes * (chunkCount - 1) + integer(1, chunkBytes)(rng);
  const bytes = makeBytes(len, rng);
  const maxRetries = integer(0, 4)(rng);
  const budget = maxRetries;

  const plan = new Map<number, ChunkPlan>();
  for (let i = 0; i < chunkCount; i += 1) {
    const roll = integer(0, 9)(rng);
    const mode: FailureMode = integer(0, 1)(rng) === 0 ? "throw" : "mismatch";
    let failures: number;
    if (roll < 5) {
      failures = 0; // succeed immediately
    } else if (roll < 8) {
      failures = integer(0, budget)(rng); // recoverable within budget
    } else {
      failures = budget + 1 + integer(0, 2)(rng); // exhausts the budget
    }
    plan.set(i, { failures, mode });
  }

  return { bytes, chunkBytes, maxRetries, plan };
};

/** The index of the first chunk scripted to exhaust its budget, or -1. */
function firstExhaustingIndex(plan: Map<number, ChunkPlan>, budget: number, count: number): number {
  for (let i = 0; i < count; i += 1) {
    if (plan.get(i)!.failures > budget) return i;
  }
  return -1;
}

async function checkScenario(scenario: Scenario): Promise<void> {
  const { bytes, chunkBytes, maxRetries, plan } = scenario;
  const budget = maxRetries;
  const hasher = makeFakeHasher();

  // ── Sub-check A: uploadChunkWithRetry attempt bound + early stop ──────────
  {
    const control: UploaderControl = { forceSuccess: false };
    const { uploader, attemptsByIndex } = makeFakeUploader(plan, control);
    const chunks = partitionFile(bytes, chunkBytes, hasher);

    for (const chunk of chunks) {
      attemptsByIndex.delete(chunk.index);
      const spec = plan.get(chunk.index)!;
      const result = await uploadChunkWithRetry(chunk, uploader, maxRetries);
      const attempts = attemptsByIndex.get(chunk.index) ?? 0;

      assert(
        attempts <= budget + 1,
        `chunk ${chunk.index}: ${attempts} attempts exceed budget ${budget + 1}`,
      );

      if (spec.failures <= budget) {
        assert(result.verified, `chunk ${chunk.index} should have verified`);
        assert(
          attempts === spec.failures + 1,
          `chunk ${chunk.index}: expected ${spec.failures + 1} attempts, got ${attempts}`,
        );
        assert(
          result.retries === spec.failures,
          `chunk ${chunk.index}: expected ${spec.failures} retries, got ${result.retries}`,
        );
      } else {
        assert(!result.verified, `chunk ${chunk.index} should NOT have verified`);
        assert(
          attempts === budget + 1,
          `chunk ${chunk.index}: exhausting run expected ${budget + 1} attempts, got ${attempts}`,
        );
      }
    }
  }

  // ── Sub-check B: full engine attempt bound, halt/report, retention ────────
  const control: UploaderControl = { forceSuccess: false };
  const { uploader, receivedOrder, attemptsByIndex } = makeFakeUploader(plan, control);
  const controller = createChunkUpload(bytes, {
    uploader,
    hasher,
    config: configForChunkBytes(chunkBytes, maxRetries),
  });
  const chunkCount = controller.session.chunks.length;
  const failIndex = firstExhaustingIndex(plan, budget, chunkCount);

  const outcome = await controller.start();

  for (const [index, attempts] of attemptsByIndex.entries()) {
    assert(
      attempts <= budget + 1,
      `engine: chunk ${index} used ${attempts} attempts > ${budget + 1}`,
    );
  }

  if (failIndex === -1) {
    assert(outcome.status === "complete", `expected complete, got ${outcome.status}`);
    for (const chunk of controller.session.chunks) {
      assert(chunk.verified, `chunk ${chunk.index} should be verified on complete`);
    }
  } else {
    assert(outcome.status === "failed", `expected failed, got ${outcome.status}`);
    if (outcome.status === "failed") {
      assert(
        outcome.failedChunkIndex === failIndex,
        `failedChunkIndex ${outcome.failedChunkIndex} !== ${failIndex}`,
      );
      assert(
        outcome.error.code === CHUNK_UPLOAD_FAILED,
        `error code ${outcome.error.code} !== ${CHUNK_UPLOAD_FAILED}`,
      );
      assert(
        outcome.error.stage === CHUNK_UPLOAD_STAGE,
        `error stage ${outcome.error.stage} !== ${CHUNK_UPLOAD_STAGE}`,
      );
    }
    for (const chunk of controller.session.chunks) {
      if (chunk.index < failIndex) {
        assert(chunk.verified, `chunk ${chunk.index} before failure must remain verified`);
      }
    }
    for (const index of receivedOrder) {
      assert(index <= failIndex, `engine sent chunk ${index} past failure ${failIndex}`);
    }
  }

  // ── Sub-check C: a re-run never re-uploads already-verified chunks ────────
  // Switch the transport to always succeed and re-run. The engine must send
  // ONLY chunks that were still unverified; the verified set is skipped.
  const verifiedBefore = new Set(
    controller.session.chunks.filter((c) => c.verified).map((c) => c.index),
  );
  receivedOrder.length = 0;
  control.forceSuccess = true;
  const outcome2 = await controller.resume();

  for (const index of receivedOrder) {
    assert(!verifiedBefore.has(index), `re-run re-uploaded already-verified chunk ${index}`);
  }
  // With the transport now always succeeding, the re-run completes.
  assert(outcome2.status === "complete", `resume expected complete, got ${outcome2.status}`);
  for (const chunk of controller.session.chunks) {
    assert(chunk.verified, `chunk ${chunk.index} should be verified after successful resume`);
  }
}

async function main(): Promise<void> {
  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  const baseSeed = Date.now() >>> 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const rng = makeRng((baseSeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const scenario = scenarioGen(rng);
    try {
      await checkScenario(scenario);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error("FAIL  Property 32: bounded chunk retry");
      // eslint-disable-next-line no-console
      console.error(
        `Property 32 failed on iteration ${i}\n` +
          `  seed:           ${baseSeed}\n` +
          `  iteration:      ${i}\n` +
          `  counterexample: ${JSON.stringify({
            fileLen: scenario.bytes.length,
            chunkBytes: scenario.chunkBytes,
            maxRetries: scenario.maxRetries,
            plan: Array.from(scenario.plan.entries()),
          })}\n` +
          `  detail:         ${detail}`,
      );
      if (proc) proc.exit(1);
      throw error;
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `PASS  Property 32: bounded retry never re-sends verified chunks; exhaustion halts and reports [${ITERATIONS} cases]`,
  );
  // eslint-disable-next-line no-console
  console.log("\nProperty 32 passed.");
  if (proc) proc.exit(0);
}

void main();
