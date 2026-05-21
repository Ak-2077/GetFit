import UserMemory from '../models/userMemory.js';

// ═══════════════════════════════════════════════════════════════
// MEMORY TRUTH ENGINE — Continuous memory verification
// Prevents long-term memory corruption and false assumptions.
// Tracks evidence, reinforcement, contradictions, and truth decay.
// ═══════════════════════════════════════════════════════════════

const SOURCE_RELIABILITY = {
  explicit_user_statement: 1.0,
  user_confirmed: 0.95,
  feedback_learning: 0.8,
  ai_extracted: 0.65,
  system_generated: 0.6,
  inferred_behavior: 0.4,
  extracted: 0.6,
  profile_sync: 0.7,
  feedback: 0.75,
};

/**
 * Reinforce a memory — increases evidence count and confidence.
 * Called when a fact is independently confirmed in a new session.
 */
export const reinforceMemory = async (memoryId, sessionId, source = 'ai_extracted') => {
  const mem = await UserMemory.findById(memoryId);
  if (!mem) return null;

  const prevConfidence = mem.confidence;
  mem.evidenceCount++;
  mem.confidence = Math.min(1.0, mem.confidence + 0.05);
  mem.sourceReliability = Math.max(mem.sourceReliability, SOURCE_RELIABILITY[source] || 0.5);

  mem.reinforcementHistory.push({
    sessionId,
    source,
    confidenceDelta: mem.confidence - prevConfidence,
  });

  // Keep only last 20 reinforcements
  if (mem.reinforcementHistory.length > 20) {
    mem.reinforcementHistory = mem.reinforcementHistory.slice(-20);
  }

  // Update confidence trend
  mem.confidenceTrend = _computeConfidenceTrend(mem.reinforcementHistory, mem.contradictionHistory);
  mem.truthScore = _computeTruthScore(mem);
  mem.lastVerifiedAt = new Date();
  mem.verificationCount++;
  mem.needsVerification = false;

  await mem.save();
  return mem;
};

/**
 * Record a contradiction against a memory.
 */
export const recordContradiction = async (memoryId, contradictingFact, sessionId) => {
  const mem = await UserMemory.findById(memoryId);
  if (!mem) return null;

  mem.contradictionHistory.push({
    contradictingFact,
    sessionId,
    resolution: 'unresolved',
  });

  // Keep last 10 contradictions
  if (mem.contradictionHistory.length > 10) {
    mem.contradictionHistory = mem.contradictionHistory.slice(-10);
  }

  // Decrease confidence
  mem.confidence = Math.max(0.1, mem.confidence - 0.1);
  mem.confidenceTrend = _computeConfidenceTrend(mem.reinforcementHistory, mem.contradictionHistory);
  mem.truthScore = _computeTruthScore(mem);

  // Flag for verification if too many contradictions
  const unresolvedCount = mem.contradictionHistory.filter(c => c.resolution === 'unresolved').length;
  if (unresolvedCount >= 2) {
    mem.needsVerification = true;
  }

  await mem.save();
  return mem;
};

/**
 * Get memories that need verification.
 * These are important memories with declining confidence or unresolved contradictions.
 */
export const getMemoriesNeedingVerification = async (userId, limit = 10) => {
  return UserMemory.find({
    userId,
    active: true,
    $or: [
      { needsVerification: true },
      { confidenceTrend: { $lt: -0.3 }, importanceScore: { $gte: 6 } },
      { truthScore: { $lt: 0.4 }, importanceScore: { $gte: 5 } },
      // Old important memories never verified
      {
        importanceScore: { $gte: 7 },
        lastVerifiedAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    ],
  })
    .sort({ importanceScore: -1, truthScore: 1 })
    .limit(limit)
    .lean();
};

/**
 * Run periodic truth decay — memories that haven't been reinforced lose confidence.
 * Called during consolidation.
 */
export const applyTruthDecay = async (userId) => {
  const staleThreshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days
  const importantMemories = await UserMemory.find({
    userId,
    active: true,
    memoryLevel: { $in: [1, 2] },
    lastVerifiedAt: { $lt: staleThreshold },
    source: { $nin: ['explicit_user_statement', 'user_confirmed'] },
  });

  let decayed = 0;
  for (const mem of importantMemories) {
    // Slow decay for unverified important memories
    const daysSinceVerified = (Date.now() - new Date(mem.lastVerifiedAt || mem.createdAt).getTime()) / (24 * 60 * 60 * 1000);
    const decayRate = 0.002 * Math.log(daysSinceVerified + 1); // logarithmic decay
    mem.confidence = Math.max(0.2, mem.confidence - decayRate);
    mem.truthScore = _computeTruthScore(mem);

    if (mem.confidence < 0.4 && mem.importanceScore >= 7) {
      mem.needsVerification = true;
    }

    await mem.save();
    decayed++;
  }

  return { decayed };
};

/**
 * Verify a memory — mark it as verified with timestamp.
 * Called when AI or user confirms the fact is still true.
 */
export const verifyMemory = async (memoryId) => {
  const mem = await UserMemory.findById(memoryId);
  if (!mem) return null;

  mem.lastVerifiedAt = new Date();
  mem.verificationCount++;
  mem.confidence = Math.min(1.0, mem.confidence + 0.03);
  mem.truthScore = _computeTruthScore(mem);
  mem.needsVerification = false;

  await mem.save();
  return mem;
};

/**
 * Get overall memory health for a user.
 */
export const getMemoryHealth = async (userId) => {
  const memories = await UserMemory.find({ userId, active: true }).lean();
  if (memories.length === 0) return { health: 1.0, total: 0 };

  const now = Date.now();
  const STALE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

  const avgTruth = memories.reduce((s, m) => s + (m.truthScore || 0.7), 0) / memories.length;
  const needsVerification = memories.filter(m => m.needsVerification).length;
  const lowConfidence = memories.filter(m => (m.confidence || 0.8) < 0.4).length;
  const contradicted = memories.filter(m => (m.contradictionHistory || []).some(c => c.resolution === 'unresolved')).length;

  // Stale ratio
  const stale = memories.filter(m => {
    const age = now - new Date(m.updatedAt || m.createdAt).getTime();
    return age > STALE_MS;
  }).length;

  // Duplicate detection (same category + high content similarity by length)
  const contentMap = new Map();
  let duplicates = 0;
  for (const m of memories) {
    const key = `${m.category}:${(m.content || '').substring(0, 40).toLowerCase().trim()}`;
    if (contentMap.has(key)) duplicates++;
    else contentMap.set(key, true);
  }

  // Growth rate (memories added in last 7 / 30 days)
  const addedLastWeek = memories.filter(m => now - new Date(m.createdAt).getTime() < WEEK_MS).length;
  const addedLastMonth = memories.filter(m => now - new Date(m.createdAt).getTime() < MONTH_MS).length;

  // Category breakdown
  const categories = {};
  for (const m of memories) {
    categories[m.category || 'unknown'] = (categories[m.category || 'unknown'] || 0) + 1;
  }

  return {
    health: avgTruth,
    total: memories.length,
    needsVerification,
    lowConfidence,
    contradicted,
    avgConfidence: memories.reduce((s, m) => s + (m.confidence || 0.8), 0) / memories.length,
    staleCount: stale,
    staleRatio: `${(stale / memories.length * 100).toFixed(1)}%`,
    duplicates,
    growth: { lastWeek: addedLastWeek, lastMonth: addedLastMonth },
    categories,
  };
};

// ── Internal Helpers ──

function _computeConfidenceTrend(reinforcements, contradictions) {
  const recent = 30 * 24 * 60 * 60 * 1000; // 30 days
  const now = Date.now();

  const recentReinforcements = (reinforcements || []).filter(r => now - new Date(r.timestamp).getTime() < recent).length;
  const recentContradictions = (contradictions || []).filter(c => now - new Date(c.timestamp).getTime() < recent).length;

  if (recentReinforcements + recentContradictions === 0) return 0;
  return (recentReinforcements - recentContradictions) / (recentReinforcements + recentContradictions);
}

function _computeTruthScore(mem) {
  const evidenceWeight = Math.min(1, (mem.evidenceCount || 1) / 5) * 0.3;
  const confidenceWeight = (mem.confidence || 0.7) * 0.3;
  const sourceWeight = (mem.sourceReliability || 0.6) * 0.2;
  const trendWeight = ((mem.confidenceTrend || 0) + 1) / 2 * 0.1; // normalize -1..1 to 0..1
  const verificationWeight = mem.lastVerifiedAt ? 0.1 : 0;

  return Math.min(1, evidenceWeight + confidenceWeight + sourceWeight + trendWeight + verificationWeight);
}
