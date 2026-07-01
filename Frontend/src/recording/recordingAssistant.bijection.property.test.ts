/**
 * Property 39: Recording guidance is a severity-ordered bijection over detected
 * conditions.
 *
 * Validates: Requirements 35.2, 35.3, 35.4
 *
 * For any camera preview exhibiting a set of recording conditions, the
 * Recording_Assistant_Service returns exactly one corrective instruction per
 * detected condition (a bijection), each instruction naming the detected
 * condition and the required adjustment, ordered by the configured severity
 * ranking; when no conditions are present it returns guidance marked ready with
 * an empty instruction list.
 *
 * This test drives the pure logic two independent ways:
 *
 *   39a — `buildGuidance` fed arbitrary condition LISTS (subsets of the 12
 *         conditions, deliberately containing duplicates) under an arbitrary
 *         severity-order permutation. Asserts the instruction-condition set
 *         equals the de-duplicated input set (one-to-one; no extras, no
 *         missing; duplicates collapsed); instructions are ordered by
 *         non-decreasing severity; every adjustment is a non-empty string;
 *         every severity equals `severityRank(condition, order)`; and the empty
 *         set yields `ready === true` with an empty instruction list.
 *
 *   39b — `detectConditions` → `buildGuidance` driven through `analyzePreview`
 *         with a fake analyzer returning arbitrary `PreviewSignals`. Asserts the
 *         result is guidance (never a StructuredError), and the same bijection /
 *         ordering / severity / ready invariants hold over the DETECTED set.
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/recording/recordingAssistant.bijection.property.test.ts \
 *   && node .tmp-pbt/recording/recordingAssistant.bijection.property.test.js
 *
 * The command compiles this test together with its imports (the harness +
 * recordingAssistant + config) into `.tmp-pbt/` and runs the emitted JS. It
 * exits 0 when all cases pass and non-zero (printing seed + counterexample) on
 * the first failure. Uses the seeded PRNG harness (no fast-check, no network).
 * `.tmp-pbt/` is gitignored and removed after the run.
 */

import {
  DEFAULT_RECORDING_ASSISTANT_CONFIG,
  PreviewOrientation,
  RecordingAssistantConfig,
  RecordingCondition,
  resolveRecordingAssistantConfig,
  severityRank,
} from "../config/recordingAssistantConfig";
import {
  PreviewFrame,
  PreviewSignals,
  RecordingGuidance,
  analyzePreview,
  buildGuidance,
  detectConditions,
  isGuidanceUnavailable,
} from "./recordingAssistant";
import {
  Generator,
  Rng,
  choice,
  float,
  forAll,
  integer,
  map,
} from "../testing/propertyHarness";

const ITERATIONS = 300;

/** The closed, exhaustive set of the 12 recording conditions. */
const ALL_CONDITIONS: readonly RecordingCondition[] = [
  RecordingCondition.MultiplePeople,
  RecordingCondition.BodyCropped,
  RecordingCondition.HeadMissing,
  RecordingCondition.FeetMissing,
  RecordingCondition.DistanceTooFar,
  RecordingCondition.DistanceTooClose,
  RecordingCondition.CameraTooLow,
  RecordingCondition.CameraTooHigh,
  RecordingCondition.WrongOrientation,
  RecordingCondition.PoorLighting,
  RecordingCondition.Backlight,
  RecordingCondition.CameraShaking,
];

/** A uniform boolean generator built from the harness integer generator. */
const boolean: Generator<boolean> = map(integer(0, 1), (n) => n === 1);

/**
 * Generate an arbitrary condition LIST of length 0..18 where each element is
 * drawn uniformly from all 12 conditions. Because draws repeat, the list
 * naturally contains duplicates (exercising duplicate-collapsing) and, with a
 * zero length, the empty-set / ready case (exercising Req 35.4).
 */
const conditionListGen: Generator<RecordingCondition[]> = (rng: Rng) => {
  const length = integer(0, 18)(rng);
  const out: RecordingCondition[] = [];
  for (let i = 0; i < length; i++) out.push(choice(ALL_CONDITIONS)(rng));
  return out;
};

/**
 * Generate an arbitrary permutation of all 12 conditions to use as a custom
 * severity order. This stresses that the ordering + severity rank always track
 * the CONFIGURED order rather than any hard-coded default (Req 35.3, 35.5).
 * A seeded Fisher-Yates shuffle keeps it deterministic per rng.
 */
const severityOrderGen: Generator<RecordingCondition[]> = (rng: Rng) => {
  const order = ALL_CONDITIONS.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = integer(0, i)(rng);
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  return order;
};

/** Generate arbitrary preview signals spanning every detection threshold. */
const orientationGen: Generator<PreviewOrientation> = choice([
  "portrait",
  "landscape",
]);

const signalsGen: Generator<PreviewSignals> = (rng: Rng) => ({
  personCount: integer(0, 4)(rng),
  cameraPitchDeg: float(-45, 45)(rng),
  bodyVisibleFraction: float(0, 1)(rng),
  headVisible: boolean(rng),
  feetVisible: boolean(rng),
  subjectFillFraction: float(0, 1)(rng),
  brightness: float(0, 1)(rng),
  backlightRatio: float(0, 4)(rng),
  motionMagnitude: float(0, 1)(rng),
  orientation: orientationGen(rng),
});

/** Deep set-equality over two condition collections (order-independent). */
function sameConditionSet(
  a: readonly RecordingCondition[],
  b: readonly RecordingCondition[]
): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const c of sa) if (!sb.has(c)) return false;
  return true;
}

/**
 * Assert the shared Property-39 invariants of a `RecordingGuidance` given the
 * set of conditions that were detected/requested and the effective config.
 * Throws (with a descriptive message) on the first violation.
 */
function assertGuidanceInvariants(
  guidance: RecordingGuidance,
  detected: readonly RecordingCondition[],
  config: RecordingAssistantConfig
): void {
  const expected = Array.from(new Set(detected)); // de-duplicated expected set
  const instructions = guidance.instructions;

  // Bijection cardinality: exactly one instruction per unique condition.
  if (instructions.length !== expected.length) {
    throw new Error(
      `expected ${expected.length} instructions (unique conditions) but got ${instructions.length}`
    );
  }

  // Bijection: instruction-condition set equals the de-duplicated input set.
  const instructionConditions = instructions.map((i) => i.condition);
  if (!sameConditionSet(instructionConditions, expected)) {
    throw new Error(
      `instruction condition set ${JSON.stringify(instructionConditions)} != expected ${JSON.stringify(expected)}`
    );
  }

  // One-to-one: no duplicate conditions among the instructions.
  if (new Set(instructionConditions).size !== instructions.length) {
    throw new Error(
      `duplicate condition among instructions: ${JSON.stringify(instructionConditions)}`
    );
  }

  // Empty detected set → ready with an empty instruction list (Req 35.4).
  const shouldBeReady = expected.length === 0;
  if (guidance.ready !== shouldBeReady) {
    throw new Error(
      `ready === ${guidance.ready} but expected ${shouldBeReady} for ${expected.length} conditions`
    );
  }
  if (shouldBeReady && instructions.length !== 0) {
    throw new Error("ready guidance must carry an empty instruction list");
  }

  // Each instruction: non-empty adjustment naming the action (Req 35.3),
  // and severity == configured rank of its condition.
  for (const inst of instructions) {
    if (typeof inst.adjustment !== "string" || inst.adjustment.length === 0) {
      throw new Error(`empty adjustment for condition ${inst.condition}`);
    }
    const expectedRank = severityRank(inst.condition, config.severityOrder);
    if (inst.severity !== expectedRank) {
      throw new Error(
        `severity ${inst.severity} != severityRank ${expectedRank} for ${inst.condition}`
      );
    }
  }

  // Ordered by non-decreasing severity (most-blocking first, Req 35.3).
  for (let i = 1; i < instructions.length; i++) {
    if (instructions[i - 1]!.severity > instructions[i]!.severity) {
      throw new Error(
        `instructions not severity-ordered at ${i}: ` +
          `${instructions[i - 1]!.severity} > ${instructions[i]!.severity}`
      );
    }
  }
}

/**
 * 39a — buildGuidance over arbitrary condition lists (with duplicates) under an
 * arbitrary configured severity-order permutation.
 */
const buildInputGen: Generator<{
  conditions: RecordingCondition[];
  order: RecordingCondition[];
}> = (rng: Rng) => ({
  conditions: conditionListGen(rng),
  order: severityOrderGen(rng),
});

function checkBuildGuidance(input: {
  conditions: RecordingCondition[];
  order: RecordingCondition[];
}): void {
  const config = resolveRecordingAssistantConfig({ severityOrder: input.order });
  const guidance = buildGuidance(input.conditions, config);
  assertGuidanceInvariants(guidance, input.conditions, config);
}

/**
 * 39b — detectConditions → buildGuidance driven through analyzePreview with a
 * fake analyzer returning arbitrary signals under an arbitrary severity order.
 */
const analyzeInputGen: Generator<{
  signals: PreviewSignals;
  order: RecordingCondition[];
}> = (rng: Rng) => ({
  signals: signalsGen(rng),
  order: severityOrderGen(rng),
});

function checkDetectAndBuild(input: {
  signals: PreviewSignals;
  order: RecordingCondition[];
}): void {
  const overrides = { severityOrder: input.order };
  const config = resolveRecordingAssistantConfig(overrides);
  const frame: PreviewFrame = { timestampMs: 0 };
  const result = analyzePreview(frame, {
    analyzer: { analyze: () => input.signals },
    config: overrides,
  });

  // Valid signals must produce guidance, never a StructuredError.
  if (isGuidanceUnavailable(result)) {
    throw new Error(
      `analyzePreview returned an error for valid signals: ${JSON.stringify(result)}`
    );
  }

  const detected = detectConditions(input.signals, config);
  assertGuidanceInvariants(result, detected, config);
}

function main(): void {
  let a: unknown = null;
  try {
    forAll(buildInputGen, checkBuildGuidance, { iterations: ITERATIONS });
    // eslint-disable-next-line no-console
    console.log(
      `PASS  Property 39a: buildGuidance is a severity-ordered bijection [${ITERATIONS} cases]`
    );
  } catch (error) {
    a = error;
    // eslint-disable-next-line no-console
    console.error("FAIL  Property 39a: buildGuidance bijection");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
  }

  let b: unknown = null;
  try {
    forAll(analyzeInputGen, checkDetectAndBuild, { iterations: ITERATIONS });
    // eslint-disable-next-line no-console
    console.log(
      `PASS  Property 39b: detectConditions→analyzePreview bijection [${ITERATIONS} cases]`
    );
  } catch (error) {
    b = error;
    // eslint-disable-next-line no-console
    console.error("FAIL  Property 39b: analyzePreview bijection");
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
  }

  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  if (a || b) {
    // eslint-disable-next-line no-console
    console.error("\nProperty 39 failed.");
    if (proc) proc.exit(1);
    throw new Error("Property 39 failed");
  }
  // eslint-disable-next-line no-console
  console.log(
    "\nProperty 39 passed (recording guidance is a severity-ordered bijection over detected conditions)."
  );
  if (proc) proc.exit(0);
}

// Reference DEFAULT_RECORDING_ASSISTANT_CONFIG to document the default baseline
// even though every case resolves an explicit (possibly permuted) config.
void DEFAULT_RECORDING_ASSISTANT_CONFIG;

main();
