import express from 'express';
import auth from '../middleware/authMiddleware.js';
import { generateActivityGoal } from '../controllers/aiController.js';
import {
  sendMessage,
  sendMessageStream,
  getSessions,
  getSessionMessages,
  submitFeedback,
  endSession,
  getUserMemories,
  deleteMemory,
  confirmMemory,
  resetAllMemories,
  exportAllMemories,
  getAnalytics,
  getUserState,
  addStateSignal,
  getKnowledgeGraph,
  getOrchestrationHealth,
  getLongHorizonPlan,
  getDigitalTwin,
  simulatePlanEndpoint,
  getPersistentReasoning,
  getMemoryHealthReport,
  getLearningInsights,
} from '../controllers/chatController.js';
import { submitVideo, getResult, getHistory } from '../controllers/videoController.js';

const router = express.Router();

// Existing
router.post('/activity-goal', auth, generateActivityGoal);

// Chat
router.post('/chat', auth, sendMessage);
router.post('/chat/stream', auth, sendMessageStream);
router.get('/chat/sessions', auth, getSessions);
router.get('/chat/sessions/:sessionId', auth, getSessionMessages);

// Feedback & Learning
router.post('/chat/feedback', auth, submitFeedback);
router.post('/chat/end-session', auth, endSession);

// Memory Management
router.get('/chat/memories', auth, getUserMemories);
router.get('/chat/memories/export', auth, exportAllMemories);
router.delete('/chat/memories/reset', auth, resetAllMemories);
router.delete('/chat/memories/:memoryId', auth, deleteMemory);
router.put('/chat/memories/:memoryId/confirm', auth, confirmMemory);

// Analytics
router.get('/chat/analytics', auth, getAnalytics);

// User State & Adaptive Engine
router.get('/chat/state', auth, getUserState);
router.post('/chat/state/signal', auth, addStateSignal);

// Knowledge Graph
router.get('/chat/knowledge-graph', auth, getKnowledgeGraph);

// Autonomous Intelligence
router.get('/chat/health', auth, getOrchestrationHealth);
router.get('/chat/planner', auth, getLongHorizonPlan);
router.get('/chat/twin', auth, getDigitalTwin);
router.post('/chat/twin/simulate', auth, simulatePlanEndpoint);
router.get('/chat/reasoning', auth, getPersistentReasoning);
router.get('/chat/memory-health', auth, getMemoryHealthReport);
router.get('/chat/learning', auth, getLearningInsights);

// Video analysis
router.post('/video/analyze', auth, submitVideo);
router.get('/video/result/:jobId', auth, getResult);
router.get('/video/history', auth, getHistory);

export default router;
