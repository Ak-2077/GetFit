import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════
// CostRecord — anonymous per-job resource/cost telemetry (Req 40.1).
//
// PRIVACY / SEPARATION BOUNDARY (Req 40.2, 40.3, 40.4, 52.5): this is a
// SEPARATE collection that is NEVER joined to the client-facing AnalysisResult.
// It carries ONLY aggregate/operational scalars — it EXCLUDES any user
// identifier and any video, frame, or pose data.
// ═══════════════════════════════════════════════════════════════════════════

const costRecordSchema = new mongoose.Schema(
  {
    processingTimeMs: { type: Number, default: 0 },
    gpuMemoryMb: { type: Number, default: 0 },
    vramUsageMb: { type: Number, default: 0 },
    frameCount: { type: Number, default: 0 },
    modelUsed: { type: String, default: '' },
    tokenCount: { type: Number, default: 0 },
    estimatedInferenceCost: { type: Number, default: 0 },
    workerId: { type: String, default: '' },
    queueWaitMs: { type: Number, default: 0 },
    // Correlates only to a job, never to a user (no userId by design).
    jobId: { type: String, index: true },
    pipelineVersion: { type: String, default: '' },
  },
  { timestamps: true }
);

// Explicit collection name; never joined to AnalysisResult.
const CostRecord = mongoose.model('CostRecord', costRecordSchema, 'costRecords');
export default CostRecord;
