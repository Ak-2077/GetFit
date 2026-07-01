/**
 * Property 33: Resume starts at the first unverified chunk.
 *
 * Validates: Requirements 33.6
 *
 * Two sub-properties:
 *   (A, pure) `firstUnverifiedIndex(session)` returns the minimum index among
 *     unverified chunks, or -1 when every chunk is verified.
 *   (B, engine) After a pause partway through an upload (a verified prefix
 *     0..k), resuming re-uploads only chunks from the first unverified index
 *     k+1 onward — the verified prefix is never re-sent. The fake transport is
 *     instrumented to record exactly which chunk indices it receives on resume.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/upload/chunkUpload.resume.property.test.ts \
 *   && node .tmp-pbt/upload/chunkUpload.resume.property.test.js
 *
 * The engine path is async, so we reproduce the harness's seeded loop and await
 * each case. Uses the seeded PRNG harness (no fast-check, no network). Exits 0
 * on success and non-zero (printing seed + counterexample) on the first
 * failure. See the retry test for why `chunkSizeMinMb` is overridden to yield
 * tiny, byte-sized chunks through the real config path.
 */

import {
  ChunkUploadResult,
  ChunkUploader,
  Hasher,
  UploadChunk,
  createChunkUpload,
  firstUnverifiedIndex,
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

function makeBytes(len: number, rng: Parameters<Generator<number>>[0]): Uint8Array {
  const arr = new Uint8Array(len);
  const byte = integer(0, 255);
  for (let i = 0; i < len; i += 1) arr[i] = byte(rng);
  return arr;
}

/**
 * A fake transport that always verifies (returns the chunk's own sha256) and
 * records every received index. When it uploads the configured `pauseAtIndex`
 * for the first time, it invokes `control.pause()` — so once the current chunk
 * finishes verifying, the engine's between-chunks check stops the run cleanly,
 * leaving a verified prefix 0..pauseAtIndex.
 */
interface PauseControl {
  pauseAtIndex: number;
  pause: () => void;
  triggered: boolean;
}

function makeFakeUploader(control: PauseControl): {
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

interface Scenario {
  bytes: Uint8Array;
  chunkBytes: number;
  chunkCount: number;
  /** Random verified flags used by the pure firstUnverifiedIndex sub-check. */
  verifiedFlags: boolean[];
}

const scenarioGen: Generator<Scenario> = (rng) => {
  const chunkBytes = integer(1, 16)(rng);
  const chunkCount = integer(1, 8)(rng);
  const len = chunkBytes * (chunkCount - 1) + integer(1, chunkBytes)(rng);
  const bytes = makeBytes(len, rng);
  const verifiedFlags: boolean[] = [];
  for (let i = 0; i < chunkCount; i += 1) verifiedFlags.push(integer(0, 1)(rng) === 1);
  return { bytes, chunkBytes, chunkCount, verifiedFlags };
};

async function checkScenario(scenario: Scenario): Promise<void> {
  const { bytes, chunkBytes, verifiedFlags } = scenario;
  const hasher = makeFakeHasher();

  // ── Sub-check A: firstUnverifiedIndex is the min unverified index / -1 ────
  {
    const noopUploader: ChunkUploader = {
      async uploadChunk(chunk: UploadChunk): Promise<ChunkUploadResult> {
        return { serverChecksum: chunk.sha256 };
      },
    };
    const controller = createChunkUpload(bytes, {
      uploader: noopUploader,
      hasher,
      config: configForChunkBytes(chunkBytes),
    });
    const chunks = controller.session.chunks;
    // Apply the random verified flags (guard against length differences).
    let expected = -1;
    for (let i = 0; i < chunks.length; i += 1) {
      const v = verifiedFlags[i] ?? false;
      chunks[i]!.verified = v;
    }
    for (let i = 0; i < chunks.length; i += 1) {
      if (!chunks[i]!.verified) {
        expected = chunks[i]!.index;
        break;
      }
    }
    assert(
      firstUnverifiedIndex(controller.session) === expected,
      `firstUnverifiedIndex ${firstUnverifiedIndex(controller.session)} !== expected ${expected}`,
    );
  }

  // ── Sub-check B: pause creates a verified prefix; resume starts at k+1 ────
  {
    const control: PauseControl = { pauseAtIndex: 0, pause: () => {}, triggered: false };
    const { uploader, received } = makeFakeUploader(control);
    const controller = createChunkUpload(bytes, {
      uploader,
      hasher,
      config: configForChunkBytes(chunkBytes),
    });
    const chunkCount = controller.session.chunks.length;
    control.pause = () => controller.pause();

    if (chunkCount < 2) {
      // Not enough chunks to pause between; a single run completes and a
      // subsequent resume must re-upload nothing (all verified).
      const done = await controller.start();
      assert(done.status === "complete", `single-chunk start expected complete, got ${done.status}`);
      received.length = 0;
      const again = await controller.resume();
      assert(again.status === "complete", `resume expected complete, got ${again.status}`);
      assert(received.length === 0, `resume re-uploaded ${received.length} verified chunk(s)`);
      return;
    }

    // Pause after verifying some chunk k in [0, chunkCount - 2] so a genuine
    // unverified suffix remains.
    const k = firstUnverifiedIndexSeed(scenario, chunkCount);
    control.pauseAtIndex = k;

    const paused = await controller.start();
    assert(paused.status === "paused", `expected paused, got ${paused.status}`);

    // Verified prefix is exactly 0..k.
    for (const chunk of controller.session.chunks) {
      if (chunk.index <= k) {
        assert(chunk.verified, `chunk ${chunk.index} in prefix should be verified`);
      } else {
        assert(!chunk.verified, `chunk ${chunk.index} in suffix should be unverified`);
      }
    }
    assert(
      firstUnverifiedIndex(controller.session) === k + 1,
      `firstUnverifiedIndex ${firstUnverifiedIndex(controller.session)} !== ${k + 1}`,
    );

    // Record only what the transport receives on resume.
    received.length = 0;
    const resumed = await controller.resume();

    assert(resumed.status === "complete", `resume expected complete, got ${resumed.status}`);
    // Resume must have re-uploaded ONLY the unverified suffix, in order.
    const expectedSuffix: number[] = [];
    for (let i = k + 1; i < chunkCount; i += 1) expectedSuffix.push(i);
    assert(
      received.length === expectedSuffix.length,
      `resume sent ${received.length} chunks, expected ${expectedSuffix.length}`,
    );
    for (let i = 0; i < expectedSuffix.length; i += 1) {
      assert(
        received[i] === expectedSuffix[i],
        `resume order mismatch at ${i}: ${received[i]} !== ${expectedSuffix[i]}`,
      );
    }
    for (const index of received) {
      assert(index > k, `resume re-uploaded verified-prefix chunk ${index}`);
    }
    // Everything is verified once resume completes.
    for (const chunk of controller.session.chunks) {
      assert(chunk.verified, `chunk ${chunk.index} should be verified after resume`);
    }
  }
}

/** Deterministically choose a pause index in [0, chunkCount - 2]. */
function firstUnverifiedIndexSeed(scenario: Scenario, chunkCount: number): number {
  // Reuse the generated verified flags as a cheap deterministic source.
  const seed = scenario.verifiedFlags.reduce((acc, v, i) => acc + (v ? i + 1 : 0), 0);
  return seed % (chunkCount - 1); // in [0, chunkCount - 2]
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
      console.error("FAIL  Property 33: resume from first unverified chunk");
      // eslint-disable-next-line no-console
      console.error(
        `Property 33 failed on iteration ${i}\n` +
          `  seed:           ${baseSeed}\n` +
          `  iteration:      ${i}\n` +
          `  counterexample: ${JSON.stringify({
            fileLen: scenario.bytes.length,
            chunkBytes: scenario.chunkBytes,
            chunkCount: scenario.chunkCount,
            verifiedFlags: scenario.verifiedFlags,
          })}\n` +
          `  detail:         ${detail}`,
      );
      if (proc) proc.exit(1);
      throw error;
    }
  }
  // eslint-disable-next-line no-console
  console.log(`PASS  Property 33: resume starts at the first unverified chunk [${ITERATIONS} cases]`);
  // eslint-disable-next-line no-console
  console.log("\nProperty 33 passed.");
  if (proc) proc.exit(0);
}

void main();
