/**
 * Chunk_Upload_Service (Stage 32, Req 33) — resumable, integrity-checked
 * chunked upload that runs after on-device compression.
 *
 * PURE-LOGIC MODULE: this file contains NO top-level `react-native` / `expo-*`
 * imports. Every external dependency (byte transport, SHA256 hashing, the wall
 * clock for the 24h resume window, and chunk storage) is abstracted behind an
 * injected interface, so all decisions — partitioning, checksum verification,
 * bounded retry, resume-from-first-unverified, pause/resume/cancel, progress,
 * and completion — are fully unit/property testable with fakes in plain Node.
 *
 * A thin real adapter that wires `expo-crypto` / `expo-file-system` lives in
 * `chunkUpload.native.ts` and is never imported by tests (mirrors
 * `videoCompression.native.ts`).
 *
 * Design: .kiro/specs/ai-exercise-analysis/design.md (Chunk_Upload_Service,
 * Properties 30–35).
 * Requirements: 33.1–33.10.
 */

import {
  ChunkUploadConfig,
  chunkSizeBytes,
  resolveChunkUploadConfig,
  resumeWindowMs,
} from "../config/chunkUploadConfig";
import {
  StructuredError,
  makeStructuredError,
} from "../types/structuredError";

/** Name reported as the originating stage on any StructuredError. */
export const CHUNK_UPLOAD_STAGE = "chunk_upload";

/** Error code returned when a chunk exhausts its retry budget (Req 33.5). */
export const CHUNK_UPLOAD_FAILED = "CHUNK_UPLOAD_FAILED";

/** Error code returned when the resume window has expired (Req 33.7). */
export const UPLOAD_SESSION_EXPIRED = "UPLOAD_SESSION_EXPIRED";

// ─────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────

/**
 * A contiguous, individually addressable segment of a video upload
 * (`Upload_Chunk`, Req 33.1). Identified by an ordered {@link index} and a
 * SHA256 {@link sha256} computed over its {@link bytes} at partition time.
 */
export interface UploadChunk {
  /** Zero-based ordered position of this chunk within the file. */
  index: number;
  /** Byte offset of this chunk from the start of the file. */
  offset: number;
  /** Size of this chunk in bytes (final chunk may be smaller). */
  size: number;
  /** The chunk payload. */
  bytes: Uint8Array;
  /** SHA256 checksum computed over {@link bytes} at partition time (Req 33.2). */
  sha256: string;
  /** True once the recomputed checksum matched the original (Req 33.3). */
  verified: boolean;
}

/** Lifecycle status of an upload session. */
export type UploadStatus =
  | "idle"
  | "uploading"
  | "paused"
  | "complete"
  | "failed"
  | "cancelled"
  | "expired";

/**
 * State for a single chunked upload (`Upload_Session`). Holds the ordered
 * chunks, timing for the 24h resume window, and the current lifecycle status.
 */
export interface UploadSession {
  /** Opaque session identifier used to scope stored chunks. */
  id: string;
  /** Ordered chunks; concatenation reconstructs the original file (Req 33.1). */
  chunks: UploadChunk[];
  /** Wall-clock time (ms) at which the session was created. */
  createdAt: number;
  /** Wall-clock time (ms) after which the session may no longer resume. */
  expiresAt: number;
  /** Current lifecycle status. */
  status: UploadStatus;
}

/** Progress snapshot reported to the caller (Req 33.9, 33.10). */
export interface UploadProgress {
  /** Number of verified chunks. */
  verified: number;
  /** Total chunk count. */
  total: number;
  /** Verified fraction in [0, 1] (verified / total). */
  fraction: number;
  /** True iff every chunk is verified (fraction === 1). */
  complete: boolean;
}

/** Discriminated outcome of running (or resuming) an upload. */
export type UploadOutcome =
  | { status: "complete"; session: UploadSession; progress: UploadProgress }
  | { status: "paused"; session: UploadSession; progress: UploadProgress }
  | { status: "cancelled"; session: UploadSession; progress: UploadProgress }
  | {
      status: "failed";
      session: UploadSession;
      progress: UploadProgress;
      /** Index of the chunk that exhausted its retry budget (Req 33.5). */
      failedChunkIndex: number;
      error: StructuredError;
    }
  | {
      status: "expired";
      session: UploadSession;
      progress: UploadProgress;
      error: StructuredError;
    };

// ─────────────────────────────────────────────────────────────────────────
// Injected dependencies
// ─────────────────────────────────────────────────────────────────────────

/** Result the transport returns after receiving a chunk. */
export interface ChunkUploadResult {
  /** SHA256 the receiver recomputed over the bytes it actually received. */
  serverChecksum: string;
}

/**
 * Byte transport for a single chunk. Implementations may reject (transfer
 * failure) or resolve with the server-recomputed checksum (Req 33.3). Faked in
 * tests to fail/succeed deterministically so retry logic is verifiable.
 */
export interface ChunkUploader {
  uploadChunk(chunk: UploadChunk): Promise<ChunkUploadResult>;
}

/** SHA256 hasher over raw bytes, injected so no native crypto is imported. */
export interface Hasher {
  sha256(bytes: Uint8Array): string;
}

/** Monotonic wall clock in milliseconds (for the 24h window, Req 33.6/33.7). */
export interface Clock {
  now(): number;
}

/**
 * Storage for uploaded chunk state. Injected so the "cancel discards all
 * chunks and releases storage" guarantee (Req 33.8) is testable without
 * touching the device file system / backend.
 */
export interface ChunkStore {
  /** Retain a verified chunk (so it is not re-uploaded on resume). */
  save(sessionId: string, chunk: UploadChunk): Promise<void>;
  /** Discard every stored chunk for a session and release its storage. */
  discardAll(sessionId: string): Promise<void>;
}

/** Injected dependencies for the Chunk_Upload_Service. */
export interface ChunkUploadDeps {
  uploader: ChunkUploader;
  hasher: Hasher;
  /** Optional store; when absent, chunk retention/release is a no-op. */
  store?: ChunkStore;
  /** Wall clock; defaults to `Date.now`. */
  clock?: Clock;
  /** Optional configuration overrides; defaults mirror config_v2.py. */
  config?: Partial<ChunkUploadConfig>;
  /** Optional id generator for the session; defaults to a timestamp-based id. */
  generateId?: () => string;
}

// ─────────────────────────────────────────────────────────────────────────
// Pure partitioning + checksum helpers (Properties 30, 31)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Partition `bytes` into ordered chunks of `size` bytes each, where the final
 * chunk may be smaller (Req 33.1, Property 30). Chunks carry their computed
 * SHA256 checksum (Req 33.2) and start unverified.
 *
 * Concatenating the produced chunk byte views reconstructs `bytes` exactly.
 */
export function partitionFile(
  bytes: Uint8Array,
  chunkSizeInBytes: number,
  hasher: Hasher
): UploadChunk[] {
  const size = Math.max(1, Math.floor(chunkSizeInBytes));
  const chunks: UploadChunk[] = [];
  let index = 0;
  for (let offset = 0; offset < bytes.length; offset += size) {
    const end = Math.min(offset + size, bytes.length);
    const slice = bytes.subarray(offset, end);
    chunks.push({
      index,
      offset,
      size: slice.length,
      bytes: slice,
      sha256: hasher.sha256(slice),
      verified: false,
    });
    index += 1;
  }
  return chunks;
}

/**
 * Verify a received chunk: it is marked verified if and only if the
 * server-recomputed checksum equals the originally computed checksum
 * (Req 33.3, Property 31). Any mutation of the bytes in transit yields a
 * different `serverChecksum` and therefore fails verification.
 */
export function isChecksumVerified(
  chunk: UploadChunk,
  serverChecksum: string
): boolean {
  return serverChecksum === chunk.sha256;
}

/**
 * Recompute a chunk's checksum from its current bytes. Used to assert the
 * stored SHA256 equals the SHA256 of the bytes and that any single-byte
 * mutation breaks the equality (Property 31).
 */
export function recomputeChecksum(chunk: UploadChunk, hasher: Hasher): string {
  return hasher.sha256(chunk.bytes);
}

// ─────────────────────────────────────────────────────────────────────────
// Progress / completion (Property 34) and resume position (Property 33)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute progress as the verified fraction over the total chunk count
 * (Req 33.9). Completion is exact: `complete` is true iff every chunk is
 * verified, i.e. `fraction === 1` (Req 33.10, Property 34). An empty file
 * (zero chunks) is treated as vacuously complete with fraction 1.
 */
export function computeProgress(session: UploadSession): UploadProgress {
  const total = session.chunks.length;
  const verified = session.chunks.reduce(
    (count, chunk) => (chunk.verified ? count + 1 : count),
    0
  );
  const fraction = total === 0 ? 1 : verified / total;
  return { verified, total, fraction, complete: verified === total };
}

/** True iff every chunk in the session is verified (Req 33.10). */
export function isComplete(session: UploadSession): boolean {
  return session.chunks.every((chunk) => chunk.verified);
}

/**
 * Index of the first unverified chunk — the minimum index among unverified
 * chunks (Req 33.6, Property 33). Returns `-1` when all chunks are verified.
 */
export function firstUnverifiedIndex(session: UploadSession): number {
  for (const chunk of session.chunks) {
    if (!chunk.verified) return chunk.index;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────────────────
// Session creation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a fresh {@link UploadSession} for `bytes`: partition into chunks,
 * compute per-chunk checksums, and stamp the 24h resume window (Req 33.1,
 * 33.2, 33.6).
 */
export function createSession(
  bytes: Uint8Array,
  deps: ChunkUploadDeps
): UploadSession {
  const config = resolveChunkUploadConfig(deps.config);
  const clock = deps.clock ?? { now: () => Date.now() };
  const generateId = deps.generateId ?? (() => `upload-${clock.now()}`);

  const createdAt = clock.now();
  const chunks = partitionFile(bytes, chunkSizeBytes(config), deps.hasher);

  return {
    id: generateId(),
    chunks,
    createdAt,
    expiresAt: createdAt + resumeWindowMs(config),
    status: "idle",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Bounded retry for a single chunk (Property 32)
// ─────────────────────────────────────────────────────────────────────────

/** Outcome of attempting to upload+verify a single chunk. */
export interface ChunkAttemptResult {
  /** True if the chunk was verified within the retry budget. */
  verified: boolean;
  /** Number of retries used (0 == succeeded on the first attempt). */
  retries: number;
  /** Last server checksum observed (undefined if every attempt threw). */
  lastServerChecksum?: string;
}

/**
 * Upload a single chunk, retrying up to `maxRetries` times on transfer failure
 * or checksum mismatch (Req 33.4, Property 32). Total attempts are
 * `maxRetries + 1` (one initial try plus up to `maxRetries` retries). Stops as
 * soon as the chunk verifies.
 */
export async function uploadChunkWithRetry(
  chunk: UploadChunk,
  uploader: ChunkUploader,
  maxRetries: number
): Promise<ChunkAttemptResult> {
  const budget = Math.max(0, Math.floor(maxRetries));
  let lastServerChecksum: string | undefined;

  for (let attempt = 0; attempt <= budget; attempt += 1) {
    try {
      const { serverChecksum } = await uploader.uploadChunk(chunk);
      lastServerChecksum = serverChecksum;
      if (isChecksumVerified(chunk, serverChecksum)) {
        return { verified: true, retries: attempt, lastServerChecksum };
      }
    } catch {
      // transfer failure — falls through to the next attempt (Req 33.4)
    }
  }

  return { verified: false, retries: budget, lastServerChecksum };
}

// ─────────────────────────────────────────────────────────────────────────
// Upload engine: order-preserving, resume-aware, retry-bounded (Req 33.4–33.10)
// ─────────────────────────────────────────────────────────────────────────

/** Internal control flags observed by the engine between chunks. */
interface RunControl {
  /** Set by pause(): the engine stops cleanly after the current chunk. */
  paused: () => boolean;
  /** Set by cancel(): the engine stops and the caller discards storage. */
  cancelled: () => boolean;
}

/** Build a `CHUNK_UPLOAD_FAILED` StructuredError identifying the failed chunk. */
function chunkFailure(index: number): StructuredError {
  return makeStructuredError(
    CHUNK_UPLOAD_FAILED,
    `chunk ${index} failed verification after exhausting its retry budget`,
    CHUNK_UPLOAD_STAGE
  );
}

/** Build an `UPLOAD_SESSION_EXPIRED` StructuredError. */
function sessionExpired(): StructuredError {
  return makeStructuredError(
    UPLOAD_SESSION_EXPIRED,
    "upload session expired; the upload must begin anew",
    CHUNK_UPLOAD_STAGE
  );
}

/**
 * Drive the upload for `session` starting from the first unverified chunk
 * (Req 33.6, Property 33). Verified chunks are never re-uploaded (Req 33.4).
 * Halts and identifies the failed chunk when a chunk's retry budget is
 * exhausted (Req 33.5). Honours pause/cancel control between chunks.
 *
 * This function mutates `session.chunks[*].verified` and `session.status`.
 */
async function runUpload(
  session: UploadSession,
  deps: ChunkUploadDeps,
  control: RunControl
): Promise<UploadOutcome> {
  const config = resolveChunkUploadConfig(deps.config);
  const clock = deps.clock ?? { now: () => Date.now() };

  // Resume-window guard (Req 33.7): an expired session cannot proceed.
  if (clock.now() > session.expiresAt) {
    session.status = "expired";
    return {
      status: "expired",
      session,
      progress: computeProgress(session),
      error: sessionExpired(),
    };
  }

  session.status = "uploading";

  for (const chunk of session.chunks) {
    if (chunk.verified) continue; // never re-upload verified chunks (Req 33.4)

    if (control.cancelled()) {
      session.status = "cancelled";
      return { status: "cancelled", session, progress: computeProgress(session) };
    }
    if (control.paused()) {
      session.status = "paused";
      return { status: "paused", session, progress: computeProgress(session) };
    }

    const attempt = await uploadChunkWithRetry(chunk, deps.uploader, config.maxRetries);
    if (!attempt.verified) {
      // Retry budget exhausted: halt, retain verified chunks, identify failure.
      session.status = "failed";
      return {
        status: "failed",
        session,
        progress: computeProgress(session),
        failedChunkIndex: chunk.index,
        error: chunkFailure(chunk.index),
      };
    }

    chunk.verified = true;
    if (deps.store) await deps.store.save(session.id, chunk);
  }

  session.status = "complete";
  return { status: "complete", session, progress: computeProgress(session) };
}

// ─────────────────────────────────────────────────────────────────────────
// Controller: pause / resume / cancel (Req 33.8) with progress (Req 33.9)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Stateful controller for an in-progress chunked upload. Wraps a
 * {@link UploadSession} and exposes the lifecycle operations required by
 * Req 33.8 plus progress/completion reporting (Req 33.9, 33.10).
 *
 * Pause/cancel take effect between chunks: the running loop checks the flags
 * before each unverified chunk, so no verified progress is ever lost.
 */
export interface ChunkUploadController {
  /** The underlying session (chunk verification state, timing, status). */
  readonly session: UploadSession;
  /** Start (or restart) the upload from the first unverified chunk. */
  start(): Promise<UploadOutcome>;
  /** Resume after a pause/interruption from the first unverified chunk. */
  resume(): Promise<UploadOutcome>;
  /** Request a pause; the loop stops cleanly after the current chunk. */
  pause(): void;
  /**
   * Cancel the upload: stop, discard every uploaded chunk, and release the
   * associated upload storage, leaving the verified set empty (Req 33.8).
   */
  cancel(): Promise<UploadOutcome>;
  /** Current progress snapshot (Req 33.9). */
  getProgress(): UploadProgress;
  /** True iff every chunk is verified (Req 33.10). */
  isComplete(): boolean;
}

/**
 * Create a {@link ChunkUploadController} for `bytes`. Partitions the file,
 * computes checksums, and stamps the 24h resume window up front (Req 33.1,
 * 33.2, 33.6).
 */
export function createChunkUpload(
  bytes: Uint8Array,
  deps: ChunkUploadDeps
): ChunkUploadController {
  const session = createSession(bytes, deps);

  let pauseRequested = false;
  let cancelRequested = false;

  const control: RunControl = {
    paused: () => pauseRequested,
    cancelled: () => cancelRequested,
  };

  async function run(): Promise<UploadOutcome> {
    pauseRequested = false;
    const outcome = await runUpload(session, deps, control);
    return outcome;
  }

  return {
    session,
    start: run,
    resume: run,
    pause(): void {
      pauseRequested = true;
    },
    async cancel(): Promise<UploadOutcome> {
      cancelRequested = true;
      // Discard every stored chunk and release the upload storage (Req 33.8).
      if (deps.store) await deps.store.discardAll(session.id);
      for (const chunk of session.chunks) chunk.verified = false;
      session.status = "cancelled";
      return { status: "cancelled", session, progress: computeProgress(session) };
    },
    getProgress(): UploadProgress {
      return computeProgress(session);
    },
    isComplete(): boolean {
      return isComplete(session);
    },
  };
}
