/**
 * Property 54: Offline upload failure and unavailable storage are handled
 * without loss.
 *
 * Validates: Requirements 45.6, 45.7
 *
 * (a) STORAGE UNAVAILABLE/FULL AT SUBMIT (Req 45.7): for any submission while
 *     the local store reports `unavailable` or `full`, `submit` returns
 *     `{ ok: false, error }` where `error.code === STORAGE_UNAVAILABLE` and
 *     `error.stage === "offline_queue"`; the recording is NOT assigned the
 *     Queued state and is NOT tracked (`list()`/`get()` do not contain it).
 *
 * (b) UPLOAD ALWAYS FAILS (Req 45.6): for any recording whose every upload
 *     attempt fails (returning `{ ok: false }` OR throwing), the drain never
 *     throws; after the bounded number of attempts (== the resolved
 *     `maxUploadRetries`) the recording ends in state Failed, is retained in
 *     the store (`remove` is never called for it), and an OFFLINE_UPLOAD_FAILED
 *     error identifying the recording is surfaced. Attempts are bounded by
 *     `maxUploadRetries`.
 *
 * RETRY SEMANTICS NOTE: the implementation treats `maxUploadRetries` (default
 * 5) as the TOTAL number of upload attempts (`Math.max(1, maxUploadRetries)`
 * iterations). The design says "retries at most 5 times"; 5 total attempts
 * satisfies that upper bound, so there is no contradiction and no impl change
 * is needed. These assertions match the IMPLEMENTED total-attempts semantics.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/upload/offlineQueue.failure.property.test.ts \
 *   && node .tmp-pbt/upload/offlineQueue.failure.property.test.js
 *
 * (PowerShell has no `&&`; run the two commands separately. The `&&` form is
 * kept for POSIX/CI.)
 *
 * The drain path is async, so we reproduce the harness's seeded sub-seed loop
 * (matching `forAll`'s derivation) and await each case. Uses the seeded PRNG
 * harness only (no fast-check, no network, no native imports).
 */

import {
  ConnectivitySignal,
  LocalStore,
  QueuedRecording,
  StoreFailureReason,
  StorePutResult,
  Uploader,
  UploadAttemptResult,
  OFFLINE_QUEUE_STAGE,
  OFFLINE_UPLOAD_FAILED,
  STORAGE_UNAVAILABLE,
  createOfflineQueue,
} from "./offlineQueue";
import {
  resolveOfflineQueueConfig,
} from "../config/offlineQueueConfig";
import { integer, makeRng } from "../testing/propertyHarness";

const ITERATIONS = 200;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const online: ConnectivitySignal = { isOnline: () => true };

/** A store whose `put` always fails with the given reason (Req 45.7). */
interface RejectingStore extends LocalStore {
  readonly removed: string[];
}
function makeRejectingStore(reason: StoreFailureReason): RejectingStore {
  const removed: string[] = [];
  return {
    removed,
    put(): StorePutResult {
      return { ok: false, reason };
    },
    update(): void {
      throw new Error("update must not be called after a rejected put");
    },
    remove(id: string): void {
      removed.push(id);
    },
    list(): QueuedRecording[] {
      return [];
    },
  };
}

/** A store that accepts and retains; records every remove call. */
interface TrackingStore extends LocalStore {
  readonly removed: string[];
  contains(id: string): boolean;
}
function makeTrackingStore(): TrackingStore {
  const map = new Map<string, QueuedRecording>();
  const removed: string[] = [];
  return {
    removed,
    contains: (id) => map.has(id),
    put(rec: QueuedRecording): StorePutResult {
      map.set(rec.id, { ...rec });
      return { ok: true };
    },
    update(rec: QueuedRecording): void {
      map.set(rec.id, { ...rec });
    },
    remove(id: string): void {
      removed.push(id);
      map.delete(id);
    },
    list(): QueuedRecording[] {
      return [...map.values()].map((r) => ({ ...r }));
    },
  };
}

/** How an always-failing uploader signals failure. */
type FailMode = "returnFalse" | "throw";
function makeFailingUploader(mode: FailMode): Uploader {
  return {
    async upload(): Promise<UploadAttemptResult> {
      if (mode === "throw") throw new Error("simulated transport failure");
      return { ok: false };
    },
  };
}

const REASONS: StoreFailureReason[] = ["unavailable", "full"];
const FAIL_MODES: FailMode[] = ["returnFalse", "throw"];

interface Scenario {
  id: string;
  submittedAt: number;
  reason: StoreFailureReason;
  failMode: FailMode;
  /** Override for maxUploadRetries; 1..8 so resolved == override == attempts. */
  maxUploadRetries: number;
}

function scenarioGen(rng: ReturnType<typeof makeRng>): Scenario {
  return {
    id: `rec-${integer(0, 100000)(rng)}`,
    submittedAt: integer(0, 1000)(rng),
    reason: REASONS[integer(0, REASONS.length - 1)(rng)]!,
    failMode: FAIL_MODES[integer(0, FAIL_MODES.length - 1)(rng)]!,
    maxUploadRetries: integer(1, 8)(rng),
  };
}

async function checkScenario(scenario: Scenario): Promise<void> {
  // ── (a) Storage unavailable/full at submit (Req 45.7) ────────────────────
  {
    const store = makeRejectingStore(scenario.reason);
    const queue = createOfflineQueue({
      store,
      uploader: makeFailingUploader(scenario.failMode),
      connectivity: online,
    });

    const outcome = queue.submit({ id: scenario.id, submittedAt: scenario.submittedAt });
    assert(!outcome.ok, `submit must be rejected when storage is ${scenario.reason}`);
    if (!outcome.ok) {
      assert(
        outcome.error.code === STORAGE_UNAVAILABLE,
        `error code ${outcome.error.code} !== ${STORAGE_UNAVAILABLE}`,
      );
      assert(
        outcome.error.stage === OFFLINE_QUEUE_STAGE,
        `error stage ${outcome.error.stage} !== ${OFFLINE_QUEUE_STAGE}`,
      );
      assert(
        typeof outcome.error.message === "string" && outcome.error.message.length > 0,
        "rejection error must carry a message",
      );
    }
    // Not assigned Queued and not tracked at all.
    assert(queue.get(scenario.id) === undefined, `rejected ${scenario.id} must not be tracked`);
    assert(
      !queue.list().some((r) => r.id === scenario.id),
      `rejected ${scenario.id} must not appear in list()`,
    );
  }

  // ── (b) Upload always fails (Req 45.6) ───────────────────────────────────
  {
    const store = makeTrackingStore();
    const resolved = resolveOfflineQueueConfig({ maxUploadRetries: scenario.maxUploadRetries });
    const queue = createOfflineQueue({
      store,
      uploader: makeFailingUploader(scenario.failMode),
      connectivity: online,
      config: { maxUploadRetries: scenario.maxUploadRetries },
    });

    const submitOutcome = queue.submit({ id: scenario.id, submittedAt: scenario.submittedAt });
    assert(submitOutcome.ok, "submit should succeed when the store accepts it");

    // Drain must never throw, even when the uploader throws.
    let drain;
    try {
      drain = await queue.drain();
    } catch (error) {
      throw new Error(`drain threw instead of surfacing a StructuredError: ${String(error)}`);
    }

    assert(drain.order.length === 1, `expected 1 recording drained, got ${drain.order.length}`);
    assert(drain.entries.length === 1, `expected 1 drain entry, got ${drain.entries.length}`);
    const entry = drain.entries[0]!;

    assert(entry.id === scenario.id, `entry id ${entry.id} !== ${scenario.id}`);
    assert(entry.finalState === "Failed", `finalState ${entry.finalState} !== Failed`);
    // Bounded by, and (all-fail) exactly equal to, the resolved retry budget.
    assert(
      entry.attempts <= resolved.maxUploadRetries,
      `attempts ${entry.attempts} exceed budget ${resolved.maxUploadRetries}`,
    );
    assert(
      entry.attempts === resolved.maxUploadRetries,
      `all-fail should make exactly ${resolved.maxUploadRetries} attempts, got ${entry.attempts}`,
    );
    // Error identifies the recording (Req 45.6).
    assert(entry.error !== undefined, "failed drain entry must carry an error");
    assert(
      entry.error!.code === OFFLINE_UPLOAD_FAILED,
      `error code ${entry.error!.code} !== ${OFFLINE_UPLOAD_FAILED}`,
    );
    assert(
      entry.error!.stage === OFFLINE_QUEUE_STAGE,
      `error stage ${entry.error!.stage} !== ${OFFLINE_QUEUE_STAGE}`,
    );
    assert(
      entry.error!.message.includes(scenario.id),
      `error message must identify recording ${scenario.id}: "${entry.error!.message}"`,
    );

    // Retained: state Failed, still in store, remove never called.
    const tracked = queue.get(scenario.id);
    assert(tracked !== undefined, `failed ${scenario.id} must remain tracked`);
    assert(tracked!.state === "Failed", `failed ${scenario.id} must be in state Failed`);
    assert(store.contains(scenario.id), `failed ${scenario.id} must be retained in the store`);
    assert(
      !store.removed.includes(scenario.id),
      `remove must NOT be called for failed ${scenario.id}`,
    );
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
      console.error("FAIL  Property 54: offline failure & unavailable storage handled without loss");
      // eslint-disable-next-line no-console
      console.error(
        `Property 54 failed on iteration ${i}\n` +
          `  seed:           ${baseSeed}\n` +
          `  iteration:      ${i}\n` +
          `  counterexample: ${JSON.stringify(scenario)}\n` +
          `  detail:         ${detail}`,
      );
      if (proc) proc.exit(1);
      throw error;
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `PASS  Property 54: offline upload failure and unavailable storage handled without loss [${ITERATIONS} cases]`,
  );
  // eslint-disable-next-line no-console
  console.log("\nProperty 54 passed.");
  if (proc) proc.exit(0);
}

void main();
