/**
 * Property 34: Progress equals the verified fraction and completion is exact.
 *
 * Validates: Requirements 33.9, 33.10
 *
 * For any upload, at every observation:
 *   - `computeProgress().fraction === verified / total` (and `=== 1` for an
 *     empty file with zero chunks);
 *   - `fraction` lies in [0.0, 1.0];
 *   - the verified count is monotonic non-decreasing as chunks are verified;
 *   - the upload is complete if and only if every chunk is verified (fraction
 *     equals 1.0), matching `isComplete()`.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/upload/chunkUpload.progress.property.test.ts \
 *   && node .tmp-pbt/upload/chunkUpload.progress.property.test.js
 *
 * Uses the seeded PRNG harness (no fast-check, no network). Exits 0 on success
 * and non-zero (printing seed + counterexample) on the first failure. See the
 * retry test for why `chunkSizeMinMb` is overridden to yield byte-sized chunks.
 */

import {
  ChunkUploadResult,
  ChunkUploader,
  Hasher,
  UploadChunk,
  computeProgress,
  createChunkUpload,
  isComplete,
} from "./chunkUpload";
import { ChunkUploadConfig } from "../config/chunkUploadConfig";
import { Generator, forAll, integer } from "../testing/propertyHarness";

const ITERATIONS = 300;
const TOLERANCE = 1e-12;

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

function configForChunkBytes(b: number): Partial<ChunkUploadConfig> {
  return { chunkSizeMb: b / (1024 * 1024), chunkSizeMinMb: 1e-9, chunkSizeMaxMb: 50 };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const noopUploader: ChunkUploader = {
  async uploadChunk(chunk: UploadChunk): Promise<ChunkUploadResult> {
    return { serverChecksum: chunk.sha256 };
  },
};

interface Scenario {
  bytes: Uint8Array;
  chunkBytes: number;
  /** A permutation of chunk indices giving the order chunks get verified. */
  verifyOrderSeed: number[];
}

function makeBytes(len: number, rng: Parameters<Generator<number>>[0]): Uint8Array {
  const arr = new Uint8Array(len);
  const byte = integer(0, 255);
  for (let i = 0; i < len; i += 1) arr[i] = byte(rng);
  return arr;
}

const scenarioGen: Generator<Scenario> = (rng) => {
  const emptyRoll = integer(0, 4)(rng);
  const chunkBytes = integer(1, 16)(rng);
  let len: number;
  if (emptyRoll === 0) {
    len = 0; // empty file → zero chunks, vacuously complete
  } else {
    const chunkCount = integer(1, 10)(rng);
    len = chunkBytes * (chunkCount - 1) + integer(1, chunkBytes)(rng);
  }
  const bytes = makeBytes(len, rng);
  // A random sequence of priorities to derive a verification order.
  const chunkCount = Math.ceil(len / chunkBytes);
  const verifyOrderSeed: number[] = [];
  for (let i = 0; i < chunkCount; i += 1) verifyOrderSeed.push(integer(0, 1_000_000)(rng));
  return { bytes, chunkBytes, verifyOrderSeed };
};

/** Deterministic permutation of [0..n-1] derived from priorities. */
function permutationFrom(priorities: number[]): number[] {
  return priorities
    .map((p, index) => ({ p, index }))
    .sort((a, b) => (a.p === b.p ? a.index - b.index : a.p - b.p))
    .map((e) => e.index);
}

function checkProgress(scenario: Scenario): void {
  const { bytes, chunkBytes, verifyOrderSeed } = scenario;
  const hasher = makeFakeHasher();
  const controller = createChunkUpload(bytes, {
    uploader: noopUploader,
    hasher,
    config: configForChunkBytes(chunkBytes),
  });
  const chunks = controller.session.chunks;
  const total = chunks.length;

  // Initial observation: nothing verified yet.
  const initial = computeProgress(controller.session);
  assert(initial.total === total, `initial total ${initial.total} !== ${total}`);
  assert(initial.verified === 0, `initial verified ${initial.verified} !== 0`);

  if (total === 0) {
    // Empty file: vacuously complete, fraction 1.
    assert(initial.fraction === 1, `empty fraction ${initial.fraction} !== 1`);
    assert(initial.complete === true, "empty file must be complete");
    assert(isComplete(controller.session) === true, "isComplete must be true for empty file");
    return;
  }

  assert(initial.fraction === 0, `initial fraction ${initial.fraction} !== 0`);
  assert(initial.complete === false, "non-empty file must not start complete");

  // Verify chunks one at a time in a random order, observing progress at each
  // step.
  const order = permutationFrom(verifyOrderSeed);
  let prevVerified = 0;
  let verifiedSoFar = 0;

  for (const idx of order) {
    chunks[idx]!.verified = true;
    verifiedSoFar += 1;

    const progress = computeProgress(controller.session);

    // fraction === verified / total
    assert(
      Math.abs(progress.fraction - verifiedSoFar / total) <= TOLERANCE,
      `fraction ${progress.fraction} !== ${verifiedSoFar}/${total}`,
    );
    // fraction in [0, 1]
    assert(progress.fraction >= 0 && progress.fraction <= 1, `fraction ${progress.fraction} out of [0,1]`);
    // verified count matches
    assert(progress.verified === verifiedSoFar, `verified ${progress.verified} !== ${verifiedSoFar}`);
    // monotonic non-decreasing
    assert(progress.verified >= prevVerified, `verified decreased ${prevVerified} -> ${progress.verified}`);
    prevVerified = progress.verified;

    // complete iff all verified, consistent with isComplete()
    const allVerified = verifiedSoFar === total;
    assert(progress.complete === allVerified, `complete ${progress.complete} !== ${allVerified}`);
    assert(
      isComplete(controller.session) === allVerified,
      `isComplete ${isComplete(controller.session)} !== ${allVerified}`,
    );
    if (allVerified) {
      assert(progress.fraction === 1, `all-verified fraction ${progress.fraction} !== 1`);
    }
  }

  // Final observation: fully complete.
  const done = computeProgress(controller.session);
  assert(done.complete === true, "final progress must be complete");
  assert(done.fraction === 1, `final fraction ${done.fraction} !== 1`);
  assert(done.verified === total, `final verified ${done.verified} !== ${total}`);
}

function main(): void {
  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  try {
    forAll(scenarioGen, checkProgress, { iterations: ITERATIONS });
    // eslint-disable-next-line no-console
    console.log(
      `PASS  Property 34: progress equals the verified fraction and completion is exact [${ITERATIONS} cases]`,
    );
    // eslint-disable-next-line no-console
    console.log("\nProperty 34 passed.");
    if (proc) proc.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("FAIL  Property 34: progress and completion");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    if (proc) proc.exit(1);
    throw error;
  }
}

main();
