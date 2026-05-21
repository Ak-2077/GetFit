import UserMemory from "../models/userMemory.js";
import UserLearningProfile from "../models/userLearningProfile.js";
import { extractMemories, embedText, embedBatch, compileMemories } from "./aiClient.js";

// ═══════════════════════════════════════════════════════════════
// MEMORY SERVICE — Production-level with embedding retrieval,
// memory compiler, hierarchy-aware operations, episodic memory
// ═══════════════════════════════════════════════════════════════

/**
 * Save extracted memories with hierarchy, importance, source trust, and conflict resolution.
 */
export const saveMemories = async (userId, memories, sessionId) => {
  const results = { created: 0, updated: 0, superseded: 0 };

  for (const mem of memories) {
    try {
      // Memory Safety: validate before saving
      const validation = validateMemory(mem.fact, mem.category);
      if (!validation.valid) continue;

      // Memory Sandboxing: quarantine uncertain/emotional memories
      if (shouldQuarantine(mem.fact, mem.category, mem.confidence, mem.source_type)) {
        await saveToQuarantine(userId, mem, sessionId);
        continue;
      }

      // Check for exact match
      const exactMatch = await UserMemory.findOne({ userId, fact: mem.fact, active: true });

      if (exactMatch) {
        exactMatch.confidence = Math.min(1.0, exactMatch.confidence + 0.05);
        exactMatch.hitCount += 1;
        exactMatch.relevanceScore = Math.min(2.0, exactMatch.relevanceScore + 0.15);
        exactMatch.lastAccessedAt = new Date();
        await exactMatch.save();
        results.updated++;
        continue;
      }

      // Check for conflicting evolving fact (embedding similarity or keyword overlap)
      const evolvingCategories = ["body_stats", "goal", "routine", "progress", "nutrition"];
      if (evolvingCategories.includes(mem.category)) {
        const existingInCategory = await UserMemory.find({
          userId, category: mem.category, active: true, memoryType: "evolving",
        }).lean();

        let superseded = false;
        for (const existing of existingInCategory) {
          // Try embedding similarity first, fallback to Jaccard
          let similarity = calculateOverlap(existing.fact, mem.fact);
          if (existing.embedding && existing.embedding.length > 0) {
            try {
              const newEmbed = await embedText(mem.fact);
              similarity = cosineSimilarity(existing.embedding, newEmbed.embedding);
            } catch (_) { /* embedding failed, use Jaccard */ }
          }
          if (similarity > 0.5) {
            const oldMem = await UserMemory.findById(existing._id);
            await oldMem.supersede(mem.fact, sessionId);
            results.superseded++;
            superseded = true;
            break;
          }
        }
        if (superseded) continue;
      }

      // Determine TTL for temporal memories
      const level = mem.memory_level || getMemoryLevel(mem.category);
      const memoryType = mem.memory_type || getMemoryType(mem.category);
      let expiresAt = null;
      if (level === 3 || memoryType === "temporal") {
        const hours = mem.importance <= 2 ? 24 : mem.importance <= 4 ? 48 : 72;
        expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      }

      // Generate embedding (non-blocking fallback)
      let embedding = [];
      try {
        const embedResult = await embedText(mem.fact);
        embedding = embedResult.embedding || [];
      } catch (_) { /* embedding unavailable — save without */ }

      // Map source_type to DB enum
      const sourceMap = {
        explicit_user_statement: "explicit_user_statement",
        ai_extracted: "ai_extracted",
        inferred_behavior: "inferred_behavior",
      };

      await UserMemory.create({
        userId,
        category: mem.category,
        memoryType,
        memoryLevel: level,
        fact: mem.fact,
        importanceScore: Math.max(0, Math.min(10, mem.importance || 5)),
        confidence: mem.confidence || 0.8,
        embedding,
        sourceSessionId: sessionId,
        source: sourceMap[mem.source_type] || "ai_extracted",
        expiresAt,
      });
      results.created++;
    } catch (err) {
      if (err.code !== 11000) {
        console.warn("Memory save error:", err.message);
      }
    }
  }

  return results;
};

/**
 * Dynamic attention weight profiles — adjust retrieval blend by context.
 */
const ATTENTION_PROFILES = {
  // intent → { semanticWeight, categoryBoost, importanceFloor }
  injury_concern:      { semantic: 0.3, composite: 0.7, boostCategories: ['injury', 'limitation'], importanceFloor: 5 },
  workout_planning:    { semantic: 0.4, composite: 0.6, boostCategories: ['routine', 'body_stats', 'goal', 'injury'], importanceFloor: 3 },
  nutrition_question:  { semantic: 0.5, composite: 0.5, boostCategories: ['nutrition', 'preference', 'body_stats'], importanceFloor: 3 },
  progress_analysis:   { semantic: 0.3, composite: 0.7, boostCategories: ['progress', 'achievement', 'body_stats'], importanceFloor: 2 },
  emotional_support:   { semantic: 0.5, composite: 0.5, boostCategories: ['preference', 'goal'], importanceFloor: 1 },
  memory_recall:       { semantic: 0.7, composite: 0.3, boostCategories: [], importanceFloor: 0 },
  casual_chat:         { semantic: 0.6, composite: 0.4, boostCategories: ['preference'], importanceFloor: 0 },
  default:             { semantic: 0.4, composite: 0.6, boostCategories: [], importanceFloor: 0 },
};

/**
 * Get memories for chat — embedding-based retrieval + dynamic attention + memory compiler.
 * @param {string} userId
 * @param {string} userMessage - current user message for semantic search
 * @param {string} intent - classified intent for dynamic attention weights
 * @param {object} userStateMeta - optional { injuryRisk, fatigue } for boosting safety memories
 * @returns {{ compiled: string, flat: string[], raw: object[], analytics: object }}
 */
export const getMemoriesForChat = async (userId, userMessage = "", intent = "coaching", userStateMeta = null) => {
  // Apply hierarchy-aware decay
  await UserMemory.applyDecay(userId);

  // Get all active memories with composite scoring
  let memories = await UserMemory.getActiveMemories(userId, 50);

  // ── STALENESS PRUNING: Remove memories older than 90 days with low importance ──
  const STALE_DAYS = 90;
  const now = Date.now();
  memories = memories.filter(m => {
    const ageMs = now - new Date(m.updatedAt || m.createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // Keep if: recent, high importance, or high-priority category
    if (ageDays < 14) return true; // always keep recent
    if ((m.importanceScore || 5) >= 7) return true; // always keep important
    const priorityCats = ['injury', 'limitation', 'goal', 'body_stats', 'routine'];
    if (priorityCats.includes(m.category)) return true; // always keep critical categories
    if (ageDays > STALE_DAYS && (m.importanceScore || 5) < 4) return false; // prune stale+low
    return true;
  });

  // Dynamic attention weights based on intent
  const attention = { ...(ATTENTION_PROFILES[intent] || ATTENTION_PROFILES.default) };
  attention.boostCategories = [...(attention.boostCategories || [])];

  // Boost injury/limitation memories when injury risk is elevated
  if (userStateMeta?.injuryRisk > 0.4) {
    attention.boostCategories = [...new Set([...attention.boostCategories, 'injury', 'limitation'])];
  }
  // Boost fatigue-related memories when fatigue is high
  if (userStateMeta?.fatigue > 0.6) {
    attention.boostCategories = [...new Set([...attention.boostCategories, 'routine', 'recovery'])];
  }

  // If user message provided and we have embeddings, re-rank with dynamic blend
  if (userMessage && memories.length > 0) {
    const memoriesWithEmbedding = memories.filter(m => m.embedding && m.embedding.length > 0);

    if (memoriesWithEmbedding.length > 3) {
      try {
        const queryEmbed = await embedText(userMessage);
        for (const mem of memories) {
          let semScore = 0;
          if (mem.embedding && mem.embedding.length > 0) {
            semScore = cosineSimilarity(queryEmbed.embedding, mem.embedding);
          }

          // Dynamic blend using attention weights
          let score = (mem.compositeScore || 0.5) * attention.composite + semScore * attention.semantic;

          // Category boost
          if (attention.boostCategories.includes(mem.category)) {
            score *= 1.3;
          }

          // Importance floor filter
          if ((mem.importanceScore || 5) < attention.importanceFloor) {
            score *= 0.5;
          }

          // ── RECENCY BOOST: memories from last 7 days get a 20% boost ──
          const memAge = now - new Date(mem.updatedAt || mem.createdAt).getTime();
          if (memAge < 7 * 24 * 60 * 60 * 1000) score *= 1.2;
          else if (memAge < 30 * 24 * 60 * 60 * 1000) score *= 1.05;

          // ── CONFIRMATION BOOST: user-confirmed memories rank higher ──
          if (mem.confirmed) score *= 1.15;

          mem.finalScore = score;
        }
        memories.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));
      } catch (_) { /* embedding unavailable — keep composite ranking */ }
    }
  }

  // Intent-based memory limits — fewer memories = faster compilation + less tokens
  const INTENT_MEMORY_LIMITS = {
    casual_chat: 8,
    memory_recall: 20,
    motivation: 10,
    emotional_support: 12,
    coaching: 20,
    factual_query: 15,
    form_correction: 15,
    workout_planning: 25,
    nutrition_question: 25,
    progress_analysis: 25,
    injury_concern: 30,
  };
  const INTENT_COMPILE_BUDGET = {
    casual_chat: 100,
    motivation: 120,
    emotional_support: 150,
    coaching: 200,
    factual_query: 200,
    workout_planning: 300,
    nutrition_question: 300,
    progress_analysis: 250,
    injury_concern: 300,
  };

  const memLimit = INTENT_MEMORY_LIMITS[intent] || 20;
  const compileBudget = INTENT_COMPILE_BUDGET[intent] || 200;
  memories = memories.slice(0, memLimit);
  const flat = memories.map(m => m.fact);

  // Compile memories into optimized context (reduces token usage)
  let compiled = "";
  let tokensSaved = 0;
  if (flat.length > 5) {
    try {
      const compileResult = await compileMemories(flat, compileBudget);
      compiled = compileResult.compiled;
      const rawTokens = flat.join("\n").length / 4;
      tokensSaved = Math.max(0, Math.round(rawTokens - compileResult.token_estimate));
    } catch (_) {
      // Compiler unavailable — use raw concatenation (truncated)
      compiled = flat.slice(0, 15).map(f => `- ${f}`).join("\n");
    }
  } else {
    compiled = flat.map(f => `- ${f}`).join("\n");
  }

  return {
    compiled,
    flat,
    raw: memories,
    analytics: { totalRetrieved: memories.length, tokensSaved },
  };
};

/**
 * Record that memories were accessed (boost their relevance).
 */
export const recordMemoryAccess = async (memoryIds) => {
  if (!memoryIds || memoryIds.length === 0) return;
  await UserMemory.updateMany(
    { _id: { $in: memoryIds } },
    {
      $inc: { hitCount: 1 },
      $set: { lastAccessedAt: new Date() },
    }
  );
};

/**
 * Consolidate memories — embedding-based deduplication + merge.
 */
export const consolidateMemories = async (userId) => {
  const memories = await UserMemory.find({ userId, active: true })
    .sort({ category: 1, createdAt: -1 })
    .lean();

  const byCategory = {};
  for (const mem of memories) {
    if (!byCategory[mem.category]) byCategory[mem.category] = [];
    byCategory[mem.category].push(mem);
  }

  let merged = 0;
  const deactivated = new Set();

  for (const [category, mems] of Object.entries(byCategory)) {
    if (mems.length < 2) continue;

    for (let i = 0; i < mems.length; i++) {
      if (deactivated.has(mems[i]._id.toString())) continue;
      for (let j = i + 1; j < mems.length; j++) {
        if (deactivated.has(mems[j]._id.toString())) continue;

        // Use embedding similarity if available, fallback to Jaccard
        let similarity;
        if (mems[i].embedding?.length > 0 && mems[j].embedding?.length > 0) {
          similarity = cosineSimilarity(mems[i].embedding, mems[j].embedding);
        } else {
          similarity = calculateOverlap(mems[i].fact, mems[j].fact);
        }

        if (similarity > 0.7) {
          await UserMemory.findByIdAndUpdate(mems[j]._id, { active: false });
          await UserMemory.findByIdAndUpdate(mems[i]._id, {
            $inc: { hitCount: 1 },
            $set: { confidence: Math.min(1.0, mems[i].confidence + 0.1) },
          });
          deactivated.add(mems[j]._id.toString());
          merged++;
        }
      }
    }
  }

  await UserLearningProfile.findOneAndUpdate(
    { userId },
    { $set: { lastConsolidatedAt: new Date() }, $inc: { "analytics.staleMemoriesRemoved": merged } },
    { upsert: true }
  );

  return { merged };
};

/**
 * Backfill embeddings for memories that don't have one.
 */
export const backfillEmbeddings = async (userId, batchSize = 20) => {
  const memories = await UserMemory.find({
    userId, active: true, $or: [{ embedding: { $size: 0 } }, { embedding: { $exists: false } }],
  }).limit(batchSize).lean();

  if (memories.length === 0) return { processed: 0 };

  try {
    const texts = memories.map(m => m.fact);
    const result = await embedBatch(texts);
    const embeddings = result.embeddings;

    for (let i = 0; i < memories.length; i++) {
      if (embeddings[i]) {
        await UserMemory.findByIdAndUpdate(memories[i]._id, { embedding: embeddings[i] });
      }
    }
    return { processed: memories.length };
  } catch (err) {
    console.warn("Embedding backfill error:", err.message);
    return { processed: 0, error: err.message };
  }
};

/**
 * Get or create a learning profile for a user.
 */
export const getOrCreateProfile = async (userId) => {
  let profile = await UserLearningProfile.findOne({ userId });
  if (!profile) {
    profile = await UserLearningProfile.create({ userId });
  }
  return profile;
};

/**
 * Reset all memories for a user (privacy).
 */
export const resetMemories = async (userId) => {
  const result = await UserMemory.updateMany({ userId }, { active: false });
  return { deactivated: result.modifiedCount };
};

/**
 * Export all active memories for a user.
 */
export const exportMemories = async (userId) => {
  return UserMemory.find({ userId, active: true })
    .select("fact category memoryLevel memoryType importanceScore confidence source createdAt")
    .sort({ importanceScore: -1 })
    .lean();
};

// ═══════════════════════════════════════════════════════════════
// CONTRADICTION ENGINE
// Detects conflicting memories and resolves by recency + confidence
// ═══════════════════════════════════════════════════════════════

export const detectContradictions = async (userId) => {
  const memories = await UserMemory.find({ userId, active: true })
    .sort({ category: 1 })
    .lean();

  const byCategory = {};
  for (const mem of memories) {
    if (!byCategory[mem.category]) byCategory[mem.category] = [];
    byCategory[mem.category].push(mem);
  }

  const contradictions = [];

  for (const [category, mems] of Object.entries(byCategory)) {
    if (mems.length < 2) continue;
    for (let i = 0; i < mems.length; i++) {
      for (let j = i + 1; j < mems.length; j++) {
        let similarity;
        if (mems[i].embedding?.length > 0 && mems[j].embedding?.length > 0) {
          similarity = cosineSimilarity(mems[i].embedding, mems[j].embedding);
        } else {
          similarity = calculateOverlap(mems[i].fact, mems[j].fact);
        }

        // High similarity in same category = likely contradiction or duplicate
        if (similarity > 0.4 && similarity < 0.85) {
          contradictions.push({
            memory1: { id: mems[i]._id, fact: mems[i].fact, confidence: mems[i].confidence, updatedAt: mems[i].updatedAt },
            memory2: { id: mems[j]._id, fact: mems[j].fact, confidence: mems[j].confidence, updatedAt: mems[j].updatedAt },
            category,
            similarity,
          });
        }
      }
    }
  }

  return contradictions;
};

/**
 * Auto-resolve contradictions using recency + confidence + source trust.
 */
export const resolveContradictions = async (userId) => {
  const contradictions = await detectContradictions(userId);
  let resolved = 0;

  const SOURCE_TRUST = {
    explicit_user_statement: 5,
    user_confirmed: 4,
    ai_extracted: 3,
    inferred_behavior: 2,
    feedback_learning: 2,
    system_generated: 1,
    extracted: 3,
    profile_sync: 1,
    feedback: 2,
  };

  for (const c of contradictions) {
    const m1 = c.memory1;
    const m2 = c.memory2;

    // Score: trust * confidence + recency bonus
    const recency1 = (new Date(m1.updatedAt).getTime()) / 1e12;
    const recency2 = (new Date(m2.updatedAt).getTime()) / 1e12;

    const score1 = (SOURCE_TRUST[m1.source] || 2) * m1.confidence + recency1;
    const score2 = (SOURCE_TRUST[m2.source] || 2) * m2.confidence + recency2;

    // Deactivate the weaker one
    const loserId = score1 >= score2 ? m2.id : m1.id;
    const winnerId = score1 >= score2 ? m1.id : m2.id;

    await UserMemory.findByIdAndUpdate(loserId, { active: false });
    // Boost winner
    await UserMemory.findByIdAndUpdate(winnerId, {
      $set: { confidence: Math.min(1.0, (score1 >= score2 ? m1.confidence : m2.confidence) + 0.05) },
    });
    resolved++;
  }

  return { contradictions: contradictions.length, resolved };
};

// ═══════════════════════════════════════════════════════════════
// MEMORY SAFETY LAYER
// Prevents pollution, hallucinated facts, repetitive entries
// ═══════════════════════════════════════════════════════════════

const SAFETY_RULES = {
  minFactLength: 5,
  maxFactLength: 300,
  maxMemoriesPerUser: 200,
  maxMemoriesPerCategory: 30,
  blockedPatterns: [
    /^(the user|user) (is|was) (a|an|the)?\s*(human|person|user)/i,
    /^(i|you) (am|are) (an? )?(ai|bot|assistant)/i,
    /^(hello|hi|hey|thanks|ok|yes|no)$/i,
  ],
};

export const validateMemory = (fact, category) => {
  if (!fact || typeof fact !== 'string') return { valid: false, reason: 'empty' };
  if (fact.length < SAFETY_RULES.minFactLength) return { valid: false, reason: 'too_short' };
  if (fact.length > SAFETY_RULES.maxFactLength) return { valid: false, reason: 'too_long' };

  for (const pattern of SAFETY_RULES.blockedPatterns) {
    if (pattern.test(fact)) return { valid: false, reason: 'blocked_pattern' };
  }

  return { valid: true };
};

export const enforceMemoryLimits = async (userId) => {
  const count = await UserMemory.countDocuments({ userId, active: true });

  if (count > SAFETY_RULES.maxMemoriesPerUser) {
    // Deactivate lowest-scoring memories beyond limit
    const excess = count - SAFETY_RULES.maxMemoriesPerUser;
    const weakest = await UserMemory.find({ userId, active: true })
      .sort({ relevanceScore: 1, confidence: 1 })
      .limit(excess)
      .select('_id')
      .lean();

    await UserMemory.updateMany(
      { _id: { $in: weakest.map(m => m._id) } },
      { active: false }
    );

    return { pruned: weakest.length };
  }

  return { pruned: 0 };
};

// ═══════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH — Connected memory reasoning via category relations
// Converts isolated memories into a connected graph structure
// ═══════════════════════════════════════════════════════════════

const CATEGORY_RELATIONS = {
  goal:        { affects: ['routine', 'nutrition', 'body_stats'], affectedBy: ['injury', 'preference'] },
  injury:      { affects: ['routine', 'goal', 'limitation'], affectedBy: [] },
  nutrition:   { affects: ['body_stats', 'progress', 'goal'], affectedBy: ['preference', 'goal'] },
  routine:     { affects: ['progress', 'body_stats', 'achievement'], affectedBy: ['goal', 'injury', 'limitation'] },
  body_stats:  { affects: ['goal', 'nutrition'], affectedBy: ['routine', 'nutrition'] },
  progress:    { affects: ['goal', 'routine'], affectedBy: ['routine', 'nutrition', 'body_stats'] },
  preference:  { affects: ['nutrition', 'routine'], affectedBy: [] },
  limitation:  { affects: ['routine', 'goal'], affectedBy: ['injury'] },
  achievement: { affects: ['goal'], affectedBy: ['routine', 'progress'] },
};

/**
 * Build a connected knowledge graph from user's memories.
 * Returns structured nodes + edges for AI context injection.
 */
export const buildKnowledgeGraph = async (userId) => {
  const memories = await UserMemory.find({ userId, active: true })
    .sort({ importanceScore: -1 })
    .limit(100)
    .lean();

  // Group by category
  const nodes = {};
  for (const mem of memories) {
    if (!nodes[mem.category]) nodes[mem.category] = [];
    nodes[mem.category].push({
      fact: mem.fact,
      importance: mem.importanceScore || 5,
      confidence: mem.confidence || 0.7,
    });
  }

  // Build edges from category relations
  const edges = [];
  for (const [cat, mems] of Object.entries(nodes)) {
    const relations = CATEGORY_RELATIONS[cat];
    if (!relations) continue;
    for (const target of relations.affects) {
      if (nodes[target]) {
        edges.push({ from: cat, to: target, relation: 'affects' });
      }
    }
  }

  return { nodes, edges, totalMemories: memories.length };
};

/**
 * Get graph-aware context string for a specific intent.
 * Follows edges to pull related memories.
 */
export const getGraphContext = async (userId, intent) => {
  const graph = await buildKnowledgeGraph(userId);

  // Map intent to primary categories
  const intentCategories = {
    workout_planning: ['routine', 'injury', 'goal', 'limitation', 'body_stats'],
    nutrition_question: ['nutrition', 'preference', 'goal', 'body_stats'],
    progress_analysis: ['progress', 'achievement', 'body_stats', 'goal'],
    injury_concern: ['injury', 'limitation', 'routine'],
    coaching: ['goal', 'progress', 'routine', 'nutrition'],
  };

  const primaryCats = intentCategories[intent] || ['goal', 'preference'];

  // Collect relevant facts following graph edges
  const relevantFacts = [];
  const visited = new Set();

  for (const cat of primaryCats) {
    if (graph.nodes[cat]) {
      for (const mem of graph.nodes[cat].slice(0, 3)) {
        relevantFacts.push(`[${cat}] ${mem.fact}`);
      }
      visited.add(cat);
    }

    // Follow one level of edges
    const relations = CATEGORY_RELATIONS[cat];
    if (relations) {
      for (const related of [...relations.affects, ...relations.affectedBy]) {
        if (!visited.has(related) && graph.nodes[related]) {
          for (const mem of graph.nodes[related].slice(0, 2)) {
            relevantFacts.push(`[${related}] ${mem.fact}`);
          }
          visited.add(related);
        }
      }
    }
  }

  return relevantFacts.slice(0, 20).join('\n');
};

// ═══════════════════════════════════════════════════════════════
// MEMORY SANDBOXING — Quarantine + Delayed Promotion
// Temporary emotional states and uncertain facts stay quarantined
// before being promoted to long-term memory.
// ═══════════════════════════════════════════════════════════════

const QUARANTINE_CATEGORIES = ['episodic', 'other'];
const EMOTIONAL_KEYWORDS = [
  'feeling', 'felt', 'mood', 'stressed', 'anxious', 'happy', 'sad',
  'frustrated', 'angry', 'tired today', 'not feeling', 'bad day', 'good day',
];

/**
 * Determine if a memory should be quarantined before promotion.
 */
export const shouldQuarantine = (fact, category, confidence, source) => {
  // Low confidence AI extractions → quarantine
  if (source === 'ai_extracted' && confidence < 0.6) return true;
  if (source === 'inferred_behavior') return true;

  // Emotional/temporary states
  const lower = fact.toLowerCase();
  if (EMOTIONAL_KEYWORDS.some(kw => lower.includes(kw))) return true;

  // Ephemeral categories
  if (QUARANTINE_CATEGORIES.includes(category)) return true;

  return false;
};

/**
 * Save memory in quarantine (active=false, quarantined=true).
 * Will be promoted after repeated signals or user confirmation.
 */
export const saveToQuarantine = async (userId, mem, sessionId) => {
  const memory = new UserMemory({
    userId,
    fact: mem.fact,
    category: mem.category || "other",
    memoryType: getMemoryType(mem.category),
    memoryLevel: 3, // quarantined starts at L3
    importanceScore: Math.min(5, mem.importance || 3), // capped
    confidence: Math.max(0.3, mem.confidence || 0.5),
    source: mem.source_type || "ai_extracted",
    active: false, // NOT active until promoted
    sessionId,
  });
  await memory.save();
  return memory;
};

/**
 * Promote quarantined memories that have been reinforced.
 * Called periodically (e.g., during consolidation).
 */
export const promoteQuarantinedMemories = async (userId) => {
  // Find quarantined memories that were seen in multiple sessions
  const quarantined = await UserMemory.find({
    userId,
    active: false,
    hitCount: { $gte: 2 }, // seen at least twice
    confidence: { $gte: 0.5 },
  }).lean();

  let promoted = 0;
  for (const mem of quarantined) {
    await UserMemory.findByIdAndUpdate(mem._id, {
      active: true,
      memoryLevel: getMemoryLevel(mem.category),
      confidence: Math.min(1.0, mem.confidence + 0.1),
    });
    promoted++;
  }

  return { promoted };
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

function calculateOverlap(str1, str2) {
  const words1 = new Set(str1.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(str2.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0;
  let intersection = 0;
  for (const w of words1) { if (words2.has(w)) intersection++; }
  return intersection / new Set([...words1, ...words2]).size;
}

function getMemoryLevel(category) {
  const l1 = ["injury", "limitation", "preference", "goal"];
  const l2 = ["body_stats", "routine", "progress", "achievement", "nutrition", "experience"];
  const l3 = ["episodic", "other"];
  if (l1.includes(category)) return 1;
  if (l2.includes(category)) return 2;
  if (l3.includes(category)) return 3;
  return 2;
}

function getMemoryType(category) {
  const staticCats = ["injury", "limitation", "preference", "experience"];
  const evolvingCats = ["body_stats", "goal", "routine", "progress", "achievement", "nutrition"];
  if (staticCats.includes(category)) return "static";
  if (evolvingCats.includes(category)) return "evolving";
  return "temporal";
}
