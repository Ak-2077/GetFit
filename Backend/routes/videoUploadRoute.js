import express from 'express';
import auth from '../middleware/authMiddleware.js';
import { uploadMiddleware, uploadVideo, serveVideo } from '../controllers/videoUploadController.js';

// ═══════════════════════════════════════════════════════════════════════════
// Video upload routes (runtime pipeline) — additive, mounted at
// /api/ai/analysis/media in index.js WITHOUT changing any existing route.
//
//   POST /api/ai/analysis/media/upload      — authenticated multipart upload
//                                             (field "video"); returns videoUrl
//   GET  /api/ai/analysis/media/video/:id   — internal fetch for the AI worker
//
// The GET is intentionally unauthenticated (service-to-service fetch by the AI
// worker) and guarded only by the unguessable opaque id.
// ═══════════════════════════════════════════════════════════════════════════

const router = express.Router();

// Translate multer errors (e.g. file too large) into clean JSON responses.
const handleUpload = (req, res, next) => {
  uploadMiddleware(req, res, (err) => {
    if (err) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        code: tooLarge ? 'VIDEO_TOO_LARGE' : 'UPLOAD_FAILED',
        message: tooLarge
          ? 'The video is too large to upload. Please record a shorter clip.'
          : err.message || 'Upload failed.',
      });
    }
    next();
  });
};

router.post('/upload', auth, handleUpload, uploadVideo);
router.get('/video/:id', serveVideo);

export default router;
