/**
 * Property 31: Chunk verification is a sound integrity round-trip.
 *
 * Validates: Requirements 33.2, 33.3
 *
 * For any chunk produced by `partitionFile`:
 *   - `recomputeChecksum(chunk, hasher)` equals the stored `chunk.sha256`
 *     (the stored SHA256 is the SHA256 of the bytes, Req 33.2);
 *   - `isChecksumVerified(chunk, serverChecksum)` is true if and only if
 *     `serverChecksum === chunk.sha256` (Req 33.3);
 *   - any single-byte mutation of a chunk's bytes changes the recomputed
 *     checksum, so verification against the original checksum fails.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/upload/chunkUpload.verification.property.test.ts \
 *   && node .tmp-pbt/upload/chunkUpload.verification.property.test.js
 *
 * Uses the seeded PRNG harness (no fast-check, no network). Exits 0 on success
 * and non-zero (printing seed + counterexample) on the first failure.
 */

import {
  Hasher,
  UploadChunk,
  isChecksumVerified,
  partitionFile,
  recomputeChecksum,
} from "./chunkUpload";
import { Generator, forAll, integer } from "../testing/propertyHarness";

const ITERATIONS = 300;

/**
 * A pure, collision-free "hash": a length-prefixed hex encoding of the bytes.
 * Because the encoding is injective, identical bytes map to the identical
 * string and any single-byte change maps to a different string — exactly the
 * integrity guarantee the property exercises.
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

interface Scenario {
  bytes: Uint8Array;
  chunkSize: number;
  /** Index of the byte to mutate within a chosen chunk. */
  mutateByteAt: number;
  /** Non-zero delta applied to the mutated byte (mod 256). */
  mutateDelta: number;
  /** A fabricated server checksum that differs from every real one. */
  bogusChecksum: string;
}

function makeBytes(len: number, rng: Parameters<Generator<number>>[0]): Uint8Array {
  const arr = new Uint8Array(len);
  const byte = integer(0, 255);
  for (let i = 0; i < len; i += 1) arr[i] = byte(rng);
  return arr;
}

const scenarioGen: Generator<Scenario> = (rng) => {
  // Ensure at least one byte so there is something to mutate.
  const len = integer(1, 400)(rng);
  const bytes = makeBytes(len, rng);
  const chunkSize = integer(1, 64)(rng);
  return {
    bytes,
    chunkSize,
    mutateByteAt: integer(0, len - 1)(rng),
    mutateDelta: integer(1, 255)(rng),
    bogusChecksum: `bogus-${integer(0, 1_000_000)(rng)}`,
  };
};

function checkVerification(scenario: Scenario): void {
  const { bytes, chunkSize, mutateByteAt, mutateDelta, bogusChecksum } = scenario;
  const hasher = makeFakeHasher();
  const chunks: UploadChunk[] = partitionFile(bytes, chunkSize, hasher);

  assert(chunks.length > 0, "non-empty file produced zero chunks");

  for (const chunk of chunks) {
    // Req 33.2 — stored SHA256 equals the SHA256 of the bytes.
    assert(
      recomputeChecksum(chunk, hasher) === chunk.sha256,
      `recomputeChecksum !== stored sha256 for chunk ${chunk.index}`,
    );

    // Req 33.3 — verified iff serverChecksum === chunk.sha256.
    assert(
      isChecksumVerified(chunk, chunk.sha256) === true,
      `matching checksum should verify (chunk ${chunk.index})`,
    );
    assert(
      isChecksumVerified(chunk, bogusChecksum) === false,
      `bogus checksum must not verify (chunk ${chunk.index})`,
    );
    // The bogus checksum must genuinely differ from the real one.
    assert(bogusChecksum !== chunk.sha256, "bogus checksum accidentally equals real checksum");
  }

  // Single-byte mutation: locate the chunk owning the mutated global byte,
  // build a mutated copy, and confirm its checksum changes and no longer
  // verifies against the original checksum.
  const owning = chunks.find(
    (c) => mutateByteAt >= c.offset && mutateByteAt < c.offset + c.size,
  );
  assert(owning !== undefined, `no chunk owns byte index ${mutateByteAt}`);
  const chunk = owning!;

  const mutatedBytes = Uint8Array.from(chunk.bytes);
  const localIndex = mutateByteAt - chunk.offset;
  const original = mutatedBytes[localIndex]!;
  mutatedBytes[localIndex] = (original + mutateDelta) % 256;
  assert(mutatedBytes[localIndex] !== original, "mutation did not change the byte");

  const mutatedChunk: UploadChunk = { ...chunk, bytes: mutatedBytes };
  const mutatedChecksum = recomputeChecksum(mutatedChunk, hasher);

  // The mutation must change the checksum ...
  assert(
    mutatedChecksum !== chunk.sha256,
    `mutation did not change checksum (chunk ${chunk.index})`,
  );
  // ... so verification against the ORIGINAL stored checksum fails.
  assert(
    isChecksumVerified(chunk, mutatedChecksum) === false,
    `mutated bytes must fail verification (chunk ${chunk.index})`,
  );
}

function main(): void {
  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  try {
    forAll(scenarioGen, checkVerification, { iterations: ITERATIONS });
    // eslint-disable-next-line no-console
    console.log(
      `PASS  Property 31: chunk verification is a sound integrity round-trip [${ITERATIONS} cases]`,
    );
    // eslint-disable-next-line no-console
    console.log("\nProperty 31 passed.");
    if (proc) proc.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("FAIL  Property 31: chunk verification integrity");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    if (proc) proc.exit(1);
    throw error;
  }
}

main();
