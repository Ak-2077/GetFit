/**
 * Feature: ai-exercise-analysis · Task 32.1
 * Contract/snapshot test: V1 backend API (aiClient) signature stability.
 *
 * Validates: Requirements 52.1, 52.2, 52.7
 *
 * The V1 exercise-analysis backend API surface is the aiClient methods
 * `submitAnalysis` / `getAnalysisStatus` / `getAnalysisResult`. Adding the V2
 * surface MUST NOT change their existence, arity, or parameter source
 * (Req 52.2). The V2 additions (`lookupDuplicate`, `submitChunkedAnalysis`)
 * MUST be SEPARATE, additive functions — not modifications of the V1 methods.
 *
 * This test imports aiClient (side-effect free — it only constructs an axios
 * instance) and asserts each function's existence, `.length` arity, and the
 * exact byte-stable parameter list parsed from its source. A drift here is a
 * REAL Req 52 regression, not a reason to loosen the snapshot.
 *
 * Run: node tests/aiClientSignatureStability.test.mjs   (from Backend/)
 */
import * as aiClient from '../services/aiClient.js';

let passed = 0, failed = 0;
const lines = [];
const check = (label, cond, detail = '') => {
  if (cond) { passed++; lines.push(`  \u2713 ${label}`); }
  else { failed++; lines.push(`  \u2717 ${label} ${detail ? '\u2192 ' + detail : ''}`); }
};

console.log('\u2550\u2550\u2550 ai-exercise-analysis \u00b7 V1 aiClient signature stability \u2550\u2550\u2550');

/**
 * Extract the exact parameter-list source of a function (the text between the
 * first top-level `(` and its matching `)`), normalized to a single spaced
 * line. This captures BOTH parameter names and arity — a byte-stable proxy for
 * the caller-facing signature.
 */
function paramSource(fn) {
  const src = fn.toString();
  const open = src.indexOf('(');
  if (open === -1) return null;
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close === -1) return null;
  return src.slice(open + 1, close).replace(/\s+/g, ' ').trim();
}

// ── Inline snapshot of the V1 API surface ────────────────────────────────────
// name → { length (Function.length arity), params (byte-stable param source) }
const V1_SIGNATURES = {
  submitAnalysis:    { length: 1, params: 'videoUrl, exerciseHint = null' },
  getAnalysisStatus: { length: 1, params: 'jobId' },
  getAnalysisResult: { length: 1, params: 'jobId' },
};

for (const [name, expected] of Object.entries(V1_SIGNATURES)) {
  const fn = aiClient[name];
  check(`${name} exists and is a function`, typeof fn === 'function',
    `typeof=${typeof fn}`);
  if (typeof fn !== 'function') continue;

  check(`${name} arity is byte-stable (.length === ${expected.length})`,
    fn.length === expected.length, `got .length=${fn.length}`);

  const params = paramSource(fn);
  check(`${name} parameter source is byte-stable`,
    params === expected.params, `got "${params}" expected "${expected.params}"`);
}

// ── V2 additions must be SEPARATE additive functions (Req 52.1) ──────────────
const V2_ADDITIVE = {
  lookupDuplicate:       { length: 3, params: 'userId, videoHash, pipelineVersion' },
  submitChunkedAnalysis: { length: 0 }, // single destructured object param w/ default
};

for (const [name, expected] of Object.entries(V2_ADDITIVE)) {
  const fn = aiClient[name];
  check(`V2 ${name} exists as a separate additive function`, typeof fn === 'function',
    `typeof=${typeof fn}`);
  if (typeof fn !== 'function') continue;
  check(`V2 ${name} arity (.length === ${expected.length})`,
    fn.length === expected.length, `got .length=${fn.length}`);
  if (expected.params !== undefined) {
    const params = paramSource(fn);
    check(`V2 ${name} parameter source matches`, params === expected.params,
      `got "${params}"`);
  }
}

// ── The V2 additions must be DISTINCT from the V1 methods (not aliased) ──────
const v1Names = Object.keys(V1_SIGNATURES);
const v2Names = Object.keys(V2_ADDITIVE);
let distinct = true;
for (const v1 of v1Names) {
  for (const v2 of v2Names) {
    if (aiClient[v1] === aiClient[v2]) distinct = false;
  }
}
check('V2 methods are distinct references from V1 methods (additive, not replacing)', distinct);

console.log(lines.join('\n'));
console.log(`\nPASSED: ${passed}  FAILED: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
