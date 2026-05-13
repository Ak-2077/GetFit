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
export const getFoodByBarcode = (barcode) => API.get(`/api/food/barcode/${barcode}`);
export const getFoodById = (id) => API.get(`/api/food/${id}`);
export const addFoodToLog = (data) => API.post('/api/food/log', data);
export const getTodaysFoodLog = () => API.get('/api/food/log/today');
export const removeFoodFromLog = (logId) => API.delete(`/api/food/log/${logId}`);

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
export const getWorkoutsByType = (type) => API.get(`/api/workout/${type}`);
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

// Workout Plan endpoints
export const getWorkoutPlan = () => API.get('/api/workout-plan/plan');

// Subscription endpoints
export const getSubscriptionPlans = () => API.get('/api/subscription/plans');
export const upgradeSubscription = (plan) => API.post('/api/subscription/upgrade', { plan });

// Exercise endpoints (muscle-group specific)
export const getExercisesByMuscle = (muscleGroup) => API.get(`/api/exercises/${muscleGroup}`);
export const getAllExercises = () => API.get('/api/exercises');

export default API;

