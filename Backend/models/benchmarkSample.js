import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════
// BenchmarkSample — labeled evaluation sample for offline benchmarking
// (Req 41.2).
//
// PRIVACY / SEPARATION BOUNDARY (Req 41.6, 52.5): a SEPARATE collection that
// is NEVER joined to the client-facing AnalysisResult. It stores an image
// HASH only — the original video is EXCLUDED from every sample.
// ═══════════════════════════════════════════════════════════════════════════

const benchmarkSampleSchema = new mongoose.Schema(
  {
    imageHash: { type: String, default: '' },
    exercise: { type: String, default: '' },
    prediction: { type: String, default: '' },
    groundTruth: { type: String, default: '' },
    confidence: { type: Number, default: 0 }, // 0.0..1.0
    reason: { type: String, default: '' },
    manualCorrection: { type: String, default: '' },
    pipelineVersion: { type: String, default: '' },
  },
  { timestamps: true }
);

// Explicit collection name; never joined to AnalysisResult.
const BenchmarkSample = mongoose.model(
  'BenchmarkSample',
  benchmarkSampleSchema,
  'benchmarkSamples'
);
export default BenchmarkSample;
