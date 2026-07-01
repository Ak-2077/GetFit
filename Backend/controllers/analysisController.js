import {
  submitAnalysis,
  getAnalysisStatus,
  getAnalysisResult,
  cancelAnalysis,
} from '../services/aiClient.js';
import AnalysisResult from '../models/analysisResult.js';

// ═══════════════════════════════════════════════════════════════════════════
// analysisController — Node/Express integration for the AI exercise-analysis
// pipeline. Extends the conventions in videoController.js (ESM, req.userId,
// try/catch). Persistence is bounded by the AnalysisResult model: only the
// permitted fields are stored, associated with the submitting user (Req 13.4).
// The original video, frames, and pose images are NEVER persisted (Req 13.2).
// AI/pipeline errors are surfaced to the client as { code, message } ONLY,
// never stack traces or internal detail (Req 15.6, 18.3).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map an AI-service / pipeline error to a sanitized { code, message } payload.
 * Surfaces ONLY a stable code and human-readable message — no stack traces or
 * internal detail (Req 15.6, 18.3). Pulls the structured error out of an axios
 * error response when present, otherwise falls back to a generic code.
 * @returns {{ status: number, body: { code: string, message: string } }}
 */
const toSanitizedError = (error) => {
  const data = error?.response?.data;

  // The AI service returns a Structured_Error carrying code + message. It may
  // arrive directly on the body or nested under `detail`/`error`.
  const structured = data?.detail ?? data?.error ?? data;

  const code =
    (structured && (structured.code || structured.error_code)) ||
    'ANALYSIS_ERROR';
  const message =
    (structured && (structured.message || (typeof structured === 'string' ? structured : null))) ||
    'Analysis request failed';

  // Preserve the upstream HTTP status when available; default to 502 (bad
  // gateway) for AI-service failures and 500 for unexpected errors.
  const status = error?.response?.status || (error?.response ? 502 : 500);

  return { status, body: { code: String(code), message: String(message) } };
};

/**
 * Normalize the AI AnalysisResult payload (snake_case contract) into the
 * bounded persisted shape. EXPLICITLY excludes videoUrl, frames, and pose
 * images (Req 13.2) — they are never copied out of the AI payload.
 */
const toBoundedResult = (userId, jobId, ai = {}) => ({
  userId,
  jobId,
  exerciseId: ai.exercise_id ?? ai.exerciseId ?? '',
  overallScore: ai.overall_score ?? ai.overallScore ?? 0,
  scores: {
    movementScore: ai.movement_score ?? ai.movementScore,
    rangeOfMotion: ai.range_of_motion ?? ai.rangeOfMotion,
    tempo: ai.tempo,
    stability: ai.stability,
    symmetry: ai.symmetry,
    jointAlignment: ai.joint_alignment ?? ai.jointAlignment,
  },
  feedback: {
    strengths: ai.strengths ?? [],
    mistakes: ai.mistakes ?? [],
    corrections: ai.corrections ?? [],
    safetyWarnings: ai.safety_warnings ?? ai.safetyWarnings ?? [],
    improvementTips: ai.improvement_tips ?? ai.improvementTips ?? [],
    trainingAdvice: ai.training_advice ?? ai.trainingAdvice ?? [],
  },
  movementMetrics: ai.movement_metrics ?? ai.movementMetrics ?? {},
  repetitionSummary: ai.repetition_summary ?? ai.repetitionSummary ?? {},
  overallConfidence: ai.overall_confidence ?? ai.overallConfidence ?? 0,
  lowConfidence: ai.low_confidence ?? ai.lowConfidence ?? false,
  versions: {
    analysisVersion: ai.analysisVersion ?? ai.analysis_version ?? '',
    poseEngineVersion: ai.poseEngineVersion ?? ai.pose_engine_version ?? '',
    visionModelVersion: ai.visionModelVersion ?? ai.vision_model_version ?? '',
    reasoningModelVersion:
      ai.reasoningModelVersion ?? ai.reasoning_model_version ?? '',
    pipelineVersion: ai.pipelineVersion ?? ai.pipeline_version ?? '',
  },
});

/**
 * POST /api/ai/analysis/submit
 * Enqueue an Analysis_Job and return its Job_Id immediately (Req 18.2, 19.1).
 */
export const submit = async (req, res) => {
  try {
    const { videoUrl, exerciseHint, videoSha256 } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ code: 'VIDEO_URL_REQUIRED', message: 'videoUrl is required' });
    }

    const data = await submitAnalysis(videoUrl, exerciseHint ?? null, videoSha256 ?? null);
    // The AI service returns snake_case (`job_id`); tolerate either shape.
    const jobId = data?.jobId ?? data?.job_id;
    if (!jobId) {
      return res.status(502).json({ code: 'NO_JOB_ID', message: 'AI service did not return a job id' });
    }
    return res.json({ jobId });
  } catch (error) {
    const { status, body } = toSanitizedError(error);
    return res.status(status).json(body);
  }
};

/**
 * GET /api/ai/analysis/status/:jobId
 * Query the lifecycle state and progress of an Analysis_Job (Req 19.8, 20.4).
 */
export const status = async (req, res) => {
  try {
    const { jobId } = req.params;
    const result = await getAnalysisStatus(jobId);
    return res.json({
      // The AI service returns `state`; tolerate the other shapes too.
      jobState: result.jobState ?? result.job_state ?? result.state ?? result.status,
      progress: result.progress ?? null,
      // Forward the sanitized error so the client shows the real failure reason.
      error: result.error ?? null,
    });
  } catch (error) {
    const { status: httpStatus, body } = toSanitizedError(error);
    return res.status(httpStatus).json(body);
  }
};

/**
 * POST /api/ai/analysis/cancel/:jobId
 * Cancel a queued or in-flight Analysis_Job (runtime reliability). Proxies to
 * the AI service and surfaces its outcome.
 */
export const cancel = async (req, res) => {
  try {
    const { jobId } = req.params;
    const result = await cancelAnalysis(jobId);
    return res.json({
      jobId: result.job_id ?? result.jobId ?? jobId,
      cancelled: result.cancelled ?? false,
      jobState: result.state ?? result.jobState ?? 'cancelled',
    });
  } catch (error) {
    const { status: httpStatus, body } = toSanitizedError(error);
    return res.status(httpStatus).json(body);
  }
};

/**
 * GET /api/ai/analysis/result/:jobId
 * Fetch the AnalysisResult for a completed job. On completion, persist the
 * bounded result associated with the user (Req 13.1, 13.4) — excluding
 * videoUrl/frames/pose (Req 13.2) — and return the persisted record.
 */
export const result = async (req, res) => {
  try {
    const userId = req.userId;
    const { jobId } = req.params;

    const aiResult = await getAnalysisResult(jobId);

    // The AI service returns { job_id, state, result, error }. Read the
    // lifecycle state and the nested AnalysisResult payload robustly.
    const state =
      aiResult?.state ?? aiResult?.jobState ?? aiResult?.job_state ?? aiResult?.status;
    const payload = aiResult?.result ?? aiResult?.analysisResult ?? aiResult;

    const completed = state
      ? state === 'completed'
      : Boolean(
          payload?.exercise_id ?? payload?.exerciseId ??
          payload?.overall_score ?? payload?.overallScore
        );

    if (!completed) {
      // Not finished yet — surface the current lifecycle state without persisting.
      // On a failed/cancelled job, forward the sanitized error so the client
      // can show a friendly message.
      return res.json({
        jobState: state ?? 'processing',
        progress: aiResult?.progress ?? null,
        error: aiResult?.error ?? null,
      });
    }

    const bounded = toBoundedResult(userId, jobId, payload);

    // Upsert by (userId, jobId) so repeated polls don't create duplicates and
    // any previously stored user corrections are preserved.
    const persisted = await AnalysisResult.findOneAndUpdate(
      { userId, jobId },
      { $set: bounded },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    return res.json(persisted);
  } catch (error) {
    const { status: httpStatus, body } = toSanitizedError(error);
    return res.status(httpStatus).json(body);
  }
};

/**
 * POST /api/ai/analysis/:id/correction
 * Store an End_User correction on the AnalysisResult identified by :id,
 * scoped to the requesting user (Req 13.3).
 */
export const correction = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { correction: userCorrection } = req.body;

    if (userCorrection === undefined || userCorrection === null) {
      return res.status(400).json({ code: 'CORRECTION_REQUIRED', message: 'correction is required' });
    }

    const updated = await AnalysisResult.findOneAndUpdate(
      { _id: id, userId },
      { $push: { userCorrections: userCorrection } },
      { new: true },
    ).lean();

    if (!updated) {
      return res.status(404).json({ code: 'RESULT_NOT_FOUND', message: 'Analysis result not found' });
    }

    return res.json(updated);
  } catch (error) {
    const { status: httpStatus, body } = toSanitizedError(error);
    return res.status(httpStatus).json(body);
  }
};
