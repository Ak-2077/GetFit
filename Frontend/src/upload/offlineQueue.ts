/**
 * Offline_Queue_Service (Stage 44, Req 45) — stores recordings locally when
 * network connectivity is unavailable and uploads them automatically, oldest
 * first, when connectivity is restored.
 *
 * PURE-LOGIC MODULE: this file contains NO top-level `react-native` / `expo-*`
 * imports. Every external dependency is abstracted behind an injected
 * interface so the entire state machine is unit/property testable in plain
 * Node with fakes:
 *   • {@link LocalStore}       — persists / removes recordings and reports
 *                                availability + capacity (so the "reject when
 *                                unavailable/full" path is testable, Req 45.7),
 *   • {@link Uploader}         — deterministically succeeds/fails (Req 45.6),
 *   • {@link Clock}            — wall clock for reconnect-detection and the
 *                                ≤2s state-change reflection timing,
 *   • {@link ConnectivitySignal} — online/offline signal injected (Req 45.2).
 *
 * A thin real adapter that wires AsyncStorage / expo-file-system + NetInfo
 * lives in `offlineQueue.native.ts` and is never imported by tests (mirrors
 * `chunkUpload.native.ts`).
 *
 * Design: .kiro/specs/ai-exercise-analysis/design.md (Offline_Queue_Service,
 * Properties 52–54).
 * Requirements: 45.1–45.7.
 */

import {
  OfflineQueueConfig,
  resolveOfflineQueueConfig,
  reconnectDetectMs,
  stateChangeMaxMs,
} from "../config/offlineQueueConfig";
import {
  StructuredError,
  makeStructuredError,
} from "../types/structuredError";

/** Name reported as the originating stage on any StructuredError. */
export const OFFLINE_QUEUE_STAGE = "offline_queue";

/** Error code when local storage is unavailable/full at submit (Req 45.7). */
export const STORAGE_UNAVAILABLE = "STORAGE_UNAVAILABLE";

/** Error code when an offline-queued upload exhausts its retries (Req 45.6). */
export const OFFLINE_UPLOAD_FAILED = "OFFLINE_UPLOAD_FAILED";

// ─────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────

/**
 * The lifecycle state of a locally queued recording (`Offline_Queue_State`,
 * Req 45.3). Exactly one of these is assigned to a recording at all times.
 */
export type OfflineQueueState =
  | "Queued"
  | "Uploading"
  | "Processing"
  | "Completed"
  | "Failed";

/** All valid `Offline_Queue_State` values, for exhaustive checks in tests. */
export const OFFLINE_QUEUE_STATES: readonly OfflineQueueState[] = [
  "Queued",
  "Uploading",
  "Processing",
  "Completed",
  "Failed",
] as const;

/**
 * A recording handed to the service for queueing. The `payload` is an opaque,
 * caller-defined reference (e.g. a local file URI) that the injected
 * {@link Uploader} knows how to transmit; the pure logic never inspects it.
 */
export interface RecordingInput {
  /** Stable unique identifier for the recording. */
  id: string;
  /** Submission timestamp (ms); used for oldest-first ordering (Req 45.2). */
  submittedAt: number;
  /** Opaque payload reference passed through to the uploader/store. */
  payload?: unknown;
}

/**
 * A recording tracked by the queue. Carries exactly one {@link OfflineQueueState}
 * at all times (Req 45.3) plus the retry count consumed so far (Req 45.6).
 */
export interface QueuedRecording {
  id: string;
  submittedAt: number;
  state: OfflineQueueState;
  /** Number of failed upload attempts consumed so far. */
  retries: number;
  payload?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────
// Injected dependencies
// ─────────────────────────────────────────────────────────────────────────

/** Why a {@link LocalStore} could not persist a recording (Req 45.7). */
export type StoreFailureReason = "unavailable" | "full";

/** Result of attempting to persist a recording to local storage. */
export type StorePutResult =
  | { ok: true }
  | { ok: false; reason: StoreFailureReason };

/**
 * Local persistent storage for queued recordings. Injected so the "reject when
 * unavailable/full" path (Req 45.7) and the "retain until Completed, remove
 * only after Completed" guarantee (Req 45.5) are testable without touching the
 * device file system.
 */
export interface LocalStore {
  /**
   * Persist a recording. Returns `{ ok: false, reason }` when storage is
   * unavailable or full — the service must then reject the submission WITHOUT
   * assigning the Queued state (Req 45.7).
   */
  put(recording: QueuedRecording): StorePutResult;
  /** Persist an updated state for an already-stored recording. */
  update(recording: QueuedRecording): void;
  /** Remove a recording from storage. Only ever called after Completed. */
  remove(id: string): void;
  /** List all currently stored recordings (order unspecified). */
  list(): QueuedRecording[];
}

/** Outcome of a single upload attempt. */
export type UploadAttemptResult = { ok: true } | { ok: false };

/**
 * Byte transport for a queued recording. Faked in tests to succeed/fail
 * deterministically so the bounded-retry logic (Req 45.6) is verifiable.
 * A rejected promise is treated exactly like `{ ok: false }`.
 */
export interface Uploader {
  upload(recording: QueuedRecording): Promise<UploadAttemptResult>;
}

/** Monotonic wall clock in milliseconds (reconnect + ≤2s reflection timing). */
export interface Clock {
  now(): number;
}

/** Injected connectivity signal (online/offline) for the queue (Req 45.2). */
export interface ConnectivitySignal {
  isOnline(): boolean;
}

/** A state transition, surfaced to the UI so it can reflect ≤2s (Req 45.4). */
export interface StateChangeEvent {
  id: string;
  previous: OfflineQueueState | null;
  next: OfflineQueueState;
  /** Wall-clock time (ms) at which the change occurred. */
  at: number;
}

/** Observer notified synchronously on every state change (Req 45.4). */
export type StateChangeListener = (event: StateChangeEvent) => void;

/** Injected dependencies for the Offline_Queue_Service. */
export interface OfflineQueueDeps {
  store: LocalStore;
  uploader: Uploader;
  connectivity: ConnectivitySignal;
  /** Wall clock; defaults to `Date.now`. */
  clock?: Clock;
  /** Optional configuration overrides; defaults mirror config_v2.py. */
  config?: Partial<OfflineQueueConfig>;
  /** Optional listener notified on every state change (Req 45.4). */
  onStateChange?: StateChangeListener;
}

// ─────────────────────────────────────────────────────────────────────────
// Pure state-machine helpers (Properties 52–54)
// ─────────────────────────────────────────────────────────────────────────

/** True iff `state` is one of the five valid `Offline_Queue_State` values. */
export function isOfflineQueueState(state: unknown): state is OfflineQueueState {
  return (
    typeof state === "string" &&
    (OFFLINE_QUEUE_STATES as readonly string[]).includes(state)
  );
}

/**
 * Allowed state transitions for the queue (Req 45.3). Encodes the lifecycle:
 *   Queued     → Uploading
 *   Uploading  → Processing | Completed | Failed
 *   Processing → Completed | Failed
 *   Failed     → Uploading            (a Failed recording may be retried)
 *   Completed  → (terminal; the recording is removed from storage)
 */
export function canTransition(
  from: OfflineQueueState,
  to: OfflineQueueState
): boolean {
  switch (from) {
    case "Queued":
      return to === "Uploading";
    case "Uploading":
      return to === "Processing" || to === "Completed" || to === "Failed";
    case "Processing":
      return to === "Completed" || to === "Failed";
    case "Failed":
      return to === "Uploading";
    case "Completed":
      return false;
    default:
      return false;
  }
}

/**
 * A recording is removed from local persistent storage only after its state
 * reaches Completed (Req 45.5, Property 52). Every other state retains it.
 */
export function shouldRemove(state: OfflineQueueState): boolean {
  return state === "Completed";
}

/** True iff `state` is terminal for retry purposes (Completed or Failed). */
export function isTerminal(state: OfflineQueueState): boolean {
  return state === "Completed" || state === "Failed";
}

/**
 * Order recordings oldest-first by ascending submission timestamp (Req 45.2,
 * Property 53). Ties break by `id` for a total, deterministic order. Pure:
 * returns a new array and does not mutate the input.
 */
export function sortOldestFirst<T extends { submittedAt: number; id: string }>(
  recordings: readonly T[]
): T[] {
  return [...recordings].sort((a, b) => {
    if (a.submittedAt !== b.submittedAt) return a.submittedAt - b.submittedAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * True iff restored connectivity was detected within the configured window
 * (≤30s, Req 45.2). `becameOnlineAt` and `detectedAt` are wall-clock ms.
 */
export function isReconnectDetectedInTime(
  becameOnlineAt: number,
  detectedAt: number,
  config: OfflineQueueConfig
): boolean {
  return detectedAt - becameOnlineAt <= reconnectDetectMs(config);
}

/**
 * True iff a state change was reflected to the End_User within the configured
 * window (≤2s, Req 45.4). `changedAt` and `reflectedAt` are wall-clock ms.
 */
export function isReflectedInTime(
  changedAt: number,
  reflectedAt: number,
  config: OfflineQueueConfig
): boolean {
  return reflectedAt - changedAt <= stateChangeMaxMs(config);
}

/** Build a `STORAGE_UNAVAILABLE` StructuredError for a rejected submit. */
function storageUnavailable(reason: StoreFailureReason): StructuredError {
  return makeStructuredError(
    STORAGE_UNAVAILABLE,
    `recording could not be queued: local storage is ${reason}`,
    OFFLINE_QUEUE_STAGE
  );
}

/** Build an `OFFLINE_UPLOAD_FAILED` StructuredError identifying the recording. */
function uploadFailed(id: string, attempts: number): StructuredError {
  return makeStructuredError(
    OFFLINE_UPLOAD_FAILED,
    `recording ${id} failed to upload after ${attempts} attempts and remains queued`,
    OFFLINE_QUEUE_STAGE
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Outcome types
// ─────────────────────────────────────────────────────────────────────────

/** Result of submitting a recording to the queue (Req 45.1, 45.7). */
export type SubmitOutcome =
  | { ok: true; recording: QueuedRecording }
  | { ok: false; error: StructuredError };

/** Per-recording result produced while draining the queue. */
export interface DrainEntry {
  id: string;
  finalState: OfflineQueueState;
  /** Number of upload attempts made for this recording during the drain. */
  attempts: number;
  /** Present iff the recording was marked Failed (Req 45.6). */
  error?: StructuredError;
}

/** Result of draining the queue on reconnect (Req 45.2, 45.6). */
export interface DrainOutcome {
  /** IDs in the exact order they were uploaded (oldest-first, Req 45.2). */
  order: string[];
  /** Per-recording drain results. */
  entries: DrainEntry[];
  /** True when the drain was skipped because connectivity is unavailable. */
  skipped: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// The Offline_Queue_Service
// ─────────────────────────────────────────────────────────────────────────

/**
 * Stateful Offline_Queue_Service. Holds an in-memory view mirroring
 * {@link LocalStore}, guarantees exactly one {@link OfflineQueueState} per
 * recording at all times (Req 45.3), retains recordings until Completed
 * (Req 45.5), uploads oldest-first on reconnect (Req 45.2), retries a failing
 * upload up to the configured budget then marks Failed (Req 45.6), and rejects
 * submissions when storage is unavailable/full (Req 45.7).
 */
export class OfflineQueueService {
  private readonly store: LocalStore;
  private readonly uploader: Uploader;
  private readonly connectivity: ConnectivitySignal;
  private readonly clock: Clock;
  private readonly config: OfflineQueueConfig;
  private readonly onStateChange?: StateChangeListener;

  /** In-memory mirror of persisted recordings, keyed by id. */
  private readonly entries = new Map<string, QueuedRecording>();

  constructor(deps: OfflineQueueDeps) {
    this.store = deps.store;
    this.uploader = deps.uploader;
    this.connectivity = deps.connectivity;
    this.clock = deps.clock ?? { now: () => Date.now() };
    this.config = resolveOfflineQueueConfig(deps.config);
    this.onStateChange = deps.onStateChange;

    // Rehydrate any previously persisted recordings (survives restarts).
    for (const rec of this.store.list()) {
      this.entries.set(rec.id, { ...rec });
    }
  }

  /** Snapshot of every tracked recording, oldest-first. */
  list(): QueuedRecording[] {
    return sortOldestFirst([...this.entries.values()]).map((r) => ({ ...r }));
  }

  /** The current recording for `id`, or `undefined` if not tracked. */
  get(id: string): QueuedRecording | undefined {
    const rec = this.entries.get(id);
    return rec ? { ...rec } : undefined;
  }

  /**
   * Submit a recording while offline (Req 45.1, 45.7).
   *
   * Attempts to persist to local storage first. Only if persistence succeeds
   * is the Queued state assigned (Req 45.1). If storage is unavailable/full,
   * the submission is rejected, NO Queued state is assigned, and a
   * `STORAGE_UNAVAILABLE` error is returned for display (Req 45.7).
   */
  submit(input: RecordingInput): SubmitOutcome {
    const candidate: QueuedRecording = {
      id: input.id,
      submittedAt: input.submittedAt,
      state: "Queued",
      retries: 0,
      payload: input.payload,
    };

    const result = this.store.put(candidate);
    if (!result.ok) {
      // Reject WITHOUT setting Queued or tracking the recording (Req 45.7).
      return { ok: false, error: storageUnavailable(result.reason) };
    }

    // Persisted successfully → now (and only now) assign Queued (Req 45.1).
    this.entries.set(candidate.id, candidate);
    this.emit(candidate.id, null, "Queued");
    return { ok: true, recording: { ...candidate } };
  }

  /**
   * Detect restored connectivity and, if online, drain the queue oldest-first.
   * Returns the reconnect-detection latency alongside the drain outcome so
   * callers/tests can assert the ≤30s bound (Req 45.2).
   */
  async onConnectivityRestored(
    becameOnlineAt: number
  ): Promise<{ detectedAt: number; detectedInTime: boolean; drain: DrainOutcome }> {
    const detectedAt = this.clock.now();
    const detectedInTime = isReconnectDetectedInTime(
      becameOnlineAt,
      detectedAt,
      this.config
    );
    const drain = await this.drain();
    return { detectedAt, detectedInTime, drain };
  }

  /**
   * Upload all pending recordings oldest-first (Req 45.2, Property 53). A
   * recording is pending when its state is Queued, Uploading (interrupted), or
   * Failed (eligible for another drain). No-ops (skipped) while offline.
   */
  async drain(): Promise<DrainOutcome> {
    if (!this.connectivity.isOnline()) {
      return { order: [], entries: [], skipped: true };
    }

    const pending = sortOldestFirst(
      [...this.entries.values()].filter(
        (r) => r.state === "Queued" || r.state === "Uploading" || r.state === "Failed"
      )
    );

    const order: string[] = [];
    const entries: DrainEntry[] = [];

    for (const rec of pending) {
      order.push(rec.id);
      const entry = await this.uploadOne(rec.id);
      entries.push(entry);
    }

    return { order, entries, skipped: false };
  }

  /**
   * Upload a single recording with bounded retry (Req 45.6). Attempts the
   * upload up to `maxUploadRetries` times; on the first success the recording
   * transitions to Completed and is removed from storage (Req 45.5). If every
   * attempt fails, the recording is set to Failed, retained in storage, and an
   * `OFFLINE_UPLOAD_FAILED` error identifying it is returned (Req 45.6).
   */
  private async uploadOne(id: string): Promise<DrainEntry> {
    const rec = this.entries.get(id);
    if (!rec) {
      return { id, finalState: "Failed", attempts: 0 };
    }

    this.setState(rec, "Uploading");

    const maxAttempts = Math.max(1, this.config.maxUploadRetries);
    let attempts = 0;

    for (let i = 0; i < maxAttempts; i += 1) {
      attempts += 1;
      let ok = false;
      try {
        const result = await this.uploader.upload({ ...rec });
        ok = result.ok;
      } catch {
        ok = false; // a rejected upload counts as a failed attempt (Req 45.6)
      }

      if (ok) {
        // Success → Completed, then (and only then) remove (Req 45.5).
        this.setState(rec, "Completed");
        this.store.remove(rec.id);
        this.entries.delete(rec.id);
        return { id, finalState: "Completed", attempts };
      }

      rec.retries += 1;
      this.store.update({ ...rec });
    }

    // Every attempt failed → Failed, retained in storage, error surfaced.
    this.setState(rec, "Failed");
    const error = uploadFailed(rec.id, attempts);
    return { id, finalState: "Failed", attempts, error };
  }

  /**
   * Apply a state change: update the in-memory entry, persist it (the
   * recording stays in storage for every non-Completed state, Req 45.5), and
   * synchronously notify the listener so the UI can reflect it ≤2s (Req 45.4).
   */
  private setState(rec: QueuedRecording, next: OfflineQueueState): void {
    const previous = rec.state;
    if (previous === next) return;
    rec.state = next;
    // Persist the updated state; removal for Completed is handled by the caller
    // after this returns, so the recording is retained until Completed.
    if (next !== "Completed") {
      this.store.update({ ...rec });
    }
    this.emit(rec.id, previous, next);
  }

  /** Notify the state-change listener at the current clock time (Req 45.4). */
  private emit(
    id: string,
    previous: OfflineQueueState | null,
    next: OfflineQueueState
  ): void {
    if (!this.onStateChange) return;
    this.onStateChange({ id, previous, next, at: this.clock.now() });
  }
}

/** Factory mirroring the `createChunkUpload` convention. */
export function createOfflineQueue(deps: OfflineQueueDeps): OfflineQueueService {
  return new OfflineQueueService(deps);
}
