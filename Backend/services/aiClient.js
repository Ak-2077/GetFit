import axios from 'axios';

const AI_BASE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8100';

const aiClient = axios.create({
  baseURL: AI_BASE_URL,
  timeout: 180000, // LLM responses can take time
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Send a chat message to the AI service (orchestrated).
 * @param {Object} params - Full orchestrated request
 */
export const chatCompletion = async (messages, userContext = null, userMemories = [], compiledMemories = "", orchestration = {}) => {
  const res = await aiClient.post('/chat/completions', {
    messages,
    user_context: userContext,
    user_memories: userMemories,
    compiled_memories: compiledMemories,
    response_mode: orchestration.mode || "coach",
    intent: orchestration.intent || "coaching",
    token_budget: orchestration.token_budget || 300,
    trajectory_context: orchestration.trajectory_context || "",
  });
  return res.data;
};

/**
 * Classify user intent and create a task plan.
 * @param {string} message - User message
 * @param {string[]} recentContext - Last 2-3 messages for context
 */
export const classifyIntent = async (message, recentContext = []) => {
  const res = await aiClient.post('/orchestrate/classify', { message, recent_context: recentContext });
  return res.data;
};

/**
 * Self-reflection: check response quality and optionally revise.
 */
export const reflectOnResponse = async (userMessage, aiResponse, userFacts = [], intent = "coaching", mode = "coach") => {
  const res = await aiClient.post('/orchestrate/reflect', {
    user_message: userMessage,
    ai_response: aiResponse,
    user_facts: userFacts,
    intent,
    mode,
  });
  return res.data;
};

/**
 * Analyze user's goal trajectory and behavioral patterns.
 */
export const analyzeTrajectory = async (profileData) => {
  const res = await aiClient.post('/orchestrate/trajectory', profileData);
  return res.data;
};

/**
 * Extract memorable facts from a conversation.
 * @param {Array<{role: string, content: string}>} messages - Conversation messages
 */
export const extractMemories = async (messages) => {
  const res = await aiClient.post('/memory/extract', { messages });
  return res.data;
};

/**
 * Summarize a conversation for long-term storage.
 * @param {Array<{role: string, content: string}>} messages
 */
export const summarizeConversation = async (messages) => {
  const res = await aiClient.post('/memory/summarize', { messages });
  return res.data;
};

/**
 * Detect topics from a user message.
 * @param {string} message
 */
export const detectTopics = async (message) => {
  const res = await aiClient.post('/memory/detect-topics', { message });
  return res.data;
};

/**
 * Generate embedding vector for a text string.
 * @param {string} text
 * @returns {{ embedding: number[] }}
 */
export const embedText = async (text) => {
  const res = await aiClient.post('/embeddings/embed', { text });
  return res.data;
};

/**
 * Generate embeddings for multiple texts in one call.
 * @param {string[]} texts
 * @returns {{ embeddings: number[][] }}
 */
export const embedBatch = async (texts) => {
  const res = await aiClient.post('/embeddings/embed-batch', { texts });
  return res.data;
};

/**
 * Compile raw memories into minimal optimized prompt context.
 * @param {string[]} memories - Raw fact strings
 * @param {number} maxTokens - Token budget
 * @returns {{ compiled: string, original_count: number, token_estimate: number }}
 */
export const compileMemories = async (memories, maxTokens = 300) => {
  const res = await aiClient.post('/embeddings/compile', { memories, max_tokens: maxTokens });
  return res.data;
};

/**
 * Generate a personalized diet plan via AI.
 * @param {Object} params - DietRequest fields
 */
export const generateAIDietPlan = async (params) => {
  const res = await aiClient.post('/diet/generate', params, { timeout: 60000 });
  return res.data;
};

/**
 * Submit a video for async pose/form analysis.
 * @param {string} videoUrl - S3 URL of the uploaded video
 * @param {string|null} exerciseType - Optional exercise type hint
 */
export const analyzeVideo = async (videoUrl, exerciseType = null) => {
  const res = await aiClient.post('/video/analyze', {
    video_url: videoUrl,
    exercise_type: exerciseType,
  });
  return res.data;
};

/**
 * Poll for video analysis results.
 * @param {string} jobId - Job ID from analyzeVideo
 */
export const getVideoResult = async (jobId) => {
  const res = await aiClient.get(`/video/result/${jobId}`);
  return res.data;
};

/**
 * Submit a recorded workout video for async exercise/form analysis.
 * Enqueues an Analysis_Job and returns immediately with a Job_Id (Req 19.1).
 * @param {string} videoUrl - URL of the uploaded video
 * @param {string|null} exerciseHint - Optional exercise type hint
 * @param {string|null} videoSha256 - Optional SHA-256 integrity digest of the upload
 * @returns {{ jobId: string }}
 */
export const submitAnalysis = async (videoUrl, exerciseHint = null, videoSha256 = null) => {
  const res = await aiClient.post('/exercise-analysis/submit', {
    video_url: videoUrl,
    exercise_hint: exerciseHint,
    video_sha256: videoSha256,
  });
  return res.data;
};

/**
 * Cancel a queued or in-flight Analysis_Job (runtime reliability).
 * @param {string} jobId - Job ID from submitAnalysis
 * @returns {{ job_id: string, cancelled: boolean, state: string }}
 */
export const cancelAnalysis = async (jobId) => {
  const res = await aiClient.post(`/exercise-analysis/cancel/${jobId}`);
  return res.data;
};

/**
 * Query the current state and progress of an Analysis_Job (Req 19.8, 20.4).
 * @param {string} jobId - Job ID from submitAnalysis
 * @returns {{ jobState: string, progress: Object }}
 */
export const getAnalysisStatus = async (jobId) => {
  const res = await aiClient.get(`/exercise-analysis/status/${jobId}`);
  return res.data;
};

/**
 * Fetch the AnalysisResult for a completed Analysis_Job (Req 31.2).
 * @param {string} jobId - Job ID from submitAnalysis
 * @returns {Object} The AnalysisResult
 */
export const getAnalysisResult = async (jobId) => {
  const res = await aiClient.get(`/exercise-analysis/result/${jobId}`);
  return res.data;
};

// ─── Version 2 additive methods (Req 52.1, 52.2) ─────────────────────────────
// The following methods are ADDITIVE. They do not modify the signatures or
// behavior of submitAnalysis / getAnalysisStatus / getAnalysisResult above, and
// preserve every existing backend API contract (Req 52.2). They follow the same
// axios `aiClient` pattern and carry only a video HASH — never the video —
// across the duplicate-lookup boundary (privacy preserved, Req 52.5).

/**
 * Ask the AI service whether a prior AnalysisResult already exists for the
 * exact (userId, videoHash, pipelineVersion) triple, so a duplicate submission
 * can return the cached result without re-running the pipeline (Req 34.2).
 * Sends the SHA256 Video_Hash ONLY — never the video bytes.
 * @param {string} userId - End_User identifier.
 * @param {string} videoHash - Local SHA256 hash of the video (hash only).
 * @param {string} pipelineVersion - Pipeline version component of the match key.
 * @returns {{ duplicate: boolean, result?: Object }}
 */
export const lookupDuplicate = async (userId, videoHash, pipelineVersion) => {
  const res = await aiClient.post('/exercise-analysis/duplicate-check', {
    user_id: userId,
    video_hash: videoHash,
    pipeline_version: pipelineVersion,
  });
  return res.data;
};

/**
 * Submit a video for analysis using a completed chunked upload and/or a
 * client-side compressed video (Req 33, 32). Additive alternative to
 * submitAnalysis — references the already-uploaded content by id/URL plus
 * optional compression metadata and video hash; never transmits the video here.
 * @param {Object} params
 * @param {string} [params.uploadSessionId] - Completed chunk-upload session id.
 * @param {string} [params.videoUrl] - URL of the assembled/compressed video.
 * @param {string} [params.videoHash] - SHA256 Video_Hash for duplicate keying.
 * @param {Object} [params.compressionMeta] - Client Compression_Metadata (Req 32.7).
 * @param {string|null} [params.exerciseHint] - Optional exercise type hint.
 * @returns {{ jobId: string }}
 */
export const submitChunkedAnalysis = async ({
  uploadSessionId = null,
  videoUrl = null,
  videoHash = null,
  compressionMeta = null,
  exerciseHint = null,
} = {}) => {
  const res = await aiClient.post('/exercise-analysis/submit-chunked', {
    upload_session_id: uploadSessionId,
    video_url: videoUrl,
    video_hash: videoHash,
    compression_metadata: compressionMeta,
    exercise_hint: exerciseHint,
  });
  return res.data;
};

/**
 * Analyze a single frame of pose keypoints.
 * @param {Array<Array<number>>} keypoints - 17 COCO keypoints [[x,y,conf],...]
 * @param {string|null} exerciseType - Exercise being performed
 */
export const analyzePose = async (keypoints, exerciseType = null) => {
  const res = await aiClient.post('/pose/analyze', {
    keypoints,
    exercise_type: exerciseType,
  });
  return res.data;
};

/**
 * Route tools — LLM decides which tools to use.
 */
export const routeTools = async (message, intent, userProfile = null, userState = null) => {
  const res = await aiClient.post('/agent/route-tools', {
    message, intent, user_profile: userProfile, user_state: userState,
  });
  return res.data;
};

/**
 * Structured reasoning — generate reasoning state before response.
 */
export const structuredReason = async (message, intent, userContext, toolResults = [], userState = null, memories = []) => {
  const res = await aiClient.post('/agent/reason', {
    message, intent, user_context: userContext, tool_results: toolResults,
    user_state: userState, memories,
  });
  return res.data;
};

/**
 * Confidence estimation for a response.
 */
export const estimateConfidence = async (question, response, toolDataUsed = false, userFacts = []) => {
  const res = await aiClient.post('/agent/confidence', {
    question, response, tool_data_used: toolDataUsed, user_facts: userFacts,
  });
  return res.data;
};

/**
 * Behavioral prediction.
 */
export const predictBehavior = async (userState, sessionSummaries = [], adherenceData = null) => {
  const res = await aiClient.post('/agent/predict', {
    user_state: userState, session_summaries: sessionSummaries, adherence_data: adherenceData,
  });
  return res.data;
};

/**
 * Independent evaluator — uses separate model to evaluate response quality.
 */
export const evaluateResponse = async (userMessage, aiResponse, intent, userFacts = [], toolDataUsed = false, userState = null, reasoningState = null) => {
  const res = await aiClient.post('/evaluator/evaluate', {
    user_message: userMessage, ai_response: aiResponse, intent,
    user_facts: userFacts, tool_data_used: toolDataUsed,
    user_state: userState, reasoning_state: reasoningState,
  });
  return res.data;
};

/**
 * Simulate a plan against user's digital twin.
 */
export const simulatePlan = async (plan, userTwin, durationWeeks = 4) => {
  const res = await aiClient.post('/evaluator/simulate', {
    plan, user_twin: userTwin, duration_weeks: durationWeeks,
  });
  return res.data;
};

/**
 * Causal reasoning — identify cause-effect chains.
 */
export const causalReasoning = async (observations, userState = null, timeframe = 'recent') => {
  const res = await aiClient.post('/evaluator/causal', {
    observations, user_state: userState, timeframe,
  });
  return res.data;
};

/**
 * Stream a chat completion via SSE — yields token chunks.
 * Returns a readable stream of SSE events.
 */
export const chatCompletionStream = async (messages, userContext = null, userMemories = [], compiledMemories = "", orchestration = {}) => {
  const res = await aiClient.post('/chat/stream', {
    messages,
    user_context: userContext,
    user_memories: userMemories,
    compiled_memories: compiledMemories,
    response_mode: orchestration.mode || "coach",
    intent: orchestration.intent || "coaching",
    token_budget: orchestration.token_budget || 300,
    trajectory_context: orchestration.trajectory_context || "",
  }, { responseType: 'stream' });
  return res.data;
};

/**
 * Check if the AI service is healthy.
 */
export const aiHealthCheck = async () => {
  const res = await aiClient.get('/health');
  return res.data;
};

export default aiClient;
