import { analyzeVideo, getVideoResult } from '../services/aiClient.js';
import mongoose from 'mongoose';

// ── Video Analysis Schema ──
const videoAnalysisSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  videoUrl: String,
  jobId: String,
  status: { type: String, enum: ['queued', 'processing', 'done', 'failed'], default: 'queued' },
  exerciseType: String,
  exerciseDetected: String,
  totalReps: Number,
  formScore: Number,
  feedback: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

const VideoAnalysis = mongoose.model('VideoAnalysis', videoAnalysisSchema);

/**
 * POST /api/ai/video/analyze
 * Submit a video for AI form analysis.
 */
export const submitVideo = async (req, res) => {
  try {
    const userId = req.userId;
    const { videoUrl, exerciseType } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ message: 'videoUrl is required' });
    }

    // Call Python AI service
    const result = await analyzeVideo(videoUrl, exerciseType);

    // Persist the job
    const analysis = await VideoAnalysis.create({
      userId,
      videoUrl,
      jobId: result.job_id,
      status: result.status,
      exerciseType: exerciseType || null,
    });

    return res.json({
      analysisId: analysis._id,
      jobId: result.job_id,
      status: result.status,
    });
  } catch (error) {
    console.error('Video submit error:', error.message);
    return res.status(500).json({ message: 'Failed to submit video', error: error.message });
  }
};

/**
 * GET /api/ai/video/result/:jobId
 * Poll for video analysis results.
 */
export const getResult = async (req, res) => {
  try {
    const { jobId } = req.params;

    // Try AI service first for latest status
    let aiResult;
    try {
      aiResult = await getVideoResult(jobId);
    } catch {
      // Fall back to DB
    }

    if (aiResult && aiResult.status === 'done') {
      // Update DB record
      await VideoAnalysis.findOneAndUpdate(
        { jobId },
        {
          status: 'done',
          exerciseDetected: aiResult.exercise_detected,
          totalReps: aiResult.total_reps,
          formScore: aiResult.form_score,
          feedback: aiResult.feedback,
        },
      );
    }

    // Return from DB (has userId association)
    const record = await VideoAnalysis.findOne({ jobId, userId: req.userId }).lean();
    if (!record) return res.status(404).json({ message: 'Analysis not found' });

    return res.json(record);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to get result', error: error.message });
  }
};

/**
 * GET /api/ai/video/history
 * Get all video analyses for the user.
 */
export const getHistory = async (req, res) => {
  try {
    const analyses = await VideoAnalysis.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    return res.json(analyses);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load history', error: error.message });
  }
};
