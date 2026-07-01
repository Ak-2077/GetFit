import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════
// AdminMetric — aggregate operational metrics for the Admin Dashboard
// (Req 46.1).
//
// PRIVACY / SEPARATION BOUNDARY (Req 46.5, 46.6, 52.5): a SEPARATE collection
// storing ONLY aggregate values computed over a rolling window. It stores NO
// per-user records and EXCLUDES all user-identifiable information, video,
// frames, and pose data. Never joined to the client-facing AnalysisResult.
// ═══════════════════════════════════════════════════════════════════════════

const adminMetricSchema = new mongoose.Schema(
  {
    // Rolling aggregation window bounds (Req 46.1 — 5 minute window).
    windowStart: { type: Date },
    windowEnd: { type: Date },

    // Aggregate metrics (Req 46.1). All optional so a partially-computed window
    // can still be presented, with unavailable values surfaced as indicators.
    averageProcessingTimeMs: { type: Number },
    averageConfidence: { type: Number }, // 0.0..1.0
    queueLength: { type: Number }, // >= 0
    workerUtilization: { type: Number }, // 0..100
    gpuUtilization: { type: Number }, // 0..100
    failureRate: { type: Number }, // 0..100
    cameraIssueFrequency: { type: Number }, // >= 0
    retryCount: { type: Number }, // >= 0

    // Count-per-key aggregates — anonymous, no user linkage.
    exercisePopularity: { type: mongoose.Schema.Types.Mixed, default: {} },
    modelUsage: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Recency index for "latest window" reads.
adminMetricSchema.index({ windowEnd: -1 });

// Explicit collection name; never joined to AnalysisResult.
const AdminMetric = mongoose.model('AdminMetric', adminMetricSchema, 'adminMetrics');
export default AdminMetric;
