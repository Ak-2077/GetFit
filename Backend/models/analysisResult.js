import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════
// AnalysisResult — bounded persisted record for AI exercise analysis.
//
// Privacy boundary (Req 13.2, 29.3): this schema EXPLICITLY EXCLUDES the
// original video URL, extracted frames, pose images, and any temporary
// artifacts. Only the bounded fields defined in Req 13.1 are persisted, plus
// the user association (Req 13.4) and version metadata (Req 29.1).
//
// Mixed-typed sub-objects (scores/feedback/movementMetrics/repetitionSummary)
// hold derived scalars/structures only — never raw video, frames, or pose data.
// ═══════════════════════════════════════════════════════════════════════════

// Version metadata sub-document (Req 29.1) — no _id needed.
const versionsSchema = new mongoose.Schema(
  {
    analysisVersion: { type: String, default: '' },
    poseEngineVersion: { type: String, default: '' },
    visionModelVersion: { type: String, default: '' },
    reasoningModelVersion: { type: String, default: '' },
    pipelineVersion: { type: String, default: '' },
  },
  { _id: false }
);

const analysisResultSchema = new mongoose.Schema(
  {
    // End_User association (Req 13.4)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Pipeline job correlation id
    jobId: { type: String, index: true },

    // Bounded analysis content (Req 13.1)
    exerciseId: { type: String, default: '' },
    overallScore: { type: Number, default: 0 },
    // movement/ROM/tempo/stability/symmetry/joint alignment scores
    scores: { type: mongoose.Schema.Types.Mixed, default: {} },
    // strengths/mistakes/corrections/safety warnings/improvement tips/training advice
    feedback: { type: mongoose.Schema.Types.Mixed, default: {} },
    movementMetrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    repetitionSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
    overallConfidence: { type: Number, default: 0 },
    lowConfidence: { type: Boolean, default: false },

    // User corrections (Req 13.3)
    userCorrections: { type: [mongoose.Schema.Types.Mixed], default: [] },

    // Versioning metadata (Req 29.1)
    versions: { type: versionsSchema, default: () => ({}) },

    // ── V2 ADDITIVE FIELDS (optional only) ─────────────────────────────────
    // These extend the record additively for Version 2 features. They change
    // NO existing field and carry only derived scalars/structures — never any
    // video, frames, or pose data (privacy boundary preserved, Req 52.5).
    //
    // Human Review Mode (Req 42): exactly one of the two states when present.
    // Left optional (no default) so a record without V2 fields keeps the exact
    // V1 serialized shape (Req 52.3).
    reviewStatus: {
      type: String,
      enum: ['Confident', 'Needs Review'],
    },
    // Explainable AI (Req 49): per-score weighted factor attributions. Derived
    // scalars only (score name + factor weights) — never raw artifacts.
    scoreExplanations: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    // Duplicate detection key components (Req 34.2): a SHA256 content hash of
    // the submitted video — the HASH ONLY, never the video itself — plus the
    // pipeline version. Indexed for fast (userId, videoHash, pipelineVersion)
    // lookup by the duplicateStore service.
    videoHash: { type: String, index: true },
    pipelineVersion: { type: String },

    // ── PRIVACY BOUNDARY (Req 13.2, 29.3) ──────────────────────────────────
    // No videoUrl, no frames, no pose images, no temporary artifacts are
    // declared on this schema. With strict mode (Mongoose default) any such
    // fields supplied at write time are stripped and never persisted.
    // ───────────────────────────────────────────────────────────────────────
  },
  { timestamps: true }
);

// analysis date is captured by `createdAt` (timestamps); index for recency queries.
analysisResultSchema.index({ userId: 1, createdAt: -1 });

// Duplicate-detection lookup key (Req 34.2): a prior result is a match only
// when userId + videoHash + pipelineVersion are all equal. Sparse so legacy
// documents without these V2 fields are simply skipped (no backfill needed).
analysisResultSchema.index(
  { userId: 1, videoHash: 1, pipelineVersion: 1 },
  { sparse: true }
);

const AnalysisResult = mongoose.model('AnalysisResult', analysisResultSchema);
export default AnalysisResult;
