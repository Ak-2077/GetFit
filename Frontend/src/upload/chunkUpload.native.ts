/**
 * Thin, ISOLATED real adapters for the Chunk_Upload_Service.
 *
 * This is the ONLY place that touches native modules (`expo-crypto`,
 * `expo-file-system`) and the network transport. It is intentionally kept out
 * of the pure `chunkUpload.ts` logic module so that unit/property tests never
 * import native code (mirrors `videoCompression.native.ts`).
 *
 * Native modules are loaded lazily via `require` inside functions, so merely
 * importing type declarations from this file does not pull in native code. The
 * pure decision logic (partitioning, checksum verification, bounded retry,
 * resume, pause/cancel, progress, completion) lives entirely in
 * `chunkUpload.ts` and is exercised by tests with fakes.
 *
 * Requirements: 33.1–33.10 (adapter wiring only).
 */

import type {
  ChunkStore,
  ChunkUploader,
  ChunkUploadResult,
  Hasher,
  UploadChunk,
} from "./chunkUpload";

/**
 * Real SHA256 {@link Hasher} backed by `expo-crypto`. The pure logic depends
 * only on the injected `Hasher` interface; this adapter supplies the platform
 * implementation. `expo-crypto`'s digest APIs are async, so a synchronous
 * digest function is injected here (e.g. a native module or a JS fallback);
 * this keeps the pure `Hasher.sha256(bytes) => string` contract intact.
 */
export function createExpoHasher(
  digestHex: (bytes: Uint8Array) => string
): Hasher {
  return {
    sha256(bytes: Uint8Array): string {
      return digestHex(bytes);
    },
  };
}

/**
 * Real chunk {@link ChunkUploader}. The concrete network POST is injected as
 * `postChunk` so this adapter stays decoupled from any specific HTTP client;
 * the caller supplies the transport (e.g. `fetch` against the backend
 * chunk receiver). The receiver recomputes the SHA256 and returns it as
 * `serverChecksum`, which the pure logic compares to the original (Req 33.3).
 *
 * On any transport failure this rejects, which the pure retry logic treats as
 * a failed attempt and retries up to the configured budget (Req 33.4).
 */
export function createHttpChunkUploader(
  postChunk: (chunk: UploadChunk) => Promise<ChunkUploadResult>
): ChunkUploader {
  return {
    uploadChunk(chunk: UploadChunk): Promise<ChunkUploadResult> {
      return postChunk(chunk);
    },
  };
}

/**
 * {@link ChunkStore} backed by `expo-file-system`. Retains uploaded chunks
 * under a per-session directory and, on cancel, removes that directory to
 * release the associated upload storage (Req 33.8).
 */
export function createExpoChunkStore(baseDir: string): ChunkStore {
  function sessionDir(sessionId: string): string {
    const sep = baseDir.endsWith("/") ? "" : "/";
    return `${baseDir}${sep}${sessionId}`;
  }

  return {
    async save(sessionId: string, chunk: UploadChunk): Promise<void> {
      // Lazy require keeps native code out of the test import graph.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const FileSystem = require("expo-file-system") as {
        makeDirectoryAsync?: (
          uri: string,
          options?: { intermediates?: boolean }
        ) => Promise<void>;
        writeAsStringAsync?: (uri: string, contents: string) => Promise<void>;
      };
      const dir = sessionDir(sessionId);
      if (typeof FileSystem.makeDirectoryAsync === "function") {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }
      if (typeof FileSystem.writeAsStringAsync === "function") {
        // Persist the chunk's checksum as a lightweight resume marker; the
        // chunk bytes themselves live in the platform's temporary upload area.
        await FileSystem.writeAsStringAsync(`${dir}/${chunk.index}.sha256`, chunk.sha256);
      }
    },
    async discardAll(sessionId: string): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const FileSystem = require("expo-file-system") as {
        deleteAsync?: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
      };
      if (typeof FileSystem.deleteAsync === "function") {
        await FileSystem.deleteAsync(sessionDir(sessionId), { idempotent: true });
      }
    },
  };
}
