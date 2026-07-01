import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════
// chunkUploadController — server side of the Chunk_Upload_Service (Req 33).
//
// Receives ordered Upload_Chunks, recomputes and verifies each chunk's SHA256
// (a chunk is verified IFF its recomputed checksum equals the originally
// computed checksum — Req 33.2, 33.3), tracks the verified set, supports
// pause/resume/cancel (Req 33.8), and enforces a 24-hour resumability window
// (Req 33.6, 33.7). On resume it reports the first unverified chunk index so
// the client resumes without re-uploading already-verified chunks.
//
// Sessions are held in an in-memory store keyed by sessionId and scoped to the
// submitting user (req.userId). This is deliberately storage-light: only chunk
// metadata (index, checksum, verified flag) is retained — the transient chunk
// bytes are verified and discarded, never persisted (privacy boundary).
// ═══════════════════════════════════════════════════════════════════════════

// 24-hour resumability window (Req 33.6, 33.7).
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * In-memory upload session registry.
 * sessionId -> {
 *   sessionId, userId, createdAt, expiresAt, totalChunks, chunkSize,
 *   status: 'in_progress' | 'complete' | 'cancelled',
 *   chunks: Map<index, { sha256: string|null, verified: boolean }>
 * }
 */
const sessions = new Map();

/** Whether a session has passed its 24-hour resumability window (Req 33.7). */
const isExpired = (session) => Date.now() > session.expiresAt;

/** Count of chunks whose recomputed checksum matched (Req 33.9 progress). */
const verifiedCount = (session) => {
  let n = 0;
  for (const chunk of session.chunks.values()) if (chunk.verified) n += 1;
  return n;
};

/**
 * Index of the first unverified chunk, or null when every chunk is verified.
 * Used to resume from the first unverified Upload_Chunk (Req 33.6).
 */
const firstUnverifiedIndex = (session) => {
  for (let i = 0; i < session.totalChunks; i += 1) {
    const chunk = session.chunks.get(i);
    if (!chunk || !chunk.verified) return i;
  }
  return null;
};

/** Build a client-facing progress/status payload for a session (Req 33.9, 33.10). */
const toStatus = (session) => {
  const verified = verifiedCount(session);
  const nextIndex = firstUnverifiedIndex(session);
  const complete = nextIndex === null && session.totalChunks > 0;
  return {
    sessionId: session.sessionId,
    status: session.status,
    totalChunks: session.totalChunks,
    verifiedChunks: verified,
    // Fraction of verified chunks over total, updated per verification (Req 33.9).
    progress: session.totalChunks > 0 ? verified / session.totalChunks : 0,
    // Resume point: first unverified chunk index (Req 33.6); null when done.
    resumeFromIndex: nextIndex,
    complete,
  };
};

/**
 * POST /api/ai/analysis/upload/init
 * Begin a new chunked upload session (Req 33.1). Body: { totalChunks, chunkSize }.
 * Returns the sessionId and the 24h expiry deadline.
 */
export const initUpload = (req, res) => {
  try {
    const userId = req.userId;
    const { totalChunks, chunkSize } = req.body;

    const total = Number(totalChunks);
    if (!Number.isInteger(total) || total <= 0) {
      return res.status(400).json({ code: 'INVALID_CHUNK_COUNT', message: 'totalChunks must be a positive integer' });
    }

    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const session = {
      sessionId,
      userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      totalChunks: total,
      chunkSize: Number(chunkSize) || null,
      status: 'in_progress',
      chunks: new Map(),
    };
    sessions.set(sessionId, session);

    return res.status(201).json({
      sessionId,
      expiresAt: new Date(session.expiresAt).toISOString(),
      ...toStatus(session),
    });
  } catch (error) {
    return res.status(500).json({ code: 'UPLOAD_INIT_FAILED', message: error.message });
  }
};

/**
 * Resolve a session for the requesting user, enforcing ownership and the 24h
 * window. Returns { session } or { error: { status, body } }.
 */
const resolveSession = (req) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session || session.userId?.toString() !== req.userId?.toString()) {
    return { error: { status: 404, body: { code: 'SESSION_NOT_FOUND', message: 'Upload session not found' } } };
  }
  if (session.status === 'cancelled') {
    return { error: { status: 409, body: { code: 'SESSION_CANCELLED', message: 'Upload session was cancelled' } } };
  }
  // 24-hour resumability window expired — require a fresh upload (Req 33.7).
  if (isExpired(session)) {
    sessions.delete(sessionId);
    return { error: { status: 410, body: { code: 'SESSION_EXPIRED', message: 'Upload session has expired; begin a new upload' } } };
  }
  return { session };
};

/**
 * POST /api/ai/analysis/upload/:sessionId/chunk
 * Receive a single Upload_Chunk. Body: { index, data (base64), sha256 }.
 * Recomputes the SHA256 over the received bytes and marks the chunk verified
 * ONLY IF the recomputed checksum equals the provided checksum (Req 33.2, 33.3).
 */
export const uploadChunk = (req, res) => {
  try {
    const { session, error } = resolveSession(req);
    if (error) return res.status(error.status).json(error.body);

    const { index, data, sha256 } = req.body;
    const idx = Number(index);

    if (!Number.isInteger(idx) || idx < 0 || idx >= session.totalChunks) {
      return res.status(400).json({ code: 'INVALID_CHUNK_INDEX', message: 'index is out of range' });
    }
    if (typeof data !== 'string' || typeof sha256 !== 'string' || sha256.length === 0) {
      return res.status(400).json({ code: 'INVALID_CHUNK', message: 'data (base64) and sha256 are required' });
    }

    // Recompute the checksum over the received bytes (Req 33.2).
    const buffer = Buffer.from(data, 'base64');
    const recomputed = crypto.createHash('sha256').update(buffer).digest('hex');

    // Verified IFF recomputed == provided (Req 33.3). Case-insensitive hex compare.
    const verified = recomputed.toLowerCase() === sha256.toLowerCase();

    session.chunks.set(idx, { sha256: recomputed, verified });

    if (!verified) {
      // Report the failed chunk; the client may retry it without re-uploading
      // previously verified chunks (Req 33.4, 33.5).
      return res.status(422).json({
        code: 'CHUNK_VERIFICATION_FAILED',
        message: 'Recomputed checksum did not match the provided checksum',
        index: idx,
        expected: sha256,
        actual: recomputed,
        ...toStatus(session),
      });
    }

    // Mark upload complete once every chunk is verified (Req 33.10).
    const status = toStatus(session);
    if (status.complete) session.status = 'complete';

    return res.json(toStatus(session));
  } catch (error) {
    return res.status(500).json({ code: 'CHUNK_UPLOAD_FAILED', message: error.message });
  }
};

/**
 * GET /api/ai/analysis/upload/:sessionId
 * Report upload status/progress and the resume point (first unverified chunk),
 * enforcing the 24h window (Req 33.6, 33.7, 33.9, 33.10).
 */
export const uploadStatus = (req, res) => {
  const { session, error } = resolveSession(req);
  if (error) return res.status(error.status).json(error.body);
  return res.json(toStatus(session));
};

/**
 * POST /api/ai/analysis/upload/:sessionId/cancel
 * Cancel an in-progress upload: discard every uploaded chunk and release the
 * associated upload storage (Req 33.8).
 */
export const cancelUpload = (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session || session.userId?.toString() !== req.userId?.toString()) {
    return res.status(404).json({ code: 'SESSION_NOT_FOUND', message: 'Upload session not found' });
  }

  // Discard every uploaded chunk and release storage (Req 33.8).
  session.chunks.clear();
  session.status = 'cancelled';
  sessions.delete(sessionId);

  return res.json({ sessionId, status: 'cancelled' });
};

// Exposed for tests: reset the in-memory session store between cases.
export const _resetSessions = () => sessions.clear();
