import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';

// ═══════════════════════════════════════════════════════════════════════════
// videoUploadController — temporary server storage for exercise-analysis videos
// (runtime pipeline, frontend integration).
//
// The mobile app uploads a recorded video here via multipart/form-data (field
// "video"); it is stored in a transient server-side directory and exposed at a
// fetchable URL. The AI worker then DOWNLOADS the video from that URL, probes
// it, analyzes it, and deletes its own transient copy immediately after
// processing (handled in the AI service).
//
// This server-side temp file is short-lived: it is removed after a TTL and/or
// when the upstream analysis completes, so no recording lingers (Req 1.x, 12.x).
// ═══════════════════════════════════════════════════════════════════════════

// Transient upload directory (created lazily). Overridable via env.
const UPLOAD_DIR =
  process.env.ANALYSIS_UPLOAD_DIR || path.join(os.tmpdir(), 'getfit-analysis-uploads');

// How long an unconsumed upload is retained before automatic deletion.
const UPLOAD_TTL_MS = Number(process.env.ANALYSIS_UPLOAD_TTL_MS || 60 * 60 * 1000); // 1h

// Max accepted upload size (bytes) — mirrors the AI service video size bound.
const MAX_UPLOAD_BYTES = Number(process.env.ANALYSIS_MAX_UPLOAD_BYTES || 200 * 1024 * 1024); // 200MB

const MIME_EXT = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'application/octet-stream': '.mp4',
};

const ensureDir = () => {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
};

const extFor = (file) => {
  const byMime = MIME_EXT[(file.mimetype || '').toLowerCase()];
  if (byMime) return byMime;
  const byName = path.extname(file.originalname || '').toLowerCase();
  return byName === '.mov' ? '.mov' : '.mp4';
};

const safeUnlink = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('[videoUpload] failed to delete temp file:', err.message);
  }
};

// Compute the SHA-256 hex digest of an uploaded file. Streamed so a large
// video never has to be held in memory. Returns null on any read failure so a
// hashing problem never blocks the upload (integrity check is best-effort at
// this boundary; the AI service enforces it when the digest is present).
const sha256OfFile = (filePath) =>
  new Promise((resolve) => {
    try {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => {
        console.warn('[videoUpload] failed to hash upload:', err.message);
        resolve(null);
      });
    } catch (err) {
      console.warn('[videoUpload] failed to hash upload:', err.message);
      resolve(null);
    }
  });

// ── Multer storage: stream the upload straight to disk with an opaque id ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      ensureDir();
      cb(null, UPLOAD_DIR);
    } catch (err) {
      cb(err, UPLOAD_DIR);
    }
  },
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(16).toString('hex');
    req._uploadId = id; // surfaced to the handler for the response URL
    cb(null, `${id}${extFor(file)}`);
  },
});

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = ['video/mp4', 'video/quicktime', 'application/octet-stream'].includes(
      (file.mimetype || '').toLowerCase()
    );
    cb(null, ok);
  },
}).single('video');

const findById = (id) => {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  ensureDir();
  for (const ext of ['.mp4', '.mov']) {
    const candidate = path.join(UPLOAD_DIR, `${id}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const publicBaseUrl = (req) =>
  (process.env.MEDIA_PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

/**
 * POST /api/ai/analysis/media/upload   (multipart/form-data, field "video")
 * Returns { id, videoUrl, expiresInMs }. The client then passes `videoUrl` as
 * `videoUrl` to POST /api/ai/analysis/submit.
 */
export const uploadVideo = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        code: 'EMPTY_UPLOAD',
        message: 'No video file received. Send multipart/form-data with a "video" field.',
      });
    }

    const id = req._uploadId || path.basename(req.file.filename, path.extname(req.file.filename));
    const filePath = req.file.path;

    // Auto-delete after the TTL if it is never fetched/consumed.
    const timer = setTimeout(() => safeUnlink(filePath), UPLOAD_TTL_MS);
    if (typeof timer.unref === 'function') timer.unref();

    const videoUrl = `${publicBaseUrl(req)}/api/ai/analysis/media/video/${id}`;

    // Compute the integrity digest, then respond. Hashing is best-effort: if it
    // fails we still return the upload (sha256 omitted) so a hashing hiccup
    // never blocks analysis; the AI service only enforces the digest when set.
    sha256OfFile(filePath)
      .then((sha256) => {
        return res.status(201).json({
          id,
          videoUrl,
          sizeBytes: req.file.size,
          sha256: sha256 || undefined,
          expiresInMs: UPLOAD_TTL_MS,
        });
      })
      .catch(() =>
        res.status(201).json({
          id,
          videoUrl,
          sizeBytes: req.file.size,
          expiresInMs: UPLOAD_TTL_MS,
        })
      );
  } catch (error) {
    return res.status(500).json({ code: 'UPLOAD_FAILED', message: error.message });
  }
};

/**
 * GET /api/ai/analysis/media/video/:id
 * Streams the stored video so the AI worker can download it. Intended for
 * internal service-to-service fetch; the id is an unguessable opaque token.
 */
export const serveVideo = (req, res) => {
  const { id } = req.params;
  const filePath = findById(id);
  if (!filePath) {
    return res.status(404).json({ code: 'VIDEO_NOT_FOUND', message: 'Upload not found or expired.' });
  }
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', ext === '.mov' ? 'video/quicktime' : 'video/mp4');
  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    if (!res.headersSent) res.status(500).json({ code: 'STREAM_FAILED', message: err.message });
  });
  stream.pipe(res);
};

// Exposed for tests / manual cleanup.
export const _uploadDir = () => UPLOAD_DIR;
