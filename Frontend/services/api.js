// import axios from "axios";

// const API = axios.create({
//   baseURL: "http://192.168.0.104:5000",
// });

// export default API;

// simple auth call -- adjust endpoint/body to match your backend
// export const authUser = (phone) => API.post('/api/auth/login', { phone });


import axios from "axios";
import Constants from 'expo-constants';

const isLikelyLanIp = (host) => {
  if (!host) return false;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;

  const match172 = host.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }

  return false;
};

const resolveBaseURL = () => {
  const explicitUrl = process.env.EXPO_PUBLIC_API_URL;
  if (explicitUrl) return explicitUrl;

  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.manifest2?.extra?.expoClient?.hostUri ||
    '';

  const host = hostUri.split(':')[0];
  if (isLikelyLanIp(host)) {
    return `http://${host}:5000`;
  }

  return 'http://localhost:5000';
};

// Prefer dynamic host in Expo (same LAN IP as Metro), with optional env override.
const resolvedBaseURL = resolveBaseURL();

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  console.log(`[API] Base URL: ${resolvedBaseURL}`);
}

const API = axios.create({
  baseURL: resolvedBaseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Auth endpoints
export const sendOtpRequest = (data) => API.post('/api/auth/send-otp', data);
export const verifyOtpRequest = (data) => API.post('/api/auth/verify-otp', data);
export const sendEmailOtpRequest = (data) => API.post('/api/auth/send-email-otp', data);
export const verifyEmailOtpRequest = (data) => API.post('/api/auth/verify-email-otp', data);
export const emailPasswordAuthRequest = (data) => API.post('/api/auth/email-auth', data);
export const googleLoginRequest = (data) => API.post('/api/auth/google-login', data);
export const appleLoginRequest = (data) => API.post('/api/auth/apple-login', data);
export const getMe = () => API.get('/api/auth/me');
export const updateProfile = (data) => API.patch('/api/auth/profile', data);
export const changePassword = (data) => API.post('/api/auth/change-password', data);
export const changeEmail = (data) => API.post('/api/auth/change-email', data);
export const forgotPassword = (data) => API.post('/api/auth/forgot-password', data);
export const generateActivityGoal = () => API.post('/api/ai/activity-goal');
export const saveOnboarding = (data) => API.post('/api/user/onboarding', data);
export const getUserProfile = () => API.get('/api/user/profile');
export const updateUserProfile = (data) => API.put('/api/user/profile', data);
export const changeUserPassword = (data) => API.post('/api/user/change-password', data);
export const deleteUserAccount = () => API.delete('/api/user/delete-account');
export const getWeeklyCalories = () => API.get('/api/user/weekly-calories');
export const sendProfileEmailOtp = (data) => API.post('/api/user/send-email-otp', data);
export const verifyProfileEmailOtp = (data) => API.post('/api/user/verify-email-otp', data);
export const setAuthToken = (token) => {
  if (token) {
    API.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete API.defaults.headers.common['Authorization'];
  }
};

// Food endpoints
export const addBrandFood = (data) => API.post('/api/food/add-food', data);
export const getBrandFoods = () => API.get('/api/food/brand-foods');
export const searchFoods = (query) => API.get('/api/food/search', { params: { query } });
export const searchFoodsByName = (q, limit = 15) => API.get('/api/food/search-name', { params: { q, limit } });
export const getFoodByBarcode = (barcode) => API.get(`/api/food/barcode/${barcode}`);
export const getFoodById = (id) => API.get(`/api/food/${id}`);
export const addFoodToLog = (data) => API.post('/api/food/log', data);
export const getTodaysFoodLog = () => API.get('/api/food/log/today');
export const removeFoodFromLog = (logId) => API.delete(`/api/food/log/${logId}`);
export const recognizeFood = (image_base64, mime_type = 'image/jpeg', food_type = 'homemade', cooking_methods = []) =>
  API.post('/api/food/recognize', { image_base64, mime_type, food_type, cooking_methods }, { timeout: 55000 });
export const smartFoodSearch = (foods, cooking_methods = []) =>
  API.post('/api/food/smart-search', { foods, cooking_methods }, { timeout: 30000 });
export const trackFoodMemory = (data) => API.post('/api/food/memory/track', data);
export const getFrequentFoods = () => API.get('/api/food/memory/frequent');
export const getRecentFoodMemory = () => API.get('/api/food/memory/recent');

// Calories tab endpoints
export const searchFoodsAutocomplete = (q, limit = 12) => API.get('/api/foods/search', { params: { q, limit } });
export const getCaloriesToday = () => API.get('/api/calories/today');
export const getCaloriesWeekly = () => API.get('/api/calories/weekly');
export const getCaloriesMacros = () => API.get('/api/calories/macros');
export const logCaloriesMeal = (data) => API.post('/api/calories/log', data);
export const getStepsToday = () => API.get('/api/steps/today');
export const getCaloriesBurn = () => API.get('/api/calories/burn');

// Burn log endpoints
export const addBurnLog = (data) => API.post('/api/burn/log', data);
export const getTodaysBurnLog = () => API.get('/api/burn/log/today');
export const removeBurnLog = (logId) => API.delete(`/api/burn/log/${logId}`);

// Workout model endpoints
export const getWorkoutModel = (mode, bodyPart) =>
  API.get('/api/workout/model', { params: { mode, bodyPart } });

// Workout list endpoints (subscription-filtered)
export const getWorkoutsByType = (type, bodyPart = null) =>
  API.get(`/api/workout/${type}`, bodyPart ? { params: { bodyPart } } : undefined);
export const getAllWorkoutsList = () => API.get('/api/workout/all');

// Feature access endpoints
export const getFeatures = () => API.get('/api/features');

// Search endpoints
export const globalSearch = (q) => API.get('/api/search', { params: { q } });

// BMI endpoints
export const calculateBMI = (data) => API.post('/api/bmi/calculate', data);

// Notification endpoints
export const getNotifications = () => API.get('/api/notifications');
export const getUnreadNotificationCount = () => API.get('/api/notifications/unread-count');
export const markNotificationRead = (id) => API.patch(`/api/notifications/${id}/read`);
export const markAllNotificationsRead = () => API.patch('/api/notifications/read-all');

// BMB (Balance Meal Meter) endpoints
export const calculateBMB = (data) => API.post('/api/bmb/calculate', data);
export const generateBMBPlan = (data) => API.post('/api/bmb/generate', data);

// Diet Plan endpoints
export const getDietPlan = () => API.get('/api/diet/plan');
export const generateAIDiet = (data) => API.post('/api/diet/generate', data);

// Workout Plan endpoints
export const getWorkoutPlan = () => API.get('/api/workout-plan/plan');

// Subscription endpoints (legacy — maps to monthly SKUs; UI should prefer /api/payments/plans)
export const getSubscriptionPlans = () => API.get('/api/subscription/plans');
/** @deprecated Use createRazorpayOrder + verifyRazorpayPayment instead. Returns 410. */
export const upgradeSubscription = (plan) => API.post('/api/subscription/upgrade', { plan });

// ─── Payments (Razorpay) ──────────────────────────────────────
export const getPaymentPlans = () => API.get('/api/payments/plans');
export const createRazorpayOrder = (planId) =>
  API.post('/api/payments/razorpay/create-order', { planId });
export const verifyRazorpayPayment = (payload) =>
  API.post('/api/payments/razorpay/verify', payload);
export const getSubscriptionStatus = () =>
  API.get('/api/payments/subscription/status');
export const restoreSubscription = () =>
  API.post('/api/payments/subscription/restore');
export const cancelSubscription = () =>
  API.post('/api/payments/subscription/cancel');

// ─── Payments (Apple IAP / iOS) ───────────────────────────────
/**
 * Send a StoreKit receipt to the backend for verification.
 * @param {{ receipt: string, productId: string }} payload
 *        receipt: base64 string from RNIap.getReceiptIOS() / transaction.transactionReceipt
 *        productId: the Apple SKU (com.getfit.fitness.pro.monthly etc.)
 */
export const verifyAppleReceipt = (payload) =>
  API.post('/api/payments/apple/verify', payload);

// Nutrition Streak endpoints
export const getMonthlyStreak = (month) => API.get('/api/streaks/monthly', { params: { month } });
export const updateStreak = (data) => API.post('/api/streaks/update', data);
export const getDayStreak = (date) => API.get(`/api/streaks/day/${date}`);

// Exercise endpoints (muscle-group specific)
export const getExercisesByMuscle = (muscleGroup) => API.get(`/api/exercises/${muscleGroup}`);
export const getAllExercises = () => API.get('/api/exercises');

// ── AI Chat ──
export const sendChatMessage = (message, sessionId = null) =>
  API.post('/api/ai/chat', { message, sessionId });

/**
 * Stream chat via SSE using XMLHttpRequest (works in React Native + web).
 * XHR.onprogress fires incrementally as chunks arrive.
 * @param {string} message
 * @param {string|null} sessionId
 * @param {{ onToken, onMeta, onDone, onError }} callbacks
 * @returns {{ abort: () => void }}
 */
export const streamChatMessage = (message, sessionId, { onToken, onMeta, onDone, onError, onStatus }) => {
  const authToken = API.defaults.headers?.common?.Authorization;
  const xhr = new XMLHttpRequest();
  let lastIndex = 0;

  xhr.open('POST', `${resolvedBaseURL}/api/ai/chat/stream`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  if (authToken) xhr.setRequestHeader('Authorization', authToken);

  const parseSSE = (text) => {
    const chunk = text.substring(lastIndex);
    lastIndex = text.length;

    const lines = chunk.split('\n\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'token' && data.token) onToken?.(data.token);
        else if (data.type === 'meta') onMeta?.(data);
        else if (data.type === 'done') onDone?.(data.sessionId, data.latency, data.trace);
        else if (data.type === 'error') onError?.(data.error);
        else if (data.type === 'status') onStatus?.(data.text);
        else if (data.type === 'tier') onStatus?.(null, data.tier);
      } catch (_) {}
    }
  };

  xhr.onprogress = () => {
    if (xhr.responseText) parseSSE(xhr.responseText);
  };

  xhr.onload = () => {
    // Parse any remaining data
    if (xhr.responseText) parseSSE(xhr.responseText);
  };

  xhr.onerror = () => {
    onError?.('Connection failed');
  };

  xhr.ontimeout = () => {
    onError?.('Request timed out');
  };

  xhr.timeout = 60000; // 60s total timeout
  xhr.send(JSON.stringify({ message, sessionId }));

  return { abort: () => xhr.abort() };
};
export const getChatSessions = () =>
  API.get('/api/ai/chat/sessions');
export const getChatSessionMessages = (sessionId) =>
  API.get(`/api/ai/chat/sessions/${sessionId}`);

// ── AI Feedback & Learning ──
export const submitChatFeedback = (sessionId, messageIndex, isPositive, reason = null) =>
  API.post('/api/ai/chat/feedback', { sessionId, messageIndex, isPositive, reason });
export const endChatSession = (sessionId) =>
  API.post('/api/ai/chat/end-session', { sessionId });

// ── AI Memories ──
export const getAIMemories = () =>
  API.get('/api/ai/chat/memories');
export const deleteAIMemory = (memoryId) =>
  API.delete(`/api/ai/chat/memories/${memoryId}`);
export const confirmAIMemory = (memoryId) =>
  API.put(`/api/ai/chat/memories/${memoryId}/confirm`);
export const resetAIMemories = () =>
  API.delete('/api/ai/chat/memories/reset');
export const exportAIMemories = () =>
  API.get('/api/ai/chat/memories/export');

// ── AI Analytics ──
export const getAIAnalytics = () =>
  API.get('/api/ai/chat/analytics');

// ── AI User State & Adaptive Engine ──
export const getAIUserState = () =>
  API.get('/api/ai/chat/state');
export const addAIStateSignal = (type, value = {}) =>
  API.post('/api/ai/chat/state/signal', { type, value });
export const getAIKnowledgeGraph = () =>
  API.get('/api/ai/chat/knowledge-graph');

// ── AI Autonomous Intelligence ──
export const getAIOrchestrationHealth = () =>
  API.get('/api/ai/chat/health');
export const getAILongHorizonPlan = () =>
  API.get('/api/ai/chat/planner');
export const getAIDigitalTwin = () =>
  API.get('/api/ai/chat/twin');
export const simulateAIPlan = (plan, durationWeeks = 4) =>
  API.post('/api/ai/chat/twin/simulate', { plan, durationWeeks });
export const getAIPersistentReasoning = () =>
  API.get('/api/ai/chat/reasoning');
export const getAIMemoryHealth = () =>
  API.get('/api/ai/chat/memory-health');

// ── AI Video Analysis ──
export const submitVideoAnalysis = (videoUrl, exerciseType = null) =>
  API.post('/api/ai/video/analyze', { videoUrl, exerciseType });
export const getVideoAnalysisResult = (jobId) =>
  API.get(`/api/ai/video/result/${jobId}`);
export const getVideoAnalysisHistory = () =>
  API.get('/api/ai/video/history');

export default API;

