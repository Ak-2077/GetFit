/**
 * Feature: ai-exercise-analysis
 * Property 1: Bounded persisted record excludes raw artifacts
 *
 * For any AnalysisResult, the serialized persisted record's key set is a subset
 * of the permitted field set (exercise id, analysis date, scores, feedback,
 * movement metrics, repetition summary, confidence, user corrections, version
 * metadata, and the submitting user id) and contains NO original video, frame,
 * pose-image, or temporary-file data. Plus the correction round-trip: a stored
 * user correction is associated with the result.
 *
 * Validates: Requirements 1.2, 1.6, 13.1, 13.2, 13.3, 13.4, 29.1, 29.3
 *
 * Mechanism under test: the AnalysisResult Mongoose schema's strict-mode
 * stripping is the persistence privacy boundary — any non-permitted field
 * supplied at write time (videoUrl/frames/pose/temp artifacts) is dropped and
 * never persisted. We construct documents (no DB connection required; strict
 * stripping happens at document construction) and assert the bounded shape.
 *
 * Run: node tests/analysisResultBoundary.test.mjs
 */
import fc from 'fast-check';
import mongoose from 'mongoose';
import AnalysisResult from '../models/analysisResult.js';

let passed = 0, failed = 0;
const lines = [];
const check = (label, cond, detail = '') => {
  if (cond) { passed++; lines.push(`  ✓ ${label}`); }
  else { failed++; lines.push(`  ✗ ${label} ${detail ? '→ ' + detail : ''}`); }
};

console.log('═══ ai-exercise-analysis · Property 1: Bounded persisted record ═══');

// ── Permitted top-level field set (Req 13.1 + 13.4 user assoc + 29.1 versions)
//    plus Mongoose-managed keys (_id, __v) and timestamps (createdAt/updatedAt,
//    where createdAt is the "analysis date" of Req 13.1).
const PERMITTED = new Set([
  'userId',            // submitting user (Req 13.4)
  'jobId',             // pipeline job correlation
  'exerciseId',        // exercise id (Req 13.1)
  'overallScore',
  'scores',            // movement / ROM / tempo / stability / symmetry / alignment
  'feedback',          // strengths / mistakes / corrections / warnings / tips / advice
  'movementMetrics',
  'repetitionSummary',
  'overallConfidence',
  'lowConfidence',
  'userCorrections',   // user corrections (Req 13.3)
  'versions',          // version metadata (Req 29.1)
  // Mongoose-managed + timestamps (analysis date = createdAt, Req 13.1)
  '_id', '__v', 'createdAt', 'updatedAt',
]);

// Forbidden raw-artifact keys (Req 1.2, 13.2, 29.3) — original video, frames,
// pose images, temporary files. These must NEVER survive into the record.
const FORBIDDEN_KEYS = [
  'videoUrl', 'video_url', 'videoPath', 'rawVideo', 'sourceVideo',
  'frames', 'frameData', 'frameSet', 'extractedFrames',
  'pose', 'poseImage', 'poseImages', 'poseData', 'landmarks',
  'tempFile', 'tempPath', 'temp', 'tmpDir', 'artifacts',
];

// substring patterns to catch any accidental raw-artifact leak by name.
const FORBIDDEN_PATTERNS = [/video/i, /frame/i, /pose/i, /landmark/i, /temp/i, /tmp/i, /raw/i, /artifact/i];

// ── Generators ──────────────────────────────────────────────────────────────
const jsonScalar = fc.oneof(
  fc.string(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
);

const smallObj = fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), jsonScalar, { maxKeys: 5 });

// An arbitrary AI result payload polluted with a random subset of forbidden
// raw-artifact fields at the top level, alongside legitimate bounded content.
const pollutedPayload = fc.record({
  exerciseId: fc.string(),
  overallScore: fc.double({ min: 0, max: 100, noNaN: true }),
  scores: smallObj,
  feedback: smallObj,
  movementMetrics: smallObj,
  repetitionSummary: smallObj,
  overallConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
  lowConfidence: fc.boolean(),
  versions: fc.record({
    analysisVersion: fc.string(),
    pipelineVersion: fc.string(),
  }, { requiredKeys: [] }),
  // pollution: random subset of forbidden keys with arbitrary junk values.
  pollution: fc.subarray(FORBIDDEN_KEYS, { minLength: 1 }).chain((keys) =>
    fc.tuple(...keys.map(() => fc.oneof(fc.string(), smallObj, fc.array(jsonScalar))))
      .map((vals) => Object.fromEntries(keys.map((k, i) => [k, vals[i]])))),
}, { requiredKeys: ['exerciseId', 'overallScore', 'pollution'] });

const newObjectId = () => new mongoose.Types.ObjectId();

// ── PROPERTY 1a: persisted key set ⊆ permitted set, no raw artifacts ─────────
try {
  fc.assert(
    fc.property(pollutedPayload, (payload) => {
      const { pollution, ...bounded } = payload;
      // Build a write-time input mixing bounded content + raw-artifact pollution.
      const input = { userId: newObjectId(), jobId: 'job-1', ...bounded, ...pollution };

      // Construction applies the schema's strict mode → strips unknown paths.
      const doc = new AnalysisResult(input);
      const record = doc.toObject();
      const keys = Object.keys(record);

      // (i) every persisted key is in the permitted set
      for (const k of keys) {
        if (!PERMITTED.has(k)) return false;
      }
      // (ii) no forbidden raw-artifact key survived
      for (const fk of FORBIDDEN_KEYS) {
        if (Object.prototype.hasOwnProperty.call(record, fk)) return false;
      }
      // (iii) no key matches a raw-artifact name pattern
      for (const k of keys) {
        if (FORBIDDEN_PATTERNS.some((re) => re.test(k))) return false;
      }
      return true;
    }),
    { numRuns: 200 },
  );
  check('persisted key set ⊆ permitted fields; raw artifacts (video/frame/pose/temp) excluded', true);
} catch (e) {
  check('persisted key set ⊆ permitted fields; raw artifacts excluded', false, e.message);
}

// ── PROPERTY 1b: bounded content is preserved (subset relation is non-trivial)
try {
  fc.assert(
    fc.property(pollutedPayload, (payload) => {
      const { pollution, ...bounded } = payload;
      const doc = new AnalysisResult({ userId: newObjectId(), jobId: 'j', ...bounded, ...pollution });
      const record = doc.toObject();
      // The legitimate bounded fields must be retained (not over-stripped).
      return (
        record.exerciseId === bounded.exerciseId &&
        typeof record.overallScore === 'number' &&
        typeof record.userCorrections === 'object' && Array.isArray(record.userCorrections) &&
        record.versions !== undefined
      );
    }),
    { numRuns: 200 },
  );
  check('bounded content (exerciseId/scores/versions/userCorrections) retained', true);
} catch (e) {
  check('bounded content retained', false, e.message);
}

// ── PROPERTY 1c: correction round-trip — a stored correction is associated ───
//    Mirrors controller's $push { userCorrections: correction } shape (Req 13.3).
try {
  fc.assert(
    fc.property(
      fc.oneof(fc.string(), smallObj, fc.record({ field: fc.string(), value: jsonScalar })),
      (correction) => {
        const doc = new AnalysisResult({ userId: newObjectId(), jobId: 'j', exerciseId: 'squat' });
        // Apply the same mutation the controller performs ($push).
        doc.userCorrections.push(correction);
        const record = doc.toObject();
        // The correction is associated with the result and read-back equal.
        if (!Array.isArray(record.userCorrections)) return false;
        if (record.userCorrections.length !== 1) return false;
        const stored = record.userCorrections[0];
        return JSON.stringify(stored) === JSON.stringify(correction);
      },
    ),
    { numRuns: 200 },
  );
  check('correction round-trip: stored correction associated with result and read back', true);
} catch (e) {
  check('correction round-trip', false, e.message);
}

console.log(lines.join('\n'));
console.log(`\nPASSED: ${passed}  FAILED: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
