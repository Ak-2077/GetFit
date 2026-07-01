import express from 'express';
import auth from '../middleware/authMiddleware.js';
import {
  initUpload,
  uploadChunk,
  uploadStatus,
  cancelUpload,
} from '../controllers/chunkUploadController.js';

// ═══════════════════════════════════════════════════════════════════════════
// Chunked upload routes (Req 33) — additive, mounted at /api/ai/analysis/upload
// in index.js WITHOUT changing any existing route. All routes are protected by
// the existing JWT auth middleware (sets req.userId) and scoped to that user.
// ═══════════════════════════════════════════════════════════════════════════

const router = express.Router();

router.post('/init', auth, initUpload);
router.post('/:sessionId/chunk', auth, uploadChunk);
router.get('/:sessionId', auth, uploadStatus);
router.post('/:sessionId/cancel', auth, cancelUpload);

export default router;
