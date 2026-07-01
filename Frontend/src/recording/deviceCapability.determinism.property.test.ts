/**
 * Property 57: Device tier fully and monotonically determines recording
 * settings, with a low-end fail-safe.
 *
 * Validates: Requirements 48.1, 48.2, 48.3, 48.4, 48.5
 *
 * For any produced `Device_Capability_Profile`, the tier is exactly one of
 * low-end / mid-range / high-end and fully determines the four settings
 * (compression target, resolution, frame sampling rate, upload quality) so that
 * any two devices of the same tier receive identical values; resolution, frame
 * sampling rate and upload quality (and compression target) are non-decreasing
 * from low-end to mid-range to high-end; and when detection cannot complete in
 * time or fails, the profile is assigned the low-end tier with the
 * corresponding settings and a detection-incomplete indication.
 *
 * This suite exercises Property 57 across four sub-properties:
 *   57a (48.1, 48.2) — determinism: `classifyTier` is a pure function of
 *        (metrics, config) and always yields exactly one of the three tiers;
 *        `settingsForTier` is identical across repeated calls.
 *   57b (48.2)       — full determination: a completed profile's four settings
 *        equal `settingsForTier(profile.tier)` exactly.
 *   57c (48.3, 48.4) — monotonicity: across low-end -> mid-range -> high-end,
 *        each of compressionTarget, resolution, frameSamplingRate and
 *        uploadQuality is non-decreasing.
 *   57d (48.5, 48.1) — fail-safe: a rejecting/hanging probe yields the low-end
 *        safe default (detectionCompleted === false, DEVICE_DETECTION_INCOMPLETE
 *        error at the device_capability stage, low-end settings); an in-time
 *        successful measurement yields detectionCompleted === true and a tier
 *        matching `classifyTier(metrics)`. `detectCapability` never throws.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/recording/deviceCapability.determinism.property.test.ts \
 *   && node .tmp-pbt/recording/deviceCapability.determinism.property.test.js
 *
 * (PowerShell has no `&&`; run the two steps separately — the `&&` form is kept
 * for CI.) The command compiles this test together with its imports (the
 * harness + deviceCapability + config) into `.tmp-pbt/` and runs the emitted
 * JS. It exits 0 when all cases pass and non-zero (printing seed +
 * counterexample) on the first failure. Uses a seeded PRNG harness (no
 * fast-check, no network, no native imports). The `detectCapability` timing is
 * driven through an injected `delay` so no real timers fire.
 */

import {
  DEVICE_TIERS,
  DeviceCapabilityConfig,
  DeviceTier,
  resolveDeviceCapabilityConfig,
} from "../config/deviceCapabilityConfig";
import {
  DEVICE_CAPABILITY_STAGE,
  DEVICE_DETECTION_INCOMPLETE,
  DeviceMetrics,
  DeviceProbe,
  classifyTier,
  detectCapability,
  profileForTier,
  safeDefaultProfile,
  settingsForTier,
} from "./deviceCapability";
import { isStructuredError } from "../types/structuredError";
import { Generator, forAll, makeRng, oneof } from "../testing/propertyHarness";

const ITERATIONS = 300;

/** Assertion helper: throws with a message on falsy conditions. */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── Generators ──────────────────────────────────────────────────────────────

/**
 * Score generator that mixes a wide continuous band with the exact threshold
 * boundaries (39/40/41, 74/75/76) so the classification edges are hit often.
 */
const boundaryScoreGen: Generator<number> = (rng) => {
  const edges = [
    -1, 0, 39, 39.999, 40, 40.001, 41, 74, 74.999, 75, 75.001, 76, 100, 200,
  ];
  const pick = rng.next();
  if (pick < 0.5) {
    // Continuous band.
    return -50 + rng.next() * 250;
  }
  return edges[Math.floor(rng.next() * edges.length)]!;
};

/** Metrics carrying only a benchmark score. */
const metricsGen: Generator<DeviceMetrics> = (rng) => ({
  benchmarkScore: boundaryScoreGen(rng),
});

/** A config generator: mostly defaults, sometimes overriding thresholds. */
const configGen: Generator<DeviceCapabilityConfig> = (rng) => {
  if (rng.next() < 0.5) return resolveDeviceCapabilityConfig();
  // Override thresholds with a valid pair mid <= high so ordering is coherent.
  const mid = 20 + Math.floor(rng.next() * 40); // [20, 59]
  const high = mid + 1 + Math.floor(rng.next() * 40); // > mid
  return resolveDeviceCapabilityConfig({ midRangeMinScore: mid, highEndMinScore: high });
};

const tierGen: Generator<DeviceTier> = (rng) =>
  DEVICE_TIERS[Math.floor(rng.next() * DEVICE_TIERS.length)]!;

// ── 57a: determinism of classifyTier + settingsForTier ───────────────────────

interface DeterminismCase {
  metrics: DeviceMetrics;
  config: DeviceCapabilityConfig;
  tier: DeviceTier;
}

const determinismGen: Generator<DeterminismCase> = (rng) => ({
  metrics: metricsGen(rng),
  config: configGen(rng),
  tier: tierGen(rng),
});

function checkDeterminism(c: DeterminismCase): void {
  // classifyTier is a pure function of (metrics, config): repeated calls agree.
  const t1 = classifyTier(c.metrics, c.config);
  const t2 = classifyTier(c.metrics, c.config);
  assert(t1 === t2, `classifyTier not deterministic: ${t1} !== ${t2}`);

  // Same score => same tier (call with a fresh metrics object of equal score).
  const t3 = classifyTier({ benchmarkScore: c.metrics.benchmarkScore }, c.config);
  assert(t1 === t3, `classifyTier differs for equal score: ${t1} !== ${t3}`);

  // Exactly one of the three tiers is always produced (48.1).
  assert(
    (DEVICE_TIERS as readonly string[]).includes(t1),
    `classifyTier produced an unknown tier: ${String(t1)}`
  );

  // settingsForTier is identical across repeated calls for arbitrary tier (48.2).
  const s1 = settingsForTier(c.tier, c.config);
  const s2 = settingsForTier(c.tier, c.config);
  assert(
    s1.compressionTarget === s2.compressionTarget &&
      s1.resolution === s2.resolution &&
      s1.frameSamplingRate === s2.frameSamplingRate &&
      s1.uploadQuality === s2.uploadQuality,
    `settingsForTier not deterministic for ${c.tier}: ${JSON.stringify(s1)} vs ${JSON.stringify(s2)}`
  );
  // And it matches the configured table exactly.
  const table = c.config.settings[c.tier];
  assert(
    s1.compressionTarget === table.compressionTarget &&
      s1.resolution === table.resolution &&
      s1.frameSamplingRate === table.frameSamplingRate &&
      s1.uploadQuality === table.uploadQuality,
    `settingsForTier(${c.tier}) does not match configured table`
  );
}

// ── 57b: a completed profile is fully determined by its tier ─────────────────

function checkFullDetermination(c: DeterminismCase): void {
  const profile = profileForTier(c.tier, c.config);
  const s = settingsForTier(profile.tier, c.config);
  assert(profile.tier === c.tier, `profileForTier tier mismatch`);
  assert(profile.detectionCompleted === true, `profileForTier must be completed`);
  assert(profile.detectionError === undefined, `completed profile must have no error`);
  assert(profile.compressionTarget === s.compressionTarget, `compressionTarget not tier-determined`);
  assert(profile.resolution === s.resolution, `resolution not tier-determined`);
  assert(profile.frameSamplingRate === s.frameSamplingRate, `frameSamplingRate not tier-determined`);
  assert(profile.uploadQuality === s.uploadQuality, `uploadQuality not tier-determined`);
}

// ── 57c: monotonicity across low-end -> mid-range -> high-end ────────────────

function checkMonotonicity(config: DeviceCapabilityConfig): void {
  // DEVICE_TIERS is ascending in capability; walk adjacent pairs.
  for (let i = 1; i < DEVICE_TIERS.length; i++) {
    const lower = settingsForTier(DEVICE_TIERS[i - 1]!, config);
    const higher = settingsForTier(DEVICE_TIERS[i]!, config);
    assert(
      higher.compressionTarget >= lower.compressionTarget,
      `compressionTarget decreased ${DEVICE_TIERS[i - 1]} -> ${DEVICE_TIERS[i]}`
    );
    assert(
      higher.resolution >= lower.resolution,
      `resolution decreased ${DEVICE_TIERS[i - 1]} -> ${DEVICE_TIERS[i]}`
    );
    assert(
      higher.frameSamplingRate >= lower.frameSamplingRate,
      `frameSamplingRate decreased ${DEVICE_TIERS[i - 1]} -> ${DEVICE_TIERS[i]}`
    );
    assert(
      higher.uploadQuality >= lower.uploadQuality,
      `uploadQuality decreased ${DEVICE_TIERS[i - 1]} -> ${DEVICE_TIERS[i]}`
    );
  }
}

// ── 57d: fail-safe + in-time success paths of detectCapability ───────────────

/** An immediately-resolving delay: drives the timeout branch deterministically. */
const immediateDelay = (_ms: number): Promise<void> => Promise.resolve();
/** A delay that never resolves: lets the probe win an in-time race. */
const neverDelay = (_ms: number): Promise<void> => new Promise<void>(() => {});

type ProbeKind = "success" | "reject" | "hang";

interface DetectCase {
  kind: ProbeKind;
  metrics: DeviceMetrics;
  config: DeviceCapabilityConfig;
}

const detectGen: Generator<DetectCase> = (rng) => ({
  kind: oneof<ProbeKind>(
    () => "success",
    () => "reject",
    () => "hang"
  )(rng),
  metrics: metricsGen(rng),
  config: configGen(rng),
});

function assertLowEndSafeDefault(profile: ReturnType<typeof safeDefaultProfile>, config: DeviceCapabilityConfig): void {
  const low = settingsForTier("low-end", config);
  assert(profile.tier === "low-end", `fail-safe tier must be low-end, got ${profile.tier}`);
  assert(profile.detectionCompleted === false, `fail-safe detectionCompleted must be false`);
  assert(isStructuredError(profile.detectionError), `fail-safe must carry a StructuredError`);
  assert(
    profile.detectionError!.code === DEVICE_DETECTION_INCOMPLETE,
    `fail-safe error code must be ${DEVICE_DETECTION_INCOMPLETE}, got ${profile.detectionError!.code}`
  );
  assert(
    profile.detectionError!.stage === DEVICE_CAPABILITY_STAGE,
    `fail-safe error stage must be ${DEVICE_CAPABILITY_STAGE}, got ${profile.detectionError!.stage}`
  );
  assert(profile.compressionTarget === low.compressionTarget, `fail-safe compressionTarget mismatch`);
  assert(profile.resolution === low.resolution, `fail-safe resolution mismatch`);
  assert(profile.frameSamplingRate === low.frameSamplingRate, `fail-safe frameSamplingRate mismatch`);
  assert(profile.uploadQuality === low.uploadQuality, `fail-safe uploadQuality mismatch`);
}

async function checkDetect(c: DetectCase): Promise<void> {
  let probe: DeviceProbe;
  let delay: (ms: number) => Promise<void>;

  if (c.kind === "success") {
    probe = { measure: () => c.metrics };
    delay = neverDelay; // probe resolves in time -> probe wins the race
  } else if (c.kind === "reject") {
    probe = { measure: () => Promise.reject(new Error("probe boom")) };
    delay = neverDelay;
  } else {
    // hang: probe never resolves; delay resolves immediately -> timeout branch.
    probe = { measure: () => new Promise<DeviceMetrics>(() => {}) };
    delay = immediateDelay;
  }

  let profile;
  try {
    profile = await detectCapability({ probe, config: c.config, delay });
  } catch (error) {
    throw new Error(`detectCapability threw instead of returning a profile: ${String(error)}`);
  }

  if (c.kind === "success") {
    const expectedTier = classifyTier(c.metrics, c.config);
    const s = settingsForTier(expectedTier, c.config);
    assert(profile.detectionCompleted === true, `success detectionCompleted must be true`);
    assert(profile.detectionError === undefined, `success profile must have no error`);
    assert(profile.tier === expectedTier, `success tier ${profile.tier} !== classifyTier ${expectedTier}`);
    assert(profile.compressionTarget === s.compressionTarget, `success compressionTarget mismatch`);
    assert(profile.resolution === s.resolution, `success resolution mismatch`);
    assert(profile.frameSamplingRate === s.frameSamplingRate, `success frameSamplingRate mismatch`);
    assert(profile.uploadQuality === s.uploadQuality, `success uploadQuality mismatch`);
  } else {
    assertLowEndSafeDefault(profile, c.config);
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

/**
 * `detectCapability` is async, so we reproduce the harness's seeded sub-seed
 * loop (matching `forAll`'s derivation) and await each case.
 */
async function runDetectProperty(iterations: number): Promise<void> {
  const baseSeed = Date.now() >>> 0;
  for (let i = 0; i < iterations; i++) {
    const rng = makeRng((baseSeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const value = detectGen(rng);
    try {
      await checkDetect(value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Property 57d (detectCapability fail-safe/success) failed on iteration ${i}\n` +
          `  seed:           ${baseSeed}\n` +
          `  iteration:      ${i}\n` +
          `  counterexample: ${JSON.stringify({
            kind: value.kind,
            benchmarkScore: value.metrics.benchmarkScore,
            midRangeMinScore: value.config.midRangeMinScore,
            highEndMinScore: value.config.highEndMinScore,
          })}\n` +
          `  detail:         ${detail}`
      );
    }
  }
}

async function main(): Promise<void> {
  const failures: string[] = [];

  // 57a — determinism of classifyTier + settingsForTier (synchronous).
  try {
    forAll(determinismGen, checkDeterminism, { iterations: ITERATIONS });
    console.log(`PASS  Property 57a: classifyTier/settingsForTier deterministic, exactly one tier [${ITERATIONS} cases]`);
  } catch (error) {
    failures.push("57a");
    console.error("FAIL  Property 57a: determinism");
    console.error(error instanceof Error ? error.message : String(error));
  }

  // 57b — completed profile fully determined by tier (synchronous).
  try {
    forAll(determinismGen, checkFullDetermination, { iterations: ITERATIONS });
    console.log(`PASS  Property 57b: profile settings fully determined by tier [${ITERATIONS} cases]`);
  } catch (error) {
    failures.push("57b");
    console.error("FAIL  Property 57b: full determination");
    console.error(error instanceof Error ? error.message : String(error));
  }

  // 57c — monotonicity across tiers (synchronous, over generated configs).
  try {
    forAll(configGen, checkMonotonicity, { iterations: ITERATIONS });
    console.log(`PASS  Property 57c: settings non-decreasing low -> mid -> high [${ITERATIONS} cases]`);
  } catch (error) {
    failures.push("57c");
    console.error("FAIL  Property 57c: monotonicity");
    console.error(error instanceof Error ? error.message : String(error));
  }

  // 57d — detectCapability fail-safe + in-time success (async).
  try {
    await runDetectProperty(ITERATIONS);
    console.log(`PASS  Property 57d: detectCapability fail-safe + in-time success, never throws [${ITERATIONS} cases]`);
  } catch (error) {
    failures.push("57d");
    console.error("FAIL  Property 57d: detectCapability paths");
    console.error(error instanceof Error ? error.message : String(error));
  }

  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  if (failures.length > 0) {
    console.error(`\nProperty 57 failed (${failures.join(", ")}).`);
    if (proc) proc.exit(1);
    throw new Error("Property 57 failed");
  }
  console.log("\nProperty 57 passed (tier fully & monotonically determines settings, with a low-end fail-safe).");
  if (proc) proc.exit(0);
}

void main();
