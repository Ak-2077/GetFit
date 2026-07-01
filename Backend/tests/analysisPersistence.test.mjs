/**
 * Feature: ai-exercise-analysis
 * Integration tests — persistence & correction round-trip against MongoDB.
 *
 * Validates: Requirements 13.3 (user corrections stored & associated),
 *            13.4 (analysis result associated with submitting user),
 *            cross-check 13.2 (no videoUrl/frames/pose persisted).
 *
 * Mechanism under test: the AnalysisResult Mongoose model is exercised against
 * a real (in-memory) MongoDB instance via mongodb-memory-server, so we verify
 * actual persistence + read-back semantics — not just in-memory document
 * construction. The correction round-trip mirrors the controller's
 * findOneAndUpdate($push { userCorrections }) mutation (Req 13.3).
 *
 * Run: node tests/analysisPersistence.test.mjs
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import AnalysisResult from '../models/analysisResult.js';

let passed = 0, failed = 0;
const lines = [];
const check = (label, cond, detail = '') => {
  if (cond) { passed++; lines.push(`  ✓ ${label}`); }
  else { failed++; lines.push(`  ✗ ${label} ${detail ? '→ ' + detail : ''}`); }
};

console.log('═══ ai-exercise-analysis · Integration: persistence & corrections ═══');

// Forbidden raw-artifact keys (Req 13.2 cross-check) — must never persist.
const FORBIDDEN_KEYS = [
  'videoUrl', 'video_url', 'videoPath', 'rawVideo', 'sourceVideo',
  'frames', 'frameData', 'extractedFrames',
  'pose', 'poseImage', 'poseImages', 'poseData', 'landmarks',
  'tempFile', 'tempPath', 'artifacts',
];
const FORBIDDEN_PATTERNS = [/video/i, /frame/i, /pose/i, /landmark/i, /temp/i, /tmp/i, /raw/i, /artifact/i];

let mongod;

const run = async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'analysis_test' });

  // ── TEST 1: Persist a result associated with a userId, then read it back ──
  // (Req 13.4 user association; Req 13.2 cross-check — no raw artifacts).
  {
    const userId = new mongoose.Types.ObjectId();

    // Write-time input includes legitimate bounded content AND polluted
    // raw-artifact fields that strict mode must strip before persistence.
    const created = await AnalysisResult.create({
      userId,
      jobId: 'job-persist-1',
      exerciseId: 'barbell-squat',
      overallScore: 87,
      scores: { movementScore: 90, rangeOfMotion: 80, tempo: 85, stability: 88 },
      feedback: { strengths: ['depth'], mistakes: ['knee cave'], corrections: ['push knees out'] },
      movementMetrics: { peakVelocity: 1.2 },
      repetitionSummary: { reps: 5 },
      overallConfidence: 0.92,
      lowConfidence: false,
      versions: { analysisVersion: 'v1', pipelineVersion: 'p1' },
      // ── pollution (must be stripped, Req 13.2) ──
      videoUrl: 'https://example.com/raw.mp4',
      frames: [{ idx: 0, data: 'base64...' }],
      poseImages: ['pose0.png'],
      landmarks: [{ x: 1, y: 2 }],
      tempFile: '/tmp/abc',
    });

    // Read back from the database by association with the user (Req 13.4).
    const stored = await AnalysisResult.findOne({ userId, jobId: 'job-persist-1' }).lean();

    check('result persisted and retrievable from DB', !!stored, 'findOne returned null');
    check('userId association holds on stored doc',
      stored && String(stored.userId) === String(userId),
      stored ? `got ${stored.userId}` : 'no doc');
    check('bounded fields persisted (exerciseId)',
      stored && stored.exerciseId === 'barbell-squat', stored && stored.exerciseId);
    check('bounded fields persisted (overallScore)',
      stored && stored.overallScore === 87, stored && String(stored.overallScore));
    check('bounded fields persisted (scores sub-object)',
      stored && stored.scores && stored.scores.movementScore === 90);
    check('bounded fields persisted (feedback sub-object)',
      stored && stored.feedback && Array.isArray(stored.feedback.strengths) &&
      stored.feedback.strengths[0] === 'depth');
    check('bounded fields persisted (versions metadata)',
      stored && stored.versions && stored.versions.analysisVersion === 'v1');
    check('analysis date persisted (createdAt timestamp)',
      stored && stored.createdAt instanceof Date);

    // Cross-check Req 13.2: no raw-artifact fields exist on the stored doc.
    let noForbiddenKey = true, leakedKey = '';
    for (const fk of FORBIDDEN_KEYS) {
      if (stored && Object.prototype.hasOwnProperty.call(stored, fk)) { noForbiddenKey = false; leakedKey = fk; break; }
    }
    check('no raw-artifact field persisted (explicit key list)', noForbiddenKey, leakedKey);

    let noForbiddenPattern = true, leakedPattern = '';
    if (stored) {
      for (const k of Object.keys(stored)) {
        if (FORBIDDEN_PATTERNS.some((re) => re.test(k))) { noForbiddenPattern = false; leakedPattern = k; break; }
      }
    }
    check('no key matches raw-artifact name pattern (video/frame/pose/temp)', noForbiddenPattern, leakedPattern);
  }

  // ── TEST 2: Round-trip a user correction (Req 13.3) ──
  // Create a result, push a correction via the same mutation the controller
  // performs (findOneAndUpdate $push), reload, assert stored & associated.
  {
    const userId = new mongoose.Types.ObjectId();
    const created = await AnalysisResult.create({
      userId,
      jobId: 'job-correction-1',
      exerciseId: 'deadlift',
      overallScore: 70,
    });

    const correction = { field: 'exerciseId', value: 'romanian-deadlift', note: 'it was an RDL' };

    // Mirror analysisController.correction: scope by { _id, userId } and $push.
    const updated = await AnalysisResult.findOneAndUpdate(
      { _id: created._id, userId },
      { $push: { userCorrections: correction } },
      { new: true },
    ).lean();

    check('correction update returned the document', !!updated);
    check('correction is scoped/associated to the same user',
      updated && String(updated.userId) === String(userId));

    // Reload independently from the DB to confirm durable persistence.
    const reloaded = await AnalysisResult.findById(created._id).lean();
    check('correction stored after reload from DB',
      reloaded && Array.isArray(reloaded.userCorrections) && reloaded.userCorrections.length === 1,
      reloaded ? `len=${reloaded.userCorrections && reloaded.userCorrections.length}` : 'no doc');
    check('correction round-trips equal (deep)',
      reloaded && JSON.stringify(reloaded.userCorrections[0]) === JSON.stringify(correction),
      reloaded && JSON.stringify(reloaded.userCorrections[0]));

    // A correction scoped to a DIFFERENT user must not match (Req 13.3 assoc).
    const otherUser = new mongoose.Types.ObjectId();
    const wrongScope = await AnalysisResult.findOneAndUpdate(
      { _id: created._id, userId: otherUser },
      { $push: { userCorrections: { note: 'should not apply' } } },
      { new: true },
    ).lean();
    check('correction scoped to other user does not match', wrongScope === null);

    const afterWrongScope = await AnalysisResult.findById(created._id).lean();
    check('correction count unchanged after mismatched-user attempt',
      afterWrongScope && afterWrongScope.userCorrections.length === 1,
      afterWrongScope && String(afterWrongScope.userCorrections.length));
  }
};

run()
  .catch((e) => { check('test harness completed without throwing', false, e && e.stack ? e.stack : String(e)); })
  .finally(async () => {
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    try { if (mongod) await mongod.stop(); } catch { /* ignore */ }

    console.log(lines.join('\n'));
    console.log(`\nPASSED: ${passed}  FAILED: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
  });
