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
