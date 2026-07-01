import AnalysisResult from '../models/analysisResult.js';

// ═══════════════════════════════════════════════════════════════════════════
// duplicateStore — replaceable prior-result lookup for Duplicate Detection
// (Req 34.2, 34.7).
//
// This is the Node/Backend implementation of the DuplicateStore lookup: it
// queries the EXISTING AnalysisResult collection by the exact triple
// (userId, videoHash, pipelineVersion). It operates on the video HASH ONLY —
// the original video is never stored, transmitted, or read here (privacy
// boundary, Req 13.2 / 52.5).
//
// Graceful degradation (Req 34.7): if the store is unavailable (query error)
// or the lookup key is incomplete, this returns null so the caller can let the
// analysis pipeline run normally and record a bypass indication.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find a prior AnalysisResult whose End_User identifier, Video_Hash, and
 * pipeline version are all exactly equal to the submitted video's (Req 34.2).
 *
 * @param {string} userId - End_User identifier.
 * @param {string} videoHash - Local SHA256 Video_Hash (hash only, never the video).
 * @param {string} pipelineVersion - Pipeline version component of the match key.
 * @returns {Promise<Object|null>} The matching prior result, or null on miss,
 *   incomplete key, or store unavailability (graceful bypass, Req 34.7).
 */
export const findByUserHashVersion = async (userId, videoHash, pipelineVersion) => {
  // An incomplete key can never form an exact triple match (Req 34.2).
  if (!userId || !videoHash || !pipelineVersion) return null;

  try {
    const match = await AnalysisResult.findOne({
      userId,
      videoHash,
      pipelineVersion,
    }).lean();

    return match || null;
  } catch (error) {
    // Store unavailable — degrade gracefully so the pipeline runs normally
    // and the caller records a bypass indication (Req 34.7).
    console.error('[duplicateStore] lookup failed, bypassing duplicate check:', error.message);
    return null;
  }
};

export default { findByUserHashVersion };
