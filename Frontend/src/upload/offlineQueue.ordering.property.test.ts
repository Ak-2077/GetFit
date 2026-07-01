/**
 * Property 53: Offline queue uploads oldest-first on reconnect.
 *
 * Validates: Requirements 45.2
 *
 * For any set of queued recordings with arbitrary submission timestamps
 * (including ties):
 *   - `drain()` uploads them in ascending order of submission timestamp,
 *     tie-broken deterministically by id — i.e. `DrainOutcome.order` equals
 *     `sortOldestFirst(pending).map(id)` (Req 45.2);
 *   - the same oldest-first order is produced when the drain is triggered via
 *     `onConnectivityRestored`;
 *   - `onConnectivityRestored` reports connectivity detection WITHIN the 30s
 *     window when the clock is within bound, and reports NOT-in-time when the
 *     clock is beyond the configured window (Req 45.2).
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/upload/offlineQueue.ordering.property.test.ts \
 *   && node .tmp-pbt/upload/offlineQueue.ordering.property.test.js
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
  Clock,
  QueuedRecording,
  StorePutResult,
  Uploader,
  UploadAttemptResult,
  LocalStore,
  createOfflineQueue,
  sortOldestFirst,
} from "./offlineQueue";
import {
  DEFAULT_OFFLINE_QUEUE_CONFIG,
  reconnectDetectMs,
} from "../config/offlineQueueConfig";
import { integer, makeRng } from "../testing/propertyHarness";

const ITERATIONS = 200;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Minimal always-accept store (ordering does not depend on persistence). */
function makeStore(): LocalStore {
  const map = new Map<string, QueuedRecording>();
  return {
    put(rec: QueuedRecording): StorePutResult {
      map.set(rec.id, { ...rec });
      return { ok: true };
    },
    update(rec: QueuedRecording): void {
      map.set(rec.id, { ...rec });
    },
    remove(id: string): void {
      map.delete(id);
    },
    list(): QueuedRecording[] {
      return [...map.values()].map((r) => ({ ...r }));
    },
  };
}

/** Uploader that always succeeds — order is fixed before upload regardless. */
const successUploader: Uploader = {
  async upload(): Promise<UploadAttemptResult> {
    return { ok: true };
  },
};

const online: ConnectivitySignal = { isOnline: () => true };

interface RecInput {
  id: string;
  submittedAt: number;
}

interface Scenario {
  recs: RecInput[];
}

function scenarioGen(rng: ReturnType<typeof makeRng>): Scenario {
  const count = integer(1, 8)(rng);
  const recs: RecInput[] = [];
  const used = new Set<string>();
  // Small id alphabet + small timestamp range => frequent ties, exercising the
  // id tie-break inside sortOldestFirst.
  const alphabet = "abcd";
  for (let i = 0; i < count; i += 1) {
    let id = "";
    do {
      const len = integer(1, 3)(rng);
      id = "";
      for (let k = 0; k < len; k += 1) {
        id += alphabet[integer(0, alphabet.length - 1)(rng)];
      }
      // Guarantee uniqueness with an index fallback while preserving variety.
      if (used.has(id)) id = `${id}-${i}`;
    } while (used.has(id));
    used.add(id);
    recs.push({ id, submittedAt: integer(0, 5)(rng) });
  }
  return { recs };
}

async function checkScenario(scenario: Scenario): Promise<void> {
  // ── Sub-check A: drain() uploads oldest-first ────────────────────────────
  {
    const queue = createOfflineQueue({
      store: makeStore(),
      uploader: successUploader,
      connectivity: online,
    });
    for (const rec of scenario.recs) {
      assert(queue.submit(rec).ok, `submit ${rec.id} should be accepted`);
    }
    const pending = queue.list(); // all Queued
    const expected = sortOldestFirst(pending).map((r) => r.id);
    const result = await queue.drain();
    assert(!result.skipped, "drain must run while online");
    assert(
      JSON.stringify(result.order) === JSON.stringify(expected),
      `drain order ${JSON.stringify(result.order)} !== oldest-first ${JSON.stringify(expected)}`,
    );
    // The order must be non-decreasing in submittedAt (defence in depth).
    const byId = new Map(scenario.recs.map((r) => [r.id, r.submittedAt]));
    for (let i = 1; i < result.order.length; i += 1) {
      const prev = byId.get(result.order[i - 1]!)!;
      const cur = byId.get(result.order[i]!)!;
      assert(prev <= cur, `order not non-decreasing: ${prev} before ${cur}`);
    }
  }

  // ── Sub-check B: onConnectivityRestored drains oldest-first + in-time ────
  {
    const detectMs = reconnectDetectMs(DEFAULT_OFFLINE_QUEUE_CONFIG);
    const becameOnlineAt = 10_000;
    // Clock within the 30s window (offset in [0, detectMs]).
    const detectedAt = becameOnlineAt + detectMs; // exactly on the bound => in time
    const queue = createOfflineQueue({
      store: makeStore(),
      uploader: successUploader,
      connectivity: online,
      clock: { now: () => detectedAt } as Clock,
    });
    for (const rec of scenario.recs) {
      assert(queue.submit(rec).ok, `submit ${rec.id} should be accepted`);
    }
    const expected = sortOldestFirst(queue.list()).map((r) => r.id);
    const outcome = await queue.onConnectivityRestored(becameOnlineAt);
    assert(outcome.detectedInTime, "reconnect within 30s window must be reported in time");
    assert(
      JSON.stringify(outcome.drain.order) === JSON.stringify(expected),
      `reconnect drain order ${JSON.stringify(outcome.drain.order)} !== ${JSON.stringify(expected)}`,
    );
  }

  // ── Sub-check C: beyond the window => not in time ────────────────────────
  {
    const detectMs = reconnectDetectMs(DEFAULT_OFFLINE_QUEUE_CONFIG);
    const becameOnlineAt = 10_000;
    const detectedAt = becameOnlineAt + detectMs + 1; // 1ms past the bound
    const queue = createOfflineQueue({
      store: makeStore(),
      uploader: successUploader,
      connectivity: online,
      clock: { now: () => detectedAt } as Clock,
    });
    for (const rec of scenario.recs) {
      assert(queue.submit(rec).ok, `submit ${rec.id} should be accepted`);
    }
    const outcome = await queue.onConnectivityRestored(becameOnlineAt);
    assert(!outcome.detectedInTime, "reconnect past 30s window must be reported NOT in time");
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
      console.error("FAIL  Property 53: offline queue uploads oldest-first on reconnect");
      // eslint-disable-next-line no-console
      console.error(
        `Property 53 failed on iteration ${i}\n` +
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
    `PASS  Property 53: offline queue uploads oldest-first on reconnect [${ITERATIONS} cases]`,
  );
  // eslint-disable-next-line no-console
  console.log("\nProperty 53 passed.");
  if (proc) proc.exit(0);
}

void main();
