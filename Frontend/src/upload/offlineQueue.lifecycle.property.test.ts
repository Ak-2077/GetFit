/**
 * Property 52: Offline queue never loses a recording across its lifecycle.
 *
 * Validates: Requirements 45.1, 45.3, 45.5
 *
 * For any sequence of submit/drain operations against a fake LocalStore and a
 * fake Uploader:
 *   - every submitted-and-accepted recording is tracked with EXACTLY ONE valid
 *     `Offline_Queue_State` at all times (every state observed via the
 *     state-change listener and via `get`/`list` is one of the five valid
 *     `OFFLINE_QUEUE_STATES`, and every transition is a legal `canTransition`
 *     edge) — Req 45.3;
 *   - immediately after an accepted submit the recording is present in the
 *     store and tracked in state `Queued` (Req 45.1);
 *   - a recording is removed from the local store ONLY after its state reaches
 *     Completed: `store.remove` is called for an id if and only if that id
 *     reached the Completed state (Req 45.5);
 *   - a recording is never silently dropped: after all operations every
 *     accepted recording is EITHER still tracked in a non-Completed state and
 *     retained in the store, OR is Completed and removed from both.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/upload/offlineQueue.lifecycle.property.test.ts \
 *   && node .tmp-pbt/upload/offlineQueue.lifecycle.property.test.js
 *
 * (PowerShell has no `&&`; run the two commands separately. The `&&` form is
 * kept for POSIX/CI.)
 *
 * The queue drain path is async, so — like the chunkUpload async property
 * tests — we reproduce the harness's seeded sub-seed loop (matching `forAll`'s
 * derivation) and await each case. Uses the seeded PRNG harness only (no
 * fast-check, no network, no native imports). Exits 0 on success and non-zero
 * (printing seed + counterexample) on the first failure.
 */

import {
  LocalStore,
  OfflineQueueState,
  QueuedRecording,
  StorePutResult,
  Uploader,
  UploadAttemptResult,
  ConnectivitySignal,
  Clock,
  OFFLINE_QUEUE_STATES,
  canTransition,
  createOfflineQueue,
  isOfflineQueueState,
} from "./offlineQueue";
import { integer, makeRng } from "../testing/propertyHarness";

const ITERATIONS = 200;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** A fake LocalStore that records every remove and exposes its contents. */
interface FakeStore extends LocalStore {
  readonly removed: string[];
  contains(id: string): boolean;
}

function makeFakeStore(): FakeStore {
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

/** How a recording's uploads behave. */
type UploadOutcome = "succeedNow" | "succeedLate" | "alwaysFail";

interface RecPlan {
  id: string;
  submittedAt: number;
  outcome: UploadOutcome;
  /** For succeedLate: number of failed attempts before the success. */
  failuresBefore: number;
}

interface Scenario {
  recs: RecPlan[];
  drains: number;
}

const OUTCOMES: UploadOutcome[] = ["succeedNow", "succeedLate", "alwaysFail"];

function scenarioGen(rng: ReturnType<typeof makeRng>): Scenario {
  const count = integer(1, 6)(rng);
  const recs: RecPlan[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    // Distinct ids; index prefix guarantees uniqueness, random suffix varies.
    let id = `r${i}-${integer(0, 999)(rng)}`;
    while (used.has(id)) id = `r${i}-${integer(0, 9999)(rng)}`;
    used.add(id);
    const outcome = OUTCOMES[integer(0, OUTCOMES.length - 1)(rng)]!;
    // maxUploadRetries default = 5 total attempts; a late success must land
    // strictly before exhaustion, so 0..3 failures keeps it recoverable.
    const failuresBefore = integer(1, 3)(rng);
    recs.push({ id, submittedAt: integer(0, 10)(rng), outcome, failuresBefore });
  }
  return { recs, drains: integer(1, 3)(rng) };
}

/** Deterministic uploader: consults per-id plan + attempt counter. */
function makeUploader(recs: RecPlan[]): Uploader {
  const planById = new Map(recs.map((r) => [r.id, r]));
  const attempts = new Map<string, number>();
  return {
    async upload(rec: QueuedRecording): Promise<UploadAttemptResult> {
      const n = (attempts.get(rec.id) ?? 0) + 1;
      attempts.set(rec.id, n);
      const plan = planById.get(rec.id)!;
      switch (plan.outcome) {
        case "succeedNow":
          return { ok: true };
        case "succeedLate":
          return n > plan.failuresBefore ? { ok: true } : { ok: false };
        case "alwaysFail":
          return { ok: false };
      }
    },
  };
}

const online: ConnectivitySignal = { isOnline: () => true };
const clock: Clock = { now: () => 1_000 };

async function checkScenario(scenario: Scenario): Promise<void> {
  const store = makeFakeStore();
  const completedIds = new Set<string>();

  // The listener is the "at all times" observer: it fires on every transition.
  const queue = createOfflineQueue({
    store,
    uploader: makeUploader(scenario.recs),
    connectivity: online,
    clock,
    onStateChange: (event) => {
      // Exactly one valid Offline_Queue_State at every change (Req 45.3).
      assert(
        isOfflineQueueState(event.next),
        `emitted next state ${String(event.next)} is not a valid Offline_Queue_State`,
      );
      if (event.previous !== null) {
        assert(
          isOfflineQueueState(event.previous),
          `emitted previous state ${String(event.previous)} invalid`,
        );
        assert(
          canTransition(event.previous, event.next),
          `illegal transition ${event.previous} -> ${event.next} for ${event.id}`,
        );
      }
      if (event.next === "Completed") completedIds.add(event.id);
    },
  });

  // ── Submit each recording; each accepted submit must be Queued + stored ──
  for (const rec of scenario.recs) {
    const outcome = queue.submit({ id: rec.id, submittedAt: rec.submittedAt });
    assert(outcome.ok, `submit for ${rec.id} should be accepted (store is available)`);
    if (outcome.ok) {
      assert(outcome.recording.state === "Queued", `accepted submit must be Queued`);
    }
    const tracked = queue.get(rec.id);
    assert(tracked !== undefined, `accepted ${rec.id} must be tracked immediately`);
    assert(tracked!.state === "Queued", `${rec.id} must be Queued right after submit`);
    assert(store.contains(rec.id), `${rec.id} must be persisted in the store after submit`);
  }

  // Snapshot invariant before any drain: every state is valid.
  for (const r of queue.list()) {
    assert(isOfflineQueueState(r.state), `pre-drain state ${r.state} invalid for ${r.id}`);
  }

  // ── Drain one or more times ──────────────────────────────────────────────
  for (let d = 0; d < scenario.drains; d += 1) {
    const result = await queue.drain();
    assert(!result.skipped, `drain must not be skipped while online`);
    // After every drain, all tracked recordings still carry a valid state.
    for (const r of queue.list()) {
      assert(isOfflineQueueState(r.state), `post-drain state ${r.state} invalid for ${r.id}`);
    }
  }

  // ── Final lifecycle invariants (Req 45.5, no silent drops) ───────────────
  const expectCompleted = new Set(
    scenario.recs
      .filter((r) => r.outcome === "succeedNow" || r.outcome === "succeedLate")
      .map((r) => r.id),
  );

  for (const rec of scenario.recs) {
    const tracked = queue.get(rec.id);
    const inStore = store.contains(rec.id);
    const wasRemoved = store.removed.includes(rec.id);

    if (expectCompleted.has(rec.id)) {
      // Completed → removed from store AND no longer tracked (removed only
      // after Completed). Not silently dropped: it reached Completed.
      assert(completedIds.has(rec.id), `${rec.id} should have reached Completed`);
      assert(tracked === undefined, `Completed ${rec.id} must not remain tracked`);
      assert(!inStore, `Completed ${rec.id} must be removed from the store`);
      assert(wasRemoved, `store.remove must have been called for Completed ${rec.id}`);
    } else {
      // alwaysFail → still tracked (non-Completed) and retained in the store.
      assert(tracked !== undefined, `${rec.id} must still be tracked (never dropped)`);
      assert(
        tracked!.state !== "Completed",
        `${rec.id} never uploaded should not be Completed`,
      );
      assert(isOfflineQueueState(tracked!.state), `state ${tracked!.state} invalid`);
      assert(inStore, `non-Completed ${rec.id} must be retained in the store`);
      assert(!wasRemoved, `store.remove must NOT be called for non-Completed ${rec.id}`);
    }
  }

  // remove(id) called  <=>  id reached Completed (Req 45.5).
  const removedSet = new Set(store.removed);
  assert(
    removedSet.size === completedIds.size,
    `removed set size ${removedSet.size} !== completed set size ${completedIds.size}`,
  );
  for (const id of removedSet) {
    assert(completedIds.has(id), `store.remove called for ${id} which never reached Completed`);
  }
  for (const id of completedIds) {
    assert(removedSet.has(id), `Completed ${id} was never removed from the store`);
  }
}

async function main(): Promise<void> {
  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  const baseSeed = Date.now() >>> 0;
  // Sanity: the state constant is the exact five-element domain.
  assert(OFFLINE_QUEUE_STATES.length === 5, "expected 5 Offline_Queue_State values");

  for (let i = 0; i < ITERATIONS; i += 1) {
    const rng = makeRng((baseSeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const scenario = scenarioGen(rng);
    try {
      await checkScenario(scenario);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error("FAIL  Property 52: offline queue never loses a recording");
      // eslint-disable-next-line no-console
      console.error(
        `Property 52 failed on iteration ${i}\n` +
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
    `PASS  Property 52: offline queue never loses a recording across its lifecycle [${ITERATIONS} cases]`,
  );
  // eslint-disable-next-line no-console
  console.log("\nProperty 52 passed.");
  if (proc) proc.exit(0);
}

void main();
