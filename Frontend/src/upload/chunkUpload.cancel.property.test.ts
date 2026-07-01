/**
 * Property 35: Cancel discards all chunks and releases storage.
 *
 * Validates: Requirements 33.8
 *
 * For any sequence of pause/resume operations followed by a cancel:
 *   - `controller.cancel()` calls `store.discardAll` exactly once for the
 *     session id;
 *   - the verified set is cleared (progress `verified === 0`, fraction 0 for a
 *     non-empty file);
 *   - the session status becomes `cancelled`;
 *   - the associated upload storage is released — the store retains no chunks
 *     for the session afterward.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/upload/chunkUpload.cancel.property.test.ts \
 *   && node .tmp-pbt/upload/chunkUpload.cancel.property.test.js
 *
 * The engine path is async, so we reproduce the harness's seeded loop and await
 * each case. Uses the seeded PRNG harness (no fast-check, no network). Exits 0
 * on success and non-zero (printing seed + counterexample) on the first
 * failure. See the retry test for why `chunkSizeMinMb` is overridden to yield
 * byte-sized chunks.
 */

import {
  ChunkStore,
  ChunkUploadResult,
  ChunkUploader,
  Hasher,
  UploadChunk,
  createChunkUpload,
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

function configForChunkBytes(b: number): Partial<ChunkUploadConfig> {
  return { chunkSizeMb: b / (1024 * 1024), chunkSizeMinMb: 1e-9, chunkSizeMaxMb: 50 };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * A recording ChunkStore. `save` retains a chunk index under its session; a
 * `discardAll(id)` records the call and releases (deletes) every retained chunk
 * for that session — modeling storage release (Req 33.8).
 */
function makeFakeStore(): {
  store: ChunkStore;
  saved: Map<string, Set<number>>;
  discardCalls: string[];
} {
  const saved = new Map<string, Set<number>>();
  const discardCalls: string[] = [];
  const store: ChunkStore = {
    async save(sessionId: string, chunk: UploadChunk): Promise<void> {
      if (!saved.has(sessionId)) saved.set(sessionId, new Set());
      saved.get(sessionId)!.add(chunk.index);
    },
    async discardAll(sessionId: string): Promise<void> {
      discardCalls.push(sessionId);
      saved.delete(sessionId); // release the storage
    },
  };
  return { store, saved, discardCalls };
}

/** A pausing transport (see resume test): verifies + can trigger a pause once. */
interface PauseControl {
  pauseAtIndex: number;
  pause: () => void;
  triggered: boolean;
}

function makePausingUploader(control: PauseControl): {
  uploader: ChunkUploader;
  received: number[];
} {
  const received: number[] = [];
  const uploader: ChunkUploader = {
    async uploadChunk(chunk: UploadChunk): Promise<ChunkUploadResult> {
      received.push(chunk.index);
      if (chunk.index === control.pauseAtIndex && !control.triggered) {
        control.triggered = true;
        control.pause();
      }
      return { serverChecksum: chunk.sha256 };
    },
  };
  return { uploader, received };
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
  /** Whether to resume after the pause before cancelling. */
  resumeBeforeCancel: boolean;
  /** Seed to choose the pause index. */
  pauseSeed: number;
}

const scenarioGen: Generator<Scenario> = (rng) => {
  const chunkBytes = integer(1, 16)(rng);
  const chunkCount = integer(1, 8)(rng);
  const len = chunkBytes * (chunkCount - 1) + integer(1, chunkBytes)(rng);
  return {
    bytes: makeBytes(len, rng),
    chunkBytes,
    resumeBeforeCancel: integer(0, 1)(rng) === 1,
    pauseSeed: integer(0, 1_000_000)(rng),
  };
};

async function checkScenario(scenario: Scenario): Promise<void> {
  const { bytes, chunkBytes, resumeBeforeCancel, pauseSeed } = scenario;
  const hasher = makeFakeHasher();
  const { store, saved, discardCalls } = makeFakeStore();

  const control: PauseControl = { pauseAtIndex: 0, pause: () => {}, triggered: false };
  const { uploader } = makePausingUploader(control);

  const controller = createChunkUpload(bytes, {
    uploader,
    hasher,
    store,
    config: configForChunkBytes(chunkBytes),
  });
  const sessionId = controller.session.id;
  const chunkCount = controller.session.chunks.length;
  control.pause = () => controller.pause();

  // Exercise a pause/resume sequence, then cancel.
  if (chunkCount >= 2) {
    control.pauseAtIndex = pauseSeed % (chunkCount - 1); // in [0, chunkCount - 2]
    const paused = await controller.start();
    assert(paused.status === "paused", `expected paused, got ${paused.status}`);
    if (resumeBeforeCancel) {
      await controller.resume(); // may complete
    }
  } else {
    // Single chunk: just run it (it verifies and completes).
    await controller.start();
  }

  // Some chunks should have been saved before cancel (unless nothing verified).
  const cancelOutcome = await controller.cancel();

  // discardAll called exactly once, for this session id.
  assert(discardCalls.length === 1, `discardAll called ${discardCalls.length} times, expected 1`);
  assert(discardCalls[0] === sessionId, `discardAll called for ${discardCalls[0]} !== ${sessionId}`);

  // Status is cancelled.
  assert(controller.session.status === "cancelled", `status ${controller.session.status} !== cancelled`);
  assert(cancelOutcome.status === "cancelled", `outcome ${cancelOutcome.status} !== cancelled`);

  // Verified set cleared.
  const progress = controller.getProgress();
  assert(progress.verified === 0, `verified ${progress.verified} !== 0 after cancel`);
  for (const chunk of controller.session.chunks) {
    assert(!chunk.verified, `chunk ${chunk.index} still verified after cancel`);
  }
  if (chunkCount > 0) {
    assert(progress.fraction === 0, `fraction ${progress.fraction} !== 0 after cancel`);
  }

  // Storage released: the store retains no chunks for this session.
  assert(
    saved.get(sessionId) === undefined || saved.get(sessionId)!.size === 0,
    `store still retains chunks for ${sessionId} after cancel`,
  );

  // isComplete only when there were zero chunks to begin with.
  assert(
    controller.isComplete() === (chunkCount === 0),
    `isComplete ${controller.isComplete()} inconsistent with chunkCount ${chunkCount}`,
  );
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
      console.error("FAIL  Property 35: cancel discards all chunks");
      // eslint-disable-next-line no-console
      console.error(
        `Property 35 failed on iteration ${i}\n` +
          `  seed:           ${baseSeed}\n` +
          `  iteration:      ${i}\n` +
          `  counterexample: ${JSON.stringify({
            fileLen: scenario.bytes.length,
            chunkBytes: scenario.chunkBytes,
            resumeBeforeCancel: scenario.resumeBeforeCancel,
            pauseSeed: scenario.pauseSeed,
          })}\n` +
          `  detail:         ${detail}`,
      );
      if (proc) proc.exit(1);
      throw error;
    }
  }
  // eslint-disable-next-line no-console
  console.log(`PASS  Property 35: cancel discards all chunks and releases storage [${ITERATIONS} cases]`);
  // eslint-disable-next-line no-console
  console.log("\nProperty 35 passed.");
  if (proc) proc.exit(0);
}

void main();
