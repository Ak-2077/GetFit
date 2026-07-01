/**
 * Property 30: Chunking is an order-preserving exact partition.
 *
 * Validates: Requirements 33.1
 *
 * For any file size and configured chunk size, `partitionFile` produces ordered
 * chunks such that:
 *   - concatenating the chunk byte views reconstructs the original bytes exactly;
 *   - chunks are contiguous: offset[i] + size[i] === offset[i+1];
 *   - indices are 0..n-1 in ascending order;
 *   - every chunk except possibly the last equals the configured chunk size;
 *   - the last chunk size lies in (0, configuredSize];
 *   - the chunk sizes sum to the original file length.
 *
 * File sizes cover empty, exact multiples of the chunk size, and non-multiples;
 * chunk sizes vary across the range.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/upload/chunkUpload.partition.property.test.ts \
 *   && node .tmp-pbt/upload/chunkUpload.partition.property.test.js
 *
 * Uses the seeded PRNG harness (no fast-check, no network). Exits 0 when every
 * case passes and non-zero (printing seed + counterexample) on the first
 * failure.
 */

import { Hasher, UploadChunk, partitionFile } from "./chunkUpload";
import { Generator, forAll, integer } from "../testing/propertyHarness";

const ITERATIONS = 300;

/**
 * A pure, collision-free "hash": a length-prefixed hex encoding of the bytes.
 * Identical bytes always produce the identical string; any difference (a
 * changed byte or a changed length) always produces a different string. This is
 * a deterministic pure function of the bytes, which is all the partition
 * property requires.
 */
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

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** One partition scenario: a byte array plus the chunk size (in bytes). */
interface Scenario {
  bytes: Uint8Array;
  chunkSize: number;
}

/** Fill a fresh Uint8Array of `len` bytes with generator-drawn values. */
function makeBytes(len: number, rng: Parameters<Generator<number>>[0]): Uint8Array {
  const arr = new Uint8Array(len);
  const byte = integer(0, 255);
  for (let i = 0; i < len; i += 1) arr[i] = byte(rng);
  return arr;
}

/**
 * Generate scenarios that deliberately cover the three interesting size
 * classes relative to the chunk size:
 *   - empty file (0 bytes → 0 chunks);
 *   - an exact multiple of the chunk size (uniform chunks, no short tail);
 *   - a non-multiple (a short final chunk).
 */
const scenarioGen: Generator<Scenario> = (rng) => {
  const chunkSize = integer(1, 64)(rng);
  const shapeKind = integer(0, 3)(rng);

  let len: number;
  if (shapeKind === 0) {
    len = 0; // empty file
  } else if (shapeKind === 1) {
    // exact multiple of the chunk size (including possibly zero handled above)
    const multiples = integer(1, 8)(rng);
    len = chunkSize * multiples;
  } else if (shapeKind === 2) {
    // non-multiple: guaranteed short final chunk when chunkSize > 1
    const base = chunkSize * integer(0, 6)(rng);
    const remainder = chunkSize > 1 ? integer(1, chunkSize - 1)(rng) : 1;
    len = base + remainder;
  } else {
    // arbitrary size
    len = integer(0, 400)(rng);
  }

  return { bytes: makeBytes(len, rng), chunkSize };
};

function checkPartition({ bytes, chunkSize }: Scenario): void {
  const hasher = makeFakeHasher();
  const chunks: UploadChunk[] = partitionFile(bytes, chunkSize, hasher);

  // Empty file → zero chunks (vacuous partition).
  if (bytes.length === 0) {
    assert(chunks.length === 0, `empty file produced ${chunks.length} chunks`);
    return;
  }

  assert(chunks.length > 0, "non-empty file produced zero chunks");

  // Indices are 0..n-1 in ascending order.
  for (let i = 0; i < chunks.length; i += 1) {
    assert(chunks[i]!.index === i, `chunk[${i}].index === ${chunks[i]!.index}`);
  }

  // Contiguity: first offset is 0; offset[i] + size[i] === offset[i+1].
  assert(chunks[0]!.offset === 0, `first chunk offset ${chunks[0]!.offset} !== 0`);
  for (let i = 0; i < chunks.length - 1; i += 1) {
    assert(
      chunks[i]!.offset + chunks[i]!.size === chunks[i + 1]!.offset,
      `non-contiguous at ${i}: ${chunks[i]!.offset}+${chunks[i]!.size} !== ${chunks[i + 1]!.offset}`,
    );
  }

  // Every chunk except possibly the last equals the configured chunk size.
  for (let i = 0; i < chunks.length - 1; i += 1) {
    assert(
      chunks[i]!.size === chunkSize,
      `chunk[${i}].size ${chunks[i]!.size} !== configured ${chunkSize}`,
    );
  }

  // Last chunk size is in (0, chunkSize].
  const last = chunks[chunks.length - 1]!;
  assert(last.size > 0, `last chunk size ${last.size} not > 0`);
  assert(last.size <= chunkSize, `last chunk size ${last.size} > configured ${chunkSize}`);

  // Sizes sum to the file length.
  const totalSize = chunks.reduce((sum, c) => sum + c.size, 0);
  assert(totalSize === bytes.length, `sizes sum ${totalSize} !== length ${bytes.length}`);

  // Concatenation of the chunk byte views reconstructs the original exactly.
  const reconstructed = new Uint8Array(bytes.length);
  for (const c of chunks) reconstructed.set(c.bytes, c.offset);
  for (let i = 0; i < bytes.length; i += 1) {
    assert(
      reconstructed[i] === bytes[i],
      `byte ${i} mismatch: ${reconstructed[i]} !== ${bytes[i]}`,
    );
  }

  // The final-chunk size relationship holds against the file length.
  const expectedChunks = Math.ceil(bytes.length / chunkSize);
  assert(
    chunks.length === expectedChunks,
    `chunk count ${chunks.length} !== ceil(${bytes.length}/${chunkSize})=${expectedChunks}`,
  );
}

function main(): void {
  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  try {
    forAll(scenarioGen, checkPartition, { iterations: ITERATIONS });
    // eslint-disable-next-line no-console
    console.log(
      `PASS  Property 30: chunking is an order-preserving exact partition [${ITERATIONS} cases]`,
    );
    // eslint-disable-next-line no-console
    console.log("\nProperty 30 passed.");
    if (proc) proc.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("FAIL  Property 30: chunk partitioning");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    if (proc) proc.exit(1);
    throw error;
  }
}

main();
