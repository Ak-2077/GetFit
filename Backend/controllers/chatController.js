import {
  chatCompletion, chatCompletionStream, extractMemories, summarizeConversation, detectTopics,
  classifyIntent, reflectOnResponse, analyzeTrajectory,
  routeTools, structuredReason, estimateConfidence,
  evaluateResponse,
} from '../services/aiClient.js';
import User from '../models/user.js';
import UserMemory from '../models/userMemory.js';
import UserLearningProfile from '../models/userLearningProfile.js';
import {
  saveMemories,
  getMemoriesForChat,
  recordMemoryAccess,
  consolidateMemories,
  backfillEmbeddings,
  getOrCreateProfile,
  resetMemories,
  exportMemories,
  resolveContradictions,
  enforceMemoryLimits,
  promoteQuarantinedMemories,
  getGraphContext,
  buildKnowledgeGraph,
} from '../services/memoryService.js';
import { executeTools, getOrCreateUserState, addUserSignal } from '../services/agentService.js';
import { getProactiveContext, getOrCreateReasoning, updateReasoningState, getCoachingToneAdjustment, checkAutonomousAdaptations } from '../services/plannerService.js';
import { getTwinContext, simulatePlanLocal } from '../services/digitalTwinService.js';
import { getCircuitBreakers, recordStageExecution, recordIncident, recordPromptOutcome, getBestConfig, withTimeout, STAGE_BUDGETS } from '../services/diagnosticsService.js';
import { getMemoriesNeedingVerification, applyTruthDecay, getMemoryHealth } from '../services/truthEngine.js';
import OrchestrationHealth from '../models/orchestrationHealth.js';
import ExperienceReplay from '../models/experienceReplay.js';
import ReasoningCache from '../models/reasoningCache.js';
import mongoose from 'mongoose';

// ── Chat Session Schema (inline for now, extract to models/ later) ──
const chatSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  messages: [{
    role: { type: String, enum: ['user', 'assistant', 'system'] },
    content: String,
    timestamp: { type: Date, default: Date.now },
  }],
  title: { type: String, default: 'New Chat' },
}, { timestamps: true });

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

/**
 * POST /api/ai/chat
 * Full AI learning pipeline:
 * 1. Fetch user memories + learning profile
 * 2. Build context-rich prompt
 * 3. Get AI response
 * 4. Background: extract facts, detect topics, update profile, summarize, consolidate
 */
export const sendMessage = async (req, res) => {
  try {
    const userId = req.userId;
    const { message, sessionId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message is required' });
    }

    // Get user context for personalization
    const user = await User.findById(userId)
      .select('name goal weight targetWeight height age gender dietPreference activityLevel subscriptionPlan')
      .lean();

    if (!user) return res.status(404).json({ message: 'User not found' });

    const plan = user.subscriptionPlan || 'free';
    if (plan === 'free') {
      return res.status(403).json({ message: 'AI Chat requires Pro or Pro Plus plan', upgrade: true });
    }

    // Load or create session
    let session;
    if (sessionId) {
      session = await ChatSession.findOne({ _id: sessionId, userId });
    }
    if (!session) {
      session = new ChatSession({ userId, messages: [] });
    }

    // Add user message
    session.messages.push({ role: 'user', content: message });

    // ════════════════════════════════════════════════════════════════
    // AUTONOMOUS AI ORCHESTRATION PIPELINE (12 stages)
    // with FAST PATH + SELECTIVE DEPTH GATING for latency optimization
    // ════════════════════════════════════════════════════════════════
    const pipelineStart = Date.now();
    const stageTimings = {};
    const _t = (label) => { stageTimings[label] = Date.now(); };
    const _te = (label) => { if (stageTimings[label]) stageTimings[label] = Date.now() - stageTimings[label]; };

    // ── STAGE 1: Intent + Profile + State + Breakers (parallel) ──
    _t('stage1_intent');
    const recentContext = session.messages.slice(-4).map(m => m.content);

    const intentFallback = { intent: 'coaching', mode: 'coach', knowledge_sources: ['user_memory'], depth: 2, token_budget: 300, needs_reflection: false };
    const [intentPlan, learningProfile, userState, circuitBreakers] = await Promise.all([
      withTimeout(classifyIntent(message, recentContext), STAGE_BUDGETS.intent_classification, 'intent_classification', intentFallback),
      getOrCreateProfile(userId),
      getOrCreateUserState(userId),
      getCircuitBreakers().catch(() => ({ toolExecution: false, evaluator: false, reasoning: false, simulation: false })),
    ]);
    _te('stage1_intent');

    // ── DEPTH GATING: Determine pipeline tier based on intent complexity ──
    const FAST_INTENTS = ['casual_chat', 'memory_recall', 'motivation'];
    const MEDIUM_INTENTS = ['coaching', 'emotional_support', 'factual_query', 'form_correction', 'correction_request'];
    const DEEP_INTENTS = ['workout_planning', 'nutrition_question', 'progress_analysis', 'injury_concern'];
    const pipelineTier = FAST_INTENTS.includes(intentPlan.intent) ? 'fast'
      : DEEP_INTENTS.includes(intentPlan.intent) ? 'deep' : 'medium';

    // ── FAST PATH: Simple queries → skip heavy stages (target <2s) ──
    if (pipelineTier === 'fast') {
      _t('fast_path');
      const recentMessages = session.messages.slice(-6).map(m => ({ role: m.role, content: m.content }));
      const styleProfile = learningProfile.styleProfile || {};
      const fastContext = {
        name: user.name, goal: user.goal, plan,
        preferredResponseLength: learningProfile.preferredResponseLength,
        styleVerbosity: styleProfile.verbosity,
        styleMotivation: styleProfile.motivation,
      };

      // Light memory: only compiled context, no embedding search
      let fastMemory = '';
      try {
        const memData = await getMemoriesForChat(userId, '', intentPlan.intent);
        fastMemory = memData.compiled || memData.flat.slice(0, 8).map(f => `- ${f}`).join('\n');
      } catch (_) {}

      const fastOrch = {
        mode: intentPlan.mode,
        intent: intentPlan.intent,
        token_budget: Math.min(intentPlan.token_budget, 200),
        trajectory_context: '',
      };

      const aiResponse = await chatCompletion(recentMessages, fastContext, [], fastMemory, fastOrch);
      _te('fast_path');

      session.messages.push({ role: 'assistant', content: aiResponse.content });
      if (session.messages.length <= 2) {
        session.title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
      }
      await session.save();

      // Lightweight background learning (no evaluator, no trajectory, no reasoning)
      setImmediate(async () => {
        try {
          const lastMsgs = session.messages.slice(-4).map(m => ({ role: m.role, content: m.content }));
          const extracted = await extractMemories(lastMsgs);
          if (extracted.memories?.length > 0) await saveMemories(userId, extracted.memories, session._id);
          await detectTopics(message).then(r => r.topics?.length > 0 && learningProfile.recordInteraction(r.topics)).catch(() => {});
        } catch (_) {}
      });

      recordStageExecution('fast_pipeline', pipelineStart, true).catch(() => {});
      return res.json({
        sessionId: session._id,
        reply: aiResponse.content,
        role: 'assistant',
        meta: {
          intent: intentPlan.intent, mode: intentPlan.mode,
          pipelineTier: 'fast', memoriesUsed: 0,
          pipelineMs: Date.now() - pipelineStart,
          stageTimes: stageTimings,
        },
      });
    }

    // ── STAGE 2: Planner + Twin (MEDIUM: bestConfig only | DEEP: full parallel) ──
    _t('stage2_planner');
    let proactiveCtx = '', twinCtx = '', toneAdjustment = null, bestConfig = null;

    if (pipelineTier === 'deep') {
      [proactiveCtx, twinCtx, toneAdjustment, bestConfig] = await Promise.all([
        withTimeout(getProactiveContext(userId), STAGE_BUDGETS.planner_context, 'planner_context', ''),
        withTimeout(getTwinContext(userId), STAGE_BUDGETS.twin_context, 'twin_context', ''),
        getCoachingToneAdjustment(userId).catch(() => null),
        getBestConfig(userId, intentPlan.intent).catch(() => null),
      ]);
    } else {
      // Medium: only get bestConfig (fast DB call), skip planner/twin
      bestConfig = await getBestConfig(userId, intentPlan.intent).catch(() => null);
    }
    _te('stage2_planner');

    // Apply autonomous tone adjustment from long-horizon planner
    if (toneAdjustment?.suggestedTone && toneAdjustment.suggestedTone !== intentPlan.mode) {
      intentPlan.mode = toneAdjustment.suggestedTone;
    }

    // Apply self-improving prompt system: override mode with learned best style
    if (bestConfig?.coachingStyleScore > 0.6) {
      const MODE_MAP = { warm: 'coach', direct: 'technical', technical: 'technical', supportive: 'supportive', motivational: 'coach', concise: 'concise' };
      const mappedMode = MODE_MAP[bestConfig.coachingStyle] || intentPlan.mode;
      intentPlan.mode = mappedMode;
    }

    // ── STAGE 3: Memory retrieval + Truth verification (dynamic attention) ──
    _t('stage3_memory');
    const memoryFallback = { compiled: '', flat: [], raw: [], analytics: { totalRetrieved: 0, tokensSaved: 0 } };
    const memoryData = await withTimeout(
      getMemoriesForChat(userId, message, intentPlan.intent, { injuryRisk: userState.injuryRisk, fatigue: userState.fatigue }),
      STAGE_BUDGETS.memory_retrieval, 'memory_retrieval', memoryFallback
    );
    _te('stage3_memory');

    // ── STAGE 4: Dynamic Context Builder ──
    const recentMessages = session.messages.slice(
      intentPlan.depth === 1 ? -6 : -20
    ).map(m => ({ role: m.role, content: m.content }));

    const styleProfile = learningProfile.styleProfile || {};
    const userContext = {
      name: user.name,
      goal: user.goal,
      weight: user.weight,
      targetWeight: user.targetWeight,
      activityLevel: user.activityLevel,
      dietPreference: user.dietPreference,
      plan,
      preferredResponseLength: learningProfile.preferredResponseLength,
      topInterests: learningProfile.getTopTopics(3).map(t => t.topic).join(', '),
      styleVerbosity: styleProfile.verbosity,
      styleTechnicality: styleProfile.technicality,
      styleMotivation: styleProfile.motivation,
    };

    // Inject learned response structure preference from self-improving prompt system
    if (bestConfig?.responseStructure && bestConfig.responseStructureScore > 0.55) {
      userContext.preferredStructure = bestConfig.responseStructure;
    }
    if (bestConfig?.avgQuality !== undefined) {
      userContext.historicalQuality = bestConfig.avgQuality;
    }

    if (learningProfile.dislikedPatterns?.length > 0) {
      userContext.avoid = learningProfile.dislikedPatterns
        .sort((a, b) => b.count - a.count).slice(0, 3).map(p => p.pattern).join(', ');
    }
    if (learningProfile.preferredPatterns?.length > 0) {
      userContext.prefer = learningProfile.preferredPatterns
        .sort((a, b) => b.count - a.count).slice(0, 3).map(p => p.pattern).join(', ');
    }

    // ── STAGE 5: Tool Execution Graph (DEEP only) ──
    let toolResults = [];
    const toolIntents = ['workout_planning', 'nutrition_question', 'factual_query', 'progress_analysis'];

    if (toolIntents.includes(intentPlan.intent) && !circuitBreakers.toolExecution && pipelineTier === 'deep') {
      _t('stage5_tools');
      try {
        const userProfile = { weight_kg: user.weight, height_cm: user.height, age: user.age, gender: user.gender, activity_level: user.activityLevel, goal: user.goal, diet_preference: user.dietPreference };
        const stateSnapshot = { energy: userState.energy, recovery: userState.recovery, fatigue: userState.fatigue, adherence: userState.adherence, injuryRisk: userState.injuryRisk, recommendedIntensity: userState.recommendedIntensity };

        const toolPlan = await routeTools(message, intentPlan.intent, userProfile, stateSnapshot);

        if (toolPlan.tools?.length > 0) {
          toolResults = await executeTools(userId, toolPlan.tools);
        }
        recordStageExecution('tool_routing', _t('stage5_tools') || Date.now(), true).catch(() => {});
      } catch (toolErr) {
        recordIncident('routing_failure', 'medium', toolErr.message).catch(() => {});
      }
      _te('stage5_tools');
    }

    // ── STAGE 6: Structured Reasoning (DEEP only) ──
    let reasoningState = null;
    const complexIntents = ['workout_planning', 'nutrition_question', 'progress_analysis', 'injury_concern'];

    if ((complexIntents.includes(intentPlan.intent) || toolResults.length > 0) && !circuitBreakers.reasoning && pipelineTier === 'deep') {
      _t('stage6_reasoning');
      try {
        reasoningState = await structuredReason(
          message, intentPlan.intent, userContext,
          toolResults.filter(t => t.data).map(t => ({ tool: t.tool, ...t.data })),
          { energy: userState.energy, recovery: userState.recovery, injuryRisk: userState.injuryRisk, recommendedIntensity: userState.recommendedIntensity },
          memoryData.flat.slice(0, 10),
        );

        if (reasoningState.should_ask_clarification && reasoningState.clarification_question) {
          session.messages.push({ role: 'assistant', content: reasoningState.clarification_question });
          await session.save();
          return res.json({
            sessionId: session._id,
            reply: reasoningState.clarification_question,
            role: 'assistant',
            meta: { intent: intentPlan.intent, mode: intentPlan.mode, action: 'clarification', pipelineTier },
          });
        }
      } catch (_) {}
      _te('stage6_reasoning');
    }

    // ── STAGE 7: Goal Trajectory + Proactive Planning (DEEP only) ──
    let trajectoryContext = '';
    const trajectoryIntents = ['coaching', 'progress_analysis', 'emotional_support', 'motivation'];
    if (trajectoryIntents.includes(intentPlan.intent) && learningProfile.totalSessions >= 3 && pipelineTier === 'deep') {
      _t('stage7_trajectory');
      try {
        const trajResult = await analyzeTrajectory({
          session_summaries: (learningProfile.sessionSummaries || []).slice(-10).map(s => s.summary),
          topic_frequency: Object.fromEntries(learningProfile.topicFrequency || []),
          progress_entries: (learningProfile.progressEntries || []).slice(-10),
          total_sessions: learningProfile.totalSessions,
          satisfaction_rate: learningProfile.satisfactionRate,
        });
        const parts = [];
        if (trajResult.positive_trends?.length) parts.push(`Strengths: ${trajResult.positive_trends.join('; ')}`);
        if (trajResult.concerns?.length) parts.push(`Watch: ${trajResult.concerns.join('; ')}`);
        if (trajResult.coaching_adjustments?.length) parts.push(`Adjust: ${trajResult.coaching_adjustments.join('; ')}`);
        trajectoryContext = parts.join('\n');
      } catch (_) {}
      _te('stage7_trajectory');
    }

    // Append user state + proactive planner + digital twin context
    const stateContext = userState.toContextString();
    const contextLayers = [trajectoryContext, stateContext, proactiveCtx, twinCtx].filter(Boolean);
    trajectoryContext = contextLayers.join('\n');

    // ── STAGE 8: Response Generation ──
    _t('stage8_generation');
    let toolContext = '';
    if (toolResults.length > 0) {
      toolContext = toolResults.filter(t => t.data)
        .map(t => `[${t.tool}]: ${JSON.stringify(t.data, null, 0).slice(0, 500)}`).join('\n');
    }

    let reasoningContext = '';
    if (reasoningState) {
      const rParts = [];
      if (reasoningState.recommended_strategy) rParts.push(`Strategy: ${reasoningState.recommended_strategy}`);
      if (reasoningState.key_facts?.length) rParts.push(`Facts: ${reasoningState.key_facts.join('; ')}`);
      if (reasoningState.safety_warnings?.length) rParts.push(`⚠ Safety: ${reasoningState.safety_warnings.join('; ')}`);
      if (reasoningState.response_approach) rParts.push(`Approach: ${reasoningState.response_approach}`);
      reasoningContext = rParts.join('\n');
    }

    let graphContext = '';
    if (complexIntents.includes(intentPlan.intent) && pipelineTier === 'deep') {
      try { graphContext = await getGraphContext(userId, intentPlan.intent); } catch (_) {}
    }

    const fullTrajectory = [trajectoryContext, toolContext, reasoningContext, graphContext].filter(Boolean).join('\n---\n');

    // Token budget caps per tier
    const TIER_TOKEN_CAPS = { fast: 200, medium: 400, deep: 800 };
    const cappedBudget = Math.min(intentPlan.token_budget, TIER_TOKEN_CAPS[pipelineTier] || 400);

    const orchestration = {
      mode: intentPlan.mode,
      intent: intentPlan.intent,
      token_budget: cappedBudget,
      trajectory_context: fullTrajectory,
    };

    const aiResponse = await chatCompletion(
      recentMessages, userContext, memoryData.flat, memoryData.compiled, orchestration
    );
    _te('stage8_generation');

    let finalContent = aiResponse.content;

    // ── STAGE 9: Independent Evaluator (DEEP only + high-stakes intents) ──
    let evaluationResult = null;
    const evaluatorIntents = ['workout_planning', 'nutrition_question', 'injury_concern'];
    if (evaluatorIntents.includes(intentPlan.intent) && !circuitBreakers.evaluator && pipelineTier === 'deep') {
      _t('stage9_evaluator');
      try {
        evaluationResult = await withTimeout(
          evaluateResponse(
            message, finalContent, intentPlan.intent,
            memoryData.flat.slice(0, 10),
            toolResults.length > 0,
            { energy: userState.energy, injuryRisk: userState.injuryRisk },
            reasoningState,
          ),
          STAGE_BUDGETS.evaluator, 'evaluator', null
        );

        if (evaluationResult && (evaluationResult.verdict === 'reject' || evaluationResult.safety_flag)) {
          // Record experience for learning
          ExperienceReplay.recordExperience({
            userId, userMessage: message, intent: intentPlan.intent, mode: intentPlan.mode,
            originalResponse: finalContent, originalScore: evaluationResult.confidence || 0.2,
            replayType: evaluationResult.safety_flag ? 'safety_violation' : 'evaluator_rejection',
            pipelineTier, memoriesUsed: memoryData.raw.length,
            toolsUsed: toolResults.filter(t => t.data).map(t => t.tool),
            evaluatorVerdict: evaluationResult.verdict,
            issues: evaluationResult.issues || [],
            revisionGuidance: evaluationResult.revision_guidance,
          }).catch(() => {});

          finalContent = "I want to make sure I give you safe and accurate advice. Could you tell me more about your situation so I can help better?";
          recordIncident('safety_violation', 'high', 'Evaluator rejected response', { verdict: evaluationResult.verdict }).catch(() => {});
        } else if (evaluationResult && evaluationResult.verdict === 'regenerate') {
          const originalContent = finalContent;
          const revisedOrch = { ...orchestration, trajectory_context: `${fullTrajectory}\n---\nREVISION NEEDED: ${evaluationResult.revision_guidance || 'Improve accuracy and personalization'}` };
          const retry = await chatCompletion(recentMessages, userContext, memoryData.flat, memoryData.compiled, revisedOrch);
          finalContent = retry.content;

          // Record the revision for learning
          ExperienceReplay.recordExperience({
            userId, userMessage: message, intent: intentPlan.intent, mode: intentPlan.mode,
            originalResponse: originalContent, originalScore: evaluationResult.confidence || 0.4,
            correctedResponse: finalContent, correctedScore: 0.7,
            replayType: 'evaluator_revision', pipelineTier,
            memoriesUsed: memoryData.raw.length,
            evaluatorVerdict: evaluationResult.verdict,
            issues: evaluationResult.issues || [],
            revisionGuidance: evaluationResult.revision_guidance,
          }).catch(() => {});
        }
      } catch (_) {
        recordIncident('evaluator_rejection', 'low', 'Evaluator call failed').catch(() => {});
      }
      _te('stage9_evaluator');
    }

    // ── STAGE 10: Self-Reflection (DEEP only, legacy gate) ──
    if (intentPlan.needs_reflection && !evaluationResult && pipelineTier === 'deep') {
      try {
        const reflection = await reflectOnResponse(
          message, finalContent, memoryData.flat.slice(0, 10),
          intentPlan.intent, intentPlan.mode
        );
        if (!reflection.safe && reflection.revised_response) {
          finalContent = reflection.revised_response;
        } else if (reflection.score < 7 && reflection.revised_response) {
          finalContent = reflection.revised_response;
        }
      } catch (_) {}
    }

    // Save assistant reply
    session.messages.push({ role: 'assistant', content: finalContent });
    if (session.messages.length <= 2) {
      session.title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
    }
    await session.save();

    // ── STAGE 11: Diagnostics Recording ──
    recordStageExecution('full_pipeline', pipelineStart, true).catch(() => {});

    // ── STAGE 12: Autonomous Background Learning (non-blocking) ──
    if (memoryData.raw.length > 0) {
      setImmediate(() => {
        recordMemoryAccess(memoryData.raw.map(m => m._id)).catch(() => {});
        UserLearningProfile.findOneAndUpdate(
          { userId },
          { $inc: {
            "analytics.memoryRetrievalHits": 1,
            "analytics.totalTokensSaved": memoryData.analytics?.tokensSaved || 0,
            "analytics.compiledContextUsageCount": 1,
          }},
        ).catch(() => {});
      });
    } else {
      setImmediate(() => {
        UserLearningProfile.findOneAndUpdate(
          { userId }, { $inc: { "analytics.memoryRetrievalMisses": 1 } }
        ).catch(() => {});
      });
    }

    setImmediate(async () => {
      try {
        // Signal user state
        await addUserSignal(userId, 'meal_logged', { source: 'chat' }).catch(() => {});

        const lastMessages = session.messages.slice(-4).map(m => ({ role: m.role, content: m.content }));

        // Extract & save memories (sandboxing inside saveMemories)
        const extracted = await extractMemories(lastMessages);
        if (extracted.memories?.length > 0) {
          await saveMemories(userId, extracted.memories, session._id);
        }

        // Detect topics
        try {
          const topicResult = await detectTopics(message);
          if (topicResult.topics?.length > 0) await learningProfile.recordInteraction(topicResult.topics);
        } catch (_) {}

        // Backfill embeddings
        try { await backfillEmbeddings(userId, 10); } catch (_) {}

        // Prompt performance tracking
        if (evaluationResult) {
          recordPromptOutcome(userId, {
            promptType: 'coaching', intent: intentPlan.intent,
            isPositive: evaluationResult.verdict === 'approve',
            confidence: evaluationResult.confidence,
            coachingStyle: intentPlan.mode,
          }).catch(() => {});
        }

        // Autonomous adaptations check
        checkAutonomousAdaptations(userId).catch(() => {});

        // Consolidate periodically (includes truth decay + quarantine promotion)
        const sessionCount = await ChatSession.countDocuments({ userId });
        const lastConsolidated = learningProfile.lastConsolidatedAt;
        const shouldConsolidate = !lastConsolidated ||
          (sessionCount % 10 === 0) ||
          (Date.now() - new Date(lastConsolidated).getTime() > 7 * 24 * 60 * 60 * 1000);
        if (shouldConsolidate) {
          await consolidateMemories(userId);
          await resolveContradictions(userId);
          await enforceMemoryLimits(userId);
          await promoteQuarantinedMemories(userId);
          await applyTruthDecay(userId);
        }
      } catch (bgErr) {
        console.warn('Background learning error:', bgErr.message);
        recordIncident('model_error', 'low', `Background: ${bgErr.message}`).catch(() => {});
      }
    });

    return res.json({
      sessionId: session._id,
      reply: finalContent,
      role: 'assistant',
      meta: {
        intent: intentPlan.intent,
        mode: intentPlan.mode,
        pipelineTier,
        memoriesUsed: memoryData.raw.length,
        toolsUsed: toolResults.filter(t => t.data).map(t => t.tool),
        confidence: reasoningState?.confidence || null,
        evaluatorVerdict: evaluationResult?.verdict || null,
        pipelineMs: Date.now() - pipelineStart,
        stageTimes: stageTimings,
      },
    });
  } catch (error) {
    console.error('Chat error:', error.message);
    return res.status(500).json({ message: 'AI service error', error: error.message });
  }
};

/**
 * POST /api/ai/chat/stream
 * Streaming version of sendMessage — streams tokens via SSE for perceived low latency.
 * Uses the same fast-path / depth-gating logic but streams the final generation.
 */
export const sendMessageStream = async (req, res) => {
  try {
    const userId = req.userId;
    const { message, sessionId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message is required' });
    }

    const user = await User.findById(userId)
      .select('name goal weight targetWeight height age gender dietPreference activityLevel subscriptionPlan')
      .lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const plan = user.subscriptionPlan || 'free';
    if (plan === 'free') {
      return res.status(403).json({ message: 'AI Chat requires Pro or Pro Plus plan', upgrade: true });
    }

    let session;
    if (sessionId) session = await ChatSession.findOne({ _id: sessionId, userId });
    if (!session) session = new ChatSession({ userId, messages: [] });

    session.messages.push({ role: 'user', content: message });

    // Stage 1: Intent + Profile (parallel, using fast model)
    const recentContext = session.messages.slice(-4).map(m => m.content);
    const [intentPlan, learningProfile] = await Promise.all([
      classifyIntent(message, recentContext).catch(() => ({
        intent: 'coaching', mode: 'coach', knowledge_sources: ['user_memory'],
        depth: 1, token_budget: 200, needs_reflection: false,
      })),
      getOrCreateProfile(userId),
    ]);

    // Memory (light for stream — skip embedding search for speed)
    let compiledMemory = '';
    try {
      const memData = await getMemoriesForChat(userId, '', intentPlan.intent);
      compiledMemory = memData.compiled || memData.flat.slice(0, 8).map(f => `- ${f}`).join('\n');
    } catch (_) {}

    const recentMessages = session.messages.slice(-8).map(m => ({ role: m.role, content: m.content }));
    const styleProfile = learningProfile.styleProfile || {};
    const userContext = {
      name: user.name, goal: user.goal, weight: user.weight,
      activityLevel: user.activityLevel, dietPreference: user.dietPreference, plan,
      preferredResponseLength: learningProfile.preferredResponseLength,
      styleVerbosity: styleProfile.verbosity, styleMotivation: styleProfile.motivation,
    };

    const orchestration = {
      mode: intentPlan.mode,
      intent: intentPlan.intent,
      token_budget: Math.min(intentPlan.token_budget, 400),
      trajectory_context: '',
    };

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send session meta first
    res.write(`data: ${JSON.stringify({ type: 'meta', sessionId: session._id, intent: intentPlan.intent, mode: intentPlan.mode })}\n\n`);

    // Stream from AI service
    let fullContent = '';
    try {
      const stream = await chatCompletionStream(recentMessages, userContext, [], compiledMemory, orchestration);

      await new Promise((resolve, reject) => {
        let buffer = '';
        stream.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.token) {
                fullContent += data.token;
                res.write(`data: ${JSON.stringify({ type: 'token', token: data.token })}\n\n`);
              }
              if (data.done) resolve();
              if (data.error) reject(new Error(data.error));
            } catch (_) {}
          }
        });
        stream.on('end', resolve);
        stream.on('error', reject);
      });
    } catch (streamErr) {
      // Fallback to non-streaming if stream fails
      const fallback = await chatCompletion(recentMessages, userContext, [], compiledMemory, orchestration);
      fullContent = fallback.content;
      res.write(`data: ${JSON.stringify({ type: 'token', token: fullContent })}\n\n`);
    }

    // Save and finalize
    session.messages.push({ role: 'assistant', content: fullContent });
    if (session.messages.length <= 2) {
      session.title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
    }
    await session.save();

    res.write(`data: ${JSON.stringify({ type: 'done', sessionId: session._id })}\n\n`);
    res.end();

    // Background learning
    setImmediate(async () => {
      try {
        const lastMsgs = session.messages.slice(-4).map(m => ({ role: m.role, content: m.content }));
        const extracted = await extractMemories(lastMsgs);
        if (extracted.memories?.length > 0) await saveMemories(userId, extracted.memories, session._id);
        await detectTopics(message).then(r => r.topics?.length > 0 && learningProfile.recordInteraction(r.topics)).catch(() => {});
      } catch (_) {}
    });

  } catch (error) {
    console.error('Stream chat error:', error.message);
    if (!res.headersSent) {
      return res.status(500).json({ message: 'AI service error', error: error.message });
    }
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
};

/**
 * GET /api/ai/chat/sessions
 * List all chat sessions for a user.
 */
export const getSessions = async (req, res) => {
  try {
    const sessions = await ChatSession.find({ userId: req.userId })
      .select('title createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
    return res.json(sessions);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load sessions', error: error.message });
  }
};

/**
 * GET /api/ai/chat/sessions/:sessionId
 * Get full conversation history for a session.
 */
export const getSessionMessages = async (req, res) => {
  try {
    const session = await ChatSession.findOne({
      _id: req.params.sessionId,
      userId: req.userId,
    }).lean();
    if (!session) return res.status(404).json({ message: 'Session not found' });
    return res.json(session);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load session', error: error.message });
  }
};

/**
 * POST /api/ai/chat/feedback
 * User rates a response (thumbs up/down). Feeds into learning profile.
 * Body: { sessionId, messageIndex, isPositive, reason? }
 */
export const submitFeedback = async (req, res) => {
  try {
    const userId = req.userId;
    const { sessionId, messageIndex, isPositive, reason } = req.body;

    if (typeof isPositive !== 'boolean') {
      return res.status(400).json({ message: 'isPositive (boolean) is required' });
    }

    // Determine response length category
    let responseLength = 'medium';
    if (sessionId && typeof messageIndex === 'number') {
      const session = await ChatSession.findOne({ _id: sessionId, userId }).lean();
      if (session && session.messages[messageIndex]) {
        const content = session.messages[messageIndex].content;
        const len = content.length;
        responseLength = len < 200 ? 'short' : len > 600 ? 'detailed' : 'medium';
      }
    }

    // Update learning profile with feedback
    const profile = await getOrCreateProfile(userId);
    await profile.recordFeedback(isPositive, responseLength, reason || null);

    // Adapt style profile dimensions based on feedback signal
    const LEARNING_RATE = 0.05;
    if (profile.styleProfile) {
      if (isPositive) {
        // Reinforce current style
        if (responseLength === 'short') {
          profile.styleProfile.verbosity = Math.max(0, profile.styleProfile.verbosity - LEARNING_RATE);
        } else if (responseLength === 'detailed') {
          profile.styleProfile.verbosity = Math.min(1, profile.styleProfile.verbosity + LEARNING_RATE);
        }
      } else {
        // Shift away from current style
        if (responseLength === 'short') {
          profile.styleProfile.verbosity = Math.min(1, profile.styleProfile.verbosity + LEARNING_RATE);
        } else if (responseLength === 'detailed') {
          profile.styleProfile.verbosity = Math.max(0, profile.styleProfile.verbosity - LEARNING_RATE);
        }
      }

      // Parse reason for style signals
      if (reason) {
        const r = reason.toLowerCase();
        if (r.includes('technical') || r.includes('complex')) {
          profile.styleProfile.technicality += isPositive ? LEARNING_RATE : -LEARNING_RATE;
        }
        if (r.includes('motivat') || r.includes('encouraging')) {
          profile.styleProfile.motivation += isPositive ? LEARNING_RATE : -LEARNING_RATE;
        }
        if (r.includes('simple') || r.includes('casual') || r.includes('easy')) {
          profile.styleProfile.technicality += isPositive ? -LEARNING_RATE : LEARNING_RATE;
        }
        // Clamp all values
        profile.styleProfile.technicality = Math.max(0, Math.min(1, profile.styleProfile.technicality));
        profile.styleProfile.motivation = Math.max(0, Math.min(1, profile.styleProfile.motivation));
      }

      profile.markModified('styleProfile');
      await profile.save();
    }

    // If negative + reason, store as a memory so AI avoids it
    if (!isPositive && reason) {
      try {
        await UserMemory.findOneAndUpdate(
          { userId, fact: `User dislikes: ${reason}` },
          {
            userId,
            category: 'preference',
            memoryType: 'static',
            memoryLevel: 1,
            importanceScore: 7,
            fact: `User dislikes: ${reason}`,
            confidence: 0.9,
            source: 'feedback_learning',
            active: true,
          },
          { upsert: true }
        );
      } catch (_) { /* duplicate is fine */ }
    }

    // If positive + reason, store as preferred pattern
    if (isPositive && reason) {
      const existing = (profile.preferredPatterns || []).find(p => p.pattern === reason);
      if (existing) {
        existing.count += 1;
      } else {
        profile.preferredPatterns = [...(profile.preferredPatterns || []), { pattern: reason, count: 1 }];
      }
      profile.markModified('preferredPatterns');
      await profile.save();
    }

    // Record experience replay from feedback
    if (sessionId && typeof messageIndex === 'number') {
      setImmediate(async () => {
        try {
          const sess = await ChatSession.findOne({ _id: sessionId, userId }).lean();
          if (sess && sess.messages[messageIndex]) {
            const aiContent = sess.messages[messageIndex].content;
            const userMsg = messageIndex > 0 ? sess.messages[messageIndex - 1]?.content : '';
            await ExperienceReplay.recordExperience({
              userId, userMessage: userMsg || '', intent: 'coaching', mode: 'coach',
              originalResponse: aiContent, originalScore: isPositive ? 0.85 : 0.3,
              correctedResponse: isPositive ? aiContent : undefined,
              correctedScore: isPositive ? 0.85 : undefined,
              replayType: isPositive ? 'user_positive_feedback' : 'user_negative_feedback',
              feedbackReason: reason || undefined,
            });
          }
        } catch (_) {}
      });
    }

    // Feed into self-improving prompt performance system
    setImmediate(async () => {
      try {
        await recordPromptOutcome(userId, {
          promptType: 'coaching',
          intent: 'coaching',
          isPositive,
          confidence: isPositive ? 0.8 : 0.3,
          coachingStyle: profile.styleProfile?.motivation > 0.6 ? 'motivational' : 'warm',
          responseStructure: responseLength === 'short' ? 'concise' : responseLength === 'detailed' ? 'paragraph' : 'conversational',
        });

        // Record meta insights from explicit feedback reasons
        if (reason) {
          const { recordMetaInsight } = await import('../services/diagnosticsService.js');
          const r = reason.toLowerCase();
          if (r.includes('bullet') || r.includes('list')) await recordMetaInsight(userId, 'response_structure', 'bulletPoints', 0.6);
          if (r.includes('short') || r.includes('brief')) await recordMetaInsight(userId, 'response_length', 'short', 0.6);
          if (r.includes('detail') || r.includes('thorough')) await recordMetaInsight(userId, 'response_length', 'detailed', 0.6);
          if (r.includes('friendly') || r.includes('warm')) await recordMetaInsight(userId, 'coaching_tone', 'warm', 0.6);
          if (r.includes('strict') || r.includes('direct')) await recordMetaInsight(userId, 'coaching_tone', 'direct', 0.6);
        }
      } catch (_) {}
    });

    return res.json({
      message: 'Feedback recorded',
      satisfactionRate: profile.satisfactionRate,
      preferredLength: profile.preferredResponseLength,
      styleProfile: profile.styleProfile,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Feedback error', error: error.message });
  }
};

/**
 * POST /api/ai/chat/end-session
 * Called when user leaves chat. Summarizes session for future context.
 * Body: { sessionId }
 */
export const endSession = async (req, res) => {
  try {
    const userId = req.userId;
    const { sessionId } = req.body;

    if (!sessionId) return res.status(400).json({ message: 'sessionId is required' });

    const session = await ChatSession.findOne({ _id: sessionId, userId }).lean();
    if (!session || session.messages.length < 2) {
      return res.json({ message: 'Session too short to summarize' });
    }

    // Summarize in background
    const messages = session.messages.map(m => ({ role: m.role, content: m.content }));
    const summaryResult = await summarizeConversation(messages);

    // Store summary in learning profile
    const profile = await getOrCreateProfile(userId);
    await profile.addSessionSummary(
      session._id,
      summaryResult.summary,
      summaryResult.topics || []
    );

    // Clear L4 session memories (temporary clarifications)
    await UserMemory.clearSessionMemories(userId, session._id);

    return res.json({
      message: 'Session summarized',
      summary: summaryResult.summary,
      topics: summaryResult.topics,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Session end error', error: error.message });
  }
};

/**
 * GET /api/ai/chat/memories
 * Returns the user's stored AI memories (what the AI knows about them).
 */
export const getUserMemories = async (req, res) => {
  try {
    const memories = await UserMemory.find({ userId: req.userId, active: true })
      .sort({ relevanceScore: -1 })
      .lean();

    const profile = await getOrCreateProfile(req.userId);

    return res.json({
      memories: memories.map(m => ({
        id: m._id,
        fact: m.fact,
        category: m.category,
        type: m.memoryType,
        confidence: m.confidence,
        relevance: m.relevanceScore,
        hitCount: m.hitCount,
        version: m.version,
        previousFact: m.previousFact,
        confirmed: m.userConfirmed,
        createdAt: m.createdAt,
      })),
      stats: {
        totalMemories: memories.length,
        totalSessions: profile.totalSessions,
        totalMessages: profile.totalMessages,
        satisfactionRate: profile.satisfactionRate,
        preferredLength: profile.preferredResponseLength,
        topTopics: profile.getTopTopics(5),
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load memories', error: error.message });
  }
};

/**
 * DELETE /api/ai/chat/memories/:memoryId
 * User can delete a specific memory (correct wrong facts).
 */
export const deleteMemory = async (req, res) => {
  try {
    const result = await UserMemory.findOneAndUpdate(
      { _id: req.params.memoryId, userId: req.userId },
      { active: false }
    );
    if (!result) return res.status(404).json({ message: 'Memory not found' });
    return res.json({ message: 'Memory deleted' });
  } catch (error) {
    return res.status(500).json({ message: 'Delete error', error: error.message });
  }
};

/**
 * PUT /api/ai/chat/memories/:memoryId/confirm
 * User confirms a memory is correct — boosts confidence.
 */
export const confirmMemory = async (req, res) => {
  try {
    const mem = await UserMemory.findOne({ _id: req.params.memoryId, userId: req.userId });
    if (!mem) return res.status(404).json({ message: 'Memory not found' });

    mem.userConfirmed = true;
    mem.confidence = Math.min(1.0, mem.confidence + 0.15);
    mem.source = 'user_confirmed';
    await mem.save();

    return res.json({ message: 'Memory confirmed', confidence: mem.confidence });
  } catch (error) {
    return res.status(500).json({ message: 'Confirm error', error: error.message });
  }
};

/**
 * DELETE /api/ai/chat/memories/reset
 * Full memory reset — deactivates all memories (privacy).
 */
export const resetAllMemories = async (req, res) => {
  try {
    const result = await resetMemories(req.userId);
    return res.json({ message: 'All memories reset', ...result });
  } catch (error) {
    return res.status(500).json({ message: 'Reset error', error: error.message });
  }
};

/**
 * GET /api/ai/chat/memories/export
 * Export all user memories as JSON (GDPR-friendly).
 */
export const exportAllMemories = async (req, res) => {
  try {
    const memories = await exportMemories(req.userId);
    return res.json({ memories, exportedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ message: 'Export error', error: error.message });
  }
};

/**
 * GET /api/ai/chat/analytics
 * Return learning analytics for the user.
 */
export const getAnalytics = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.userId);
    const totalMemories = await UserMemory.countDocuments({ userId: req.userId, active: true });
    const memoriesByLevel = await UserMemory.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.userId), active: true } },
      { $group: { _id: "$memoryLevel", count: { $sum: 1 }, avgImportance: { $avg: "$importanceScore" } } },
      { $sort: { _id: 1 } },
    ]);

    return res.json({
      analytics: profile.analytics || {},
      memoryStats: {
        total: totalMemories,
        byLevel: memoriesByLevel,
      },
      interactionStats: {
        totalMessages: profile.totalMessages,
        totalSessions: profile.totalSessions,
        avgMessagesPerSession: profile.avgMessagesPerSession,
        satisfactionRate: profile.satisfactionRate,
      },
      styleProfile: profile.styleProfile || {},
      topTopics: profile.getTopTopics(10),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Analytics error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// USER STATE + KNOWLEDGE GRAPH + SIGNALS
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/ai/chat/state
 * Return the user's adaptive state (energy, recovery, predictions, etc.)
 */
export const getUserState = async (req, res) => {
  try {
    const state = await getOrCreateUserState(req.userId);
    return res.json({
      state: {
        energy: state.energy,
        recovery: state.recovery,
        fatigue: state.fatigue,
        sleepQuality: state.sleepQuality,
        adherence: state.adherence,
        consistency: state.consistency,
        motivation: state.motivation,
        stress: state.stress,
        injuryRisk: state.injuryRisk,
        burnoutRisk: state.burnoutRisk,
        plateauRisk: state.plateauRisk,
        trainingMomentum: state.trainingMomentum,
        volumeLoad: state.volumeLoad,
        recommendedIntensity: state.recommendedIntensity,
      },
      predictions: state.predictions,
      lastComputedAt: state.lastComputedAt,
      computeVersion: state.computeVersion,
    });
  } catch (error) {
    return res.status(500).json({ message: 'State error', error: error.message });
  }
};

/**
 * POST /api/ai/chat/state/signal
 * Add a signal to user state (workout_logged, meal_logged, sleep_report, etc.)
 */
export const addStateSignal = async (req, res) => {
  try {
    const { type, value } = req.body;
    const validTypes = ['workout_logged', 'meal_logged', 'feedback', 'missed_day', 'injury_report', 'sleep_report', 'mood_report', 'goal_change'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ message: `Invalid signal type. Valid: ${validTypes.join(', ')}` });
    }
    const state = await addUserSignal(req.userId, type, value || {});
    return res.json({
      message: 'Signal recorded',
      recommendedIntensity: state.recommendedIntensity,
      predictions: state.predictions,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Signal error', error: error.message });
  }
};

/**
 * GET /api/ai/chat/knowledge-graph
 * Return the user's knowledge graph structure.
 */
export const getKnowledgeGraph = async (req, res) => {
  try {
    const graph = await buildKnowledgeGraph(req.userId);
    return res.json(graph);
  } catch (error) {
    return res.status(500).json({ message: 'Graph error', error: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// AUTONOMOUS INTELLIGENCE ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/ai/chat/health
 * Orchestration health dashboard.
 */
export const getOrchestrationHealth = async (req, res) => {
  try {
    const { getHealthDashboard } = await import('../services/diagnosticsService.js');
    const dashboard = await getHealthDashboard();
    return res.json(dashboard);
  } catch (error) {
    return res.status(500).json({ message: 'Health error', error: error.message });
  }
};

/**
 * GET /api/ai/chat/planner
 * Long-horizon planner state.
 */
export const getLongHorizonPlan = async (req, res) => {
  try {
    const { getOrCreatePlan } = await import('../services/plannerService.js');
    const plan = await getOrCreatePlan(req.userId);
    return res.json({
      currentPhase: plan.currentPhase,
      overallAdherence: plan.overallAdherence,
      motivationTrend: plan.motivationTrend,
      burnoutAccumulation: plan.burnoutAccumulation,
      plateauWeeks: plan.plateauWeeks,
      habitStability: plan.habitStability,
      recoveryCyclePhase: plan.recoveryCyclePhase,
      proactiveFlags: plan.proactiveFlags,
      predictions: plan.predictions,
      activeAdaptations: plan.activeAdaptations.filter(a => a.status === 'active'),
      weeklySnapshots: plan.weeklySnapshots.slice(-4),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Planner error', error: error.message });
  }
};

/**
 * GET /api/ai/chat/twin
 * Digital twin state.
 */
export const getDigitalTwin = async (req, res) => {
  try {
    const { getOrCreateTwin } = await import('../services/digitalTwinService.js');
    const twin = await getOrCreateTwin(req.userId);
    return res.json({
      tendencies: twin.tendencies,
      recoveryProfile: twin.recoveryProfile,
      motivationModel: twin.motivationModel,
      adherencePatterns: twin.adherencePatterns,
      fatigueBehavior: twin.fatigueBehavior,
      causalLinks: twin.causalLinks.slice(0, 20),
      observedPatterns: twin.observedPatterns.slice(0, 20),
      simulationAccuracy: twin.simulationAccuracy,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Twin error', error: error.message });
  }
};

/**
 * POST /api/ai/chat/twin/simulate
 * Simulate a plan against user's digital twin.
 */
export const simulatePlanEndpoint = async (req, res) => {
  try {
    const { simulatePlanFull } = await import('../services/digitalTwinService.js');
    const result = await simulatePlanFull(req.userId, req.body.plan, req.body.durationWeeks || 4);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: 'Simulation error', error: error.message });
  }
};

/**
 * GET /api/ai/chat/reasoning
 * Persistent reasoning state.
 */
export const getPersistentReasoning = async (req, res) => {
  try {
    const reasoning = await getOrCreateReasoning(req.userId);
    return res.json({
      assumptions: reasoning.assumptions.filter(a => a.active).slice(0, 20),
      unresolvedQuestions: reasoning.unresolvedQuestions.filter(q => q.status === 'open'),
      activeStrategies: reasoning.activeStrategies,
      pendingClarifications: reasoning.pendingClarifications,
      lastReasoningChain: reasoning.lastReasoningChain,
      reasoningDepth: reasoning.reasoningDepth,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Reasoning error', error: error.message });
  }
};

/**
 * GET /api/ai/chat/memory-health
 * Memory truth engine health report.
 */
export const getMemoryHealthReport = async (req, res) => {
  try {
    const health = await getMemoryHealth(req.userId);
    const needsVerification = await getMemoriesNeedingVerification(req.userId, 5);
    return res.json({
      ...health,
      memoriesNeedingVerification: needsVerification.map(m => ({
        id: m._id, fact: m.fact, category: m.category,
        confidence: m.confidence, truthScore: m.truthScore,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Memory health error', error: error.message });
  }
};

/**
 * GET /api/ai/chat/learning
 * Experience replay learning stats and insights.
 */
export const getLearningInsights = async (req, res) => {
  try {
    const [replayStats, cacheStats] = await Promise.all([
      ExperienceReplay.getLearningStats(req.userId),
      ReasoningCache.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(req.userId) } },
        { $group: {
          _id: '$cacheType',
          count: { $sum: 1 },
          totalHits: { $sum: '$hitCount' },
          avgQuality: { $avg: '$qualityScore' },
        }},
      ]),
    ]);

    const recentFailures = await ExperienceReplay.getFailurePatterns(req.userId, '', 5);

    return res.json({
      experienceReplay: replayStats,
      reasoningCache: cacheStats,
      recentFailures: recentFailures.map(f => ({
        message: f.userMessage?.substring(0, 100),
        issues: f.issues,
        guidance: f.revisionGuidance,
        reason: f.feedbackReason,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Learning insights error', error: error.message });
  }
};
