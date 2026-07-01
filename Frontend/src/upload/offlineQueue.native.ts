/**
 * Thin, ISOLATED real adapters for the Offline_Queue_Service.
 *
 * This is the ONLY place that touches native modules (`@react-native-async-storage/
 * async-storage`, `expo-file-system`, `@react-native-community/netinfo`) and the
 * network transport. It is intentionally kept out of the pure `offlineQueue.ts`
 * logic module so that unit/property tests never import native code (mirrors
 * `chunkUpload.native.ts`).
 *
 * Native modules are loaded lazily via `require` inside functions, so merely
 * importing type declarations from this file does not pull in native code. The
 * pure decision logic (state machine, oldest-first ordering, bounded retry,
 * retain-until-Completed, reject-when-unavailable/full) lives entirely in
 * `offlineQueue.ts` and is exercised by tests with fakes.
 *
 * Requirements: 45.1–45.7 (adapter wiring only).
 */

import type {
  ConnectivitySignal,
  LocalStore,
  QueuedRecording,
  StorePutResult,
  Uploader,
  UploadAttemptResult,
} from "./offlineQueue";

/**
 * A minimal synchronous key/value facade the {@link LocalStore} adapter reads
 * and writes. Injected so the adapter stays decoupled from any specific
 * persistence backend; the caller wires it to AsyncStorage / expo-file-system
 * (typically maintaining an in-memory mirror hydrated on startup so the
 * synchronous `put`/`list`/`remove` contract of `LocalStore` is honoured).
 */
export interface KeyValueBackend {
  /** All persisted recordings. */
  readAll(): QueuedRecording[];
  /** Persist (insert or replace) a recording. Throws if storage is unavailable. */
  write(recording: QueuedRecording): void;
  /** Delete a recording by id. */
  delete(id: string): void;
  /** True when the backend has room for another recording (not full). */
  hasCapacity(): boolean;
  /** True when the backend is usable at all (mounted / not corrupted). */
  isAvailable(): boolean;
}

/**
 * Real {@link LocalStore} backed by an injected {@link KeyValueBackend}. Maps a
 * write failure onto the `{ ok: false, reason }` contract the pure logic uses
 * to reject a submission without assigning Queued (Req 45.7).
 */
export function createNativeLocalStore(backend: KeyValueBackend): LocalStore {
  return {
    put(recording: QueuedRecording): StorePutResult {
      if (!backend.isAvailable()) return { ok: false, reason: "unavailable" };
      if (!backend.hasCapacity()) return { ok: false, reason: "full" };
      try {
        backend.write(recording);
        return { ok: true };
      } catch {
        // A late failure (e.g. quota exceeded mid-write) is treated as full.
        return { ok: false, reason: "full" };
      }
    },
    update(recording: QueuedRecording): void {
      backend.write(recording);
    },
    remove(id: string): void {
      backend.delete(id);
    },
    list(): QueuedRecording[] {
      return backend.readAll();
    },
  };
}

/**
 * Real {@link Uploader}. The concrete network POST is injected as `postRecording`
 * so this adapter stays decoupled from any specific HTTP client; the caller
 * supplies the transport (e.g. the Chunk_Upload_Service against the backend).
 * Any transport rejection is normalised to `{ ok: false }`, which the pure
 * retry logic treats as a failed attempt (Req 45.6).
 */
export function createNativeUploader(
  postRecording: (recording: QueuedRecording) => Promise<boolean>
): Uploader {
  return {
    async upload(recording: QueuedRecording): Promise<UploadAttemptResult> {
      try {
        const ok = await postRecording(recording);
        return ok ? { ok: true } : { ok: false };
      } catch {
        return { ok: false };
      }
    },
  };
}

/**
 * Real {@link ConnectivitySignal} backed by `@react-native-community/netinfo`.
 * The current online flag is injected (kept in sync by a NetInfo subscription
 * the caller owns), so this adapter itself imports no native code eagerly.
 */
export function createNativeConnectivity(
  getIsOnline: () => boolean
): ConnectivitySignal {
  return {
    isOnline(): boolean {
      return getIsOnline();
    },
  };
}

/**
 * Subscribe to NetInfo connectivity changes, invoking `onChange` with the
 * current online flag. Lazily requires NetInfo so importing this module does
 * not pull native code into the test import graph. Returns an unsubscribe fn.
 */
export function subscribeConnectivity(
  onChange: (isOnline: boolean) => void
): () => void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const NetInfo = require("@react-native-community/netinfo") as {
    addEventListener?: (
      listener: (state: { isConnected?: boolean | null }) => void
    ) => () => void;
  };
  if (typeof NetInfo.addEventListener !== "function") {
    return () => undefined;
  }
  return NetInfo.addEventListener((state) => {
    onChange(state.isConnected === true);
  });
}
