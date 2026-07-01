/**
 * propertyHarness.ts — a tiny, self-contained, seeded property-based testing
 * harness for the frontend.
 *
 * WHY THIS EXISTS: `fast-check` is not installed and we want property tests to
 * run in plain Node with only the TypeScript compiler, no network installs and
 * no native imports. This module is pure TypeScript (no `react-native` /
 * `expo-*` / node-native imports) so it compiles and runs anywhere `tsc` +
 * `node` are available.
 *
 * DESIGN:
 *  - A deterministic PRNG (mulberry32) seeded from an integer. Runs are
 *    reproducible: the same seed replays the same sequence of cases.
 *  - A `Generator<T>` is a pure function `(rng) => T`. Combinators (`integer`,
 *    `float`, `choice`, `constantFrom`, `record`, `tuple`, `oneof`, `map`)
 *    build arbitrary values from the rng.
 *  - `forAll(gen, predicate, options?)` draws `iterations` (default >= 100)
 *    cases. On the first counterexample it prints the seed + the failing input
 *    and throws; `run`/`runSuite` translate that into a non-zero process exit.
 *
 * Reusable across frontend property tests (e.g. video compression, chunking).
 */

/** A seeded pseudo-random number generator producing floats in [0, 1). */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** The seed this generator was created from (for reproducibility). */
  readonly seed: number;
}

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG. Deterministic for a
 * given seed so failures are always reproducible.
 */
export function makeRng(seed: number): Rng {
  // Force to a 32-bit unsigned integer state.
  let state = seed >>> 0;
  return {
    seed,
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** A pure generator: given an rng, deterministically produce a value. */
export type Generator<T> = (rng: Rng) => T;

/** Uniform integer in the inclusive range [min, max]. */
export function integer(min: number, max: number): Generator<number> {
  if (max < min) throw new Error(`integer: max (${max}) < min (${min})`);
  const span = max - min + 1;
  return (rng) => min + Math.floor(rng.next() * span);
}

/** Uniform float in the half-open range [min, max). */
export function float(min: number, max: number): Generator<number> {
  if (max < min) throw new Error(`float: max (${max}) < min (${min})`);
  const span = max - min;
  return (rng) => min + rng.next() * span;
}

/** Pick one element uniformly from a non-empty array of choices. */
export function choice<T>(values: readonly T[]): Generator<T> {
  if (values.length === 0) throw new Error("choice: empty values array");
  return (rng) => values[Math.floor(rng.next() * values.length)]!;
}

/** Alias for {@link choice}: pick a constant uniformly from the list. */
export const constantFrom = choice;

/** Always produce the same value. */
export function constant<T>(value: T): Generator<T> {
  return () => value;
}

/** Pick one of the provided generators uniformly, then draw from it. */
export function oneof<T>(...gens: Array<Generator<T>>): Generator<T> {
  if (gens.length === 0) throw new Error("oneof: no generators");
  return (rng) => gens[Math.floor(rng.next() * gens.length)]!(rng);
}

/** Transform a generator's output with a pure function. */
export function map<A, B>(gen: Generator<A>, fn: (a: A) => B): Generator<B> {
  return (rng) => fn(gen(rng));
}

/** Draw a fixed-length tuple from a list of generators. */
export function tuple<T extends unknown[]>(
  ...gens: { [K in keyof T]: Generator<T[K]> }
): Generator<T> {
  return (rng) => gens.map((g) => (g as Generator<unknown>)(rng)) as T;
}

/** Draw an object whose fields are produced by the corresponding generators. */
export function record<T extends Record<string, unknown>>(
  shape: { [K in keyof T]: Generator<T[K]> }
): Generator<T> {
  const keys = Object.keys(shape) as Array<keyof T>;
  return (rng) => {
    const out = {} as T;
    for (const key of keys) out[key] = shape[key](rng);
    return out;
  };
}

/** Options controlling a {@link forAll} run. */
export interface ForAllOptions {
  /** Number of cases to generate. Defaults to 100 (the minimum we require). */
  iterations?: number;
  /** Base seed. Defaults to a time-derived seed printed on failure. */
  seed?: number;
}

/** Thrown by {@link forAll} when a counterexample is found. */
export class PropertyFailure extends Error {
  constructor(
    message: string,
    readonly seed: number,
    readonly iteration: number,
    readonly counterexample: unknown
  ) {
    super(message);
    this.name = "PropertyFailure";
  }
}

/**
 * Check that `predicate` holds for every generated value. Runs at least 100
 * cases by default. Each case is drawn from a per-iteration rng derived from
 * the base seed + iteration index, so a failing case is fully reproducible from
 * the printed `(seed, iteration)` pair.
 *
 * @throws PropertyFailure on the first counterexample (predicate returns false
 * or throws).
 */
export function forAll<T>(
  gen: Generator<T>,
  predicate: (value: T) => boolean | void,
  options: ForAllOptions = {}
): void {
  const iterations = Math.max(100, options.iterations ?? 100);
  const baseSeed = options.seed ?? (Date.now() >>> 0);

  for (let i = 0; i < iterations; i++) {
    // Derive a distinct, reproducible sub-seed for this iteration.
    const rng = makeRng((baseSeed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    const value = gen(rng);
    let ok: boolean;
    let thrown: unknown;
    try {
      const result = predicate(value);
      ok = result !== false; // returning void/true passes; only false fails
    } catch (error) {
      ok = false;
      thrown = error;
    }
    if (!ok) {
      const detail = thrown ? ` (threw: ${describe(thrown)})` : "";
      throw new PropertyFailure(
        `Property failed on iteration ${i}${detail}\n` +
          `  seed:          ${baseSeed}\n` +
          `  iteration:     ${i}\n` +
          `  counterexample: ${describe(value)}`,
        baseSeed,
        i,
        value
      );
    }
  }
}

/** A single named property to be executed by {@link runSuite}. */
export interface NamedProperty {
  name: string;
  run: () => void;
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Execute a suite of named properties. Prints a line per property. On any
 * failure it prints the seed + counterexample and exits the process with a
 * non-zero status so CI / the compile+run command fails loudly. On full success
 * it exits 0.
 */
export function runSuite(properties: NamedProperty[]): void {
  let failed = 0;
  for (const prop of properties) {
    try {
      prop.run();
      // eslint-disable-next-line no-console
      console.log(`PASS  ${prop.name}`);
    } catch (error) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`FAIL  ${prop.name}`);
      // eslint-disable-next-line no-console
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  const proc = (globalThis as { process?: { exit(code: number): never } }).process;
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failed} propert${failed === 1 ? "y" : "ies"} failed.`);
    if (proc) proc.exit(1);
    throw new Error(`${failed} properties failed`);
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${properties.length} properties passed.`);
  if (proc) proc.exit(0);
}
