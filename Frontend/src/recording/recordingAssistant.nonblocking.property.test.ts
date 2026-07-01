/**
 * Property 40: Preview-analysis failure is non-blocking.
 *
 * Validates: Requirements 35.6
 *
 * For any unavailable or failing camera preview, the Recording_Assistant_Service
 * returns a Structured_Error indicating guidance is unavailable while still
 * allowing the End_User to begin recording (the result never blocks recording).
 *
 * This test drives `analyzePreview` with two families of failing analyzers over
 * arbitrary frames and configs:
 *   (a) an analyzer that RETURNS a StructuredError (arbitrary code/message/stage);
 *   (b) an analyzer that THROWS (Error, string, or a non-error value).
 *
 * For every case it asserts:
 *   - `analyzePreview` NEVER throws — it returns a value;
 *   - the returned value is a StructuredError (`isGuidanceUnavailable` is true);
 *   - the error code is `GUIDANCE_UNAVAILABLE` and stage is `recording_assistant`
 *     (the code/stage contract is uniform regardless of the analyzer);
 *   - it does NOT fabricate blocking guidance — the result carries no `ready`
 *     flag and no `instructions` list (it is never a RecordingGuidance).
 *
 * HOW TO RUN (documented, reproducible — run from `Frontend/`):
 *
 *   npx tsc --outDir .tmp-pbt --module commonjs --moduleResolution node \
 *     --target ES2020 --strict --skipLibCheck \
 *     src/recording/recordingAssistant.nonblocking.property.test.ts \
 *   && node .tmp-pbt/recording/recordingAssistant.nonblocking.property.test.js
 *
 * The command compiles this test together with its imports (the harness +
 * recordingAssistant + config) into `.tmp-pbt/` and runs the emitted JS. It
 * exits 0 when all cases pass and non-zero (printing seed + counterexample) on
 * the first failure. Uses the seeded PRNG harness (no fast-check, no network).
 * `.tmp-pbt/` is gitignored and removed after the run.
 */

import {
  PreviewOrientation,
  RecordingAssistantConfig,
  RecordingCondition,
} from "../config/recordingAssistantConfig";
import {
  GUIDANCE_UNAVAILABLE,
  PreviewAnalyzer,
  PreviewFrame,
  RECORDING_ASSISTANT_STAGE,
  analyzePreview,
  isGuidanceUnavailable,
} from "./recordingAssistant";
import {
  StructuredError,
  isStructuredError,
  makeStructuredError,
} from "../types/structuredError";
import {
  Generator,
  Rng,
  choice,
  float,
  integer,
  map,
  oneof,
  record,
} from "../testing/propertyHarness";

const ITERATIONS = 300;

/** Arbitrary preview frames (opaque handles the pure logic never inspects). */
const frameGen: Generator<PreviewFrame> = map(
  integer(0, 10_000_000),
  (timestampMs) => ({ timestampMs })
);

/** Arbitrary partial config overrides — must not affect the failure contract. */
const orientationGen: Generator<PreviewOrientation> = choice([
  "portrait",
  "landscape",
]);

const configGen: Generator<Partial<RecordingAssistantConfig>> = (rng: Rng) => ({
  refreshIntervalMs: oneof(integer(-10, 1000), float(0, 500))(rng),
  maxAnalysisLatencyMs: integer(-10, 1000)(rng),
  expectedOrientation: orientationGen(rng),
  maxPeople: integer(0, 5)(rng),
  minBrightness: float(0, 1)(rng),
  maxMotionMagnitude: float(0, 1)(rng),
});

/**
 * Family (a): analyzers that RETURN a StructuredError. The returned code/stage
 * are arbitrary (and deliberately NOT the guidance-unavailable contract) so we
 * verify analyzePreview re-badges every analyzer error uniformly.
 */
const returnedErrorGen: Generator<StructuredError> = map(
  record({
    code: choice(["ANALYZER_DOWN", "TIMEOUT", "NO_FRAME", "weird_code", ""]),
    message: choice(["preview unavailable", "frame dropped", "", "boom"]),
    stage: choice(["preview_analyzer", "camera", "", "other_stage"]),
  }),
  (e) => makeStructuredError(e.code, e.message, e.stage)
);

/** Family (b): analyzers that THROW. Thrown value varies (Error / string / other). */
type Thrower = { kind: "throw"; make: () => never };
const throwerGen: Generator<Thrower> = map(
  integer(0, 2),
  (n): Thrower => ({
    kind: "throw",
    make: () => {
      if (n === 0) throw new Error("analyzer exploded");
      if (n === 1) throw "string failure";
      throw { unexpected: true } as unknown;
    },
  })
);

type Scenario = {
  frame: PreviewFrame;
  config: Partial<RecordingAssistantConfig>;
  analyzer: PreviewAnalyzer;
  label: string;
};

/** Interleave the returning-error and throwing analyzer families per case. */
const scenarioGen: Generator<Scenario> = (rng: Rng) => {
  const frame = frameGen(rng);
  const config = configGen(rng);
  const useThrow = integer(0, 1)(rng) === 1;
  if (useThrow) {
    const thrower = throwerGen(rng);
    return {
      frame,
      config,
      analyzer: { analyze: () => thrower.make() },
      label: "throwing-analyzer",
    };
  }
  const err = returnedErrorGen(rng);
  return {
    frame,
    config,
    analyzer: { analyze: () => err },
    label: "error-returning-analyzer",
  };
};

function checkNonBlocking(scenario: Scenario): void {
  let result: ReturnType<typeof analyzePreview>;
  try {
    result = analyzePreview(scenario.frame, {
      analyzer: scenario.analyzer,
      config: scenario.config,
    });
  } catch (error) {
    // analyzePreview must NEVER throw on a failing analyzer.
    throw new Error(
      `analyzePreview threw (${scenario.label}): ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Must be the failure branch.
  if (!isGuidanceUnavailable(result)) {
    throw new Error(
      `expected a StructuredError for ${scenario.label}, got guidance: ${JSON.stringify(result)}`
    );
  }
  if (!isStructuredError(result)) {
    throw new Error(`result is not a StructuredError: ${JSON.stringify(result)}`);
  }

  // Uniform code/stage contract regardless of the analyzer's own error.
  if (result.code !== GUIDANCE_UNAVAILABLE) {
    throw new Error(
      `code ${result.code} != ${GUIDANCE_UNAVAILABLE} (${scenario.label})`
    );
  }
  if (result.stage !== RECORDING_ASSISTANT_STAGE) {
    throw new Error(
      `stage ${result.stage} != ${RECORDING_ASSISTANT_STAGE} (${scenario.label})`
    );
  }
  if (typeof result.message !== "string") {
    throw new Error(`message is not a string (${scenario.label})`);
  }

  // Must NOT fabricate blocking guidance: the failure result is not guidance.
  const asGuidance = result as unknown as {
    ready?: unknown;
    instructions?: unknown;
  };
  if ("ready" in result || asGuidance.ready !== undefined) {
    throw new Error(`failure result must not carry a 'ready' flag (${scenario.label})`);
  }
  if ("instructions" in result || asGuidance.instructions !== undefined) {
    throw new Error(
      `failure result must not carry an 'instructions' list (${scenario.label})`
    );
  }
}

/**
 * The scenario generator is stateful across the case (it draws several times
 * from the rng), so we drive it through the harness's reproducible seeded loop
 * directly rather than via `forAll` (whose predicate wraps a single draw).
 */
function main(): void {
  const baseSeed = Date.now() >>> 0;
  let failure: unknown = null;
  let failingIteration = -1;

  for (let i = 0; i < ITERATIONS; i++) {
    // Mirror forAll's per-iteration sub-seed derivation for reproducibility.
    const state = (baseSeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
    let s = state >>> 0;
    const rng: Rng = {
      seed: state,
      next(): number {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
    };
    const scenario = scenarioGen(rng);
    try {
      checkNonBlocking(scenario);
    } catch (error) {
      failure = error;
      failingIteration = i;
      break;
    }
  }

  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  if (failure) {
    // eslint-disable-next-line no-console
    console.error("FAIL  Property 40: preview-analysis failure is non-blocking");
    // eslint-disable-next-line no-console
    console.error(
      `  seed:      ${baseSeed}\n  iteration: ${failingIteration}\n  detail:    ${failure instanceof Error ? failure.message : String(failure)}`
    );
    if (proc) proc.exit(1);
    throw new Error("Property 40 failed");
  }
  // eslint-disable-next-line no-console
  console.log(
    `PASS  Property 40: preview-analysis failure is non-blocking [${ITERATIONS} cases]`
  );
  // eslint-disable-next-line no-console
  console.log(
    "\nProperty 40 passed (a failing/unavailable preview yields a non-blocking GUIDANCE_UNAVAILABLE error, never fabricated guidance)."
  );
  if (proc) proc.exit(0);
}

// Touch the RecordingCondition import so an unused-symbol lint stays quiet while
// documenting that the failure branch fabricates none of them.
void (RecordingCondition as unknown);

main();
