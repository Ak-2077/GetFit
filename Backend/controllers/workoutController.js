import Workout from '../models/workout.js';

// ── Subscription → allowed levels mapping ──
const PLAN_LEVELS = {
  free:      ['basic'],
  pro:       ['basic', 'pro'],
  pro_plus:  ['basic', 'pro', 'pro_plus'],
};

// ── Existing endpoint — preserved for 3D animation models ──
const WORKOUT_MODELS = {
  home: {
    legs: {
      mode: 'home',
      bodyPart: 'legs',
      modelId: 'home_legs_situps',
      title: 'Legs Animation',
      source: 'local',
    },
    core: {
      mode: 'home',
      bodyPart: 'core',
      modelId: 'home_core',
      title: 'Core Animation',
      source: 'local',
    },
  },
  gym: {},
};

const normalizeSegment = (value = '') => String(value).trim().toLowerCase();

export const getWorkoutModel = async (req, res) => {
  try {
    const mode = normalizeSegment(req.query.mode);
    const bodyPart = normalizeSegment(req.query.bodyPart);

    if (!mode || !bodyPart) {
      return res.status(400).json({ message: 'mode and bodyPart are required' });
    }

    const config = WORKOUT_MODELS?.[mode]?.[bodyPart];
    if (!config) {
      return res.status(404).json({ message: 'No animation model configured for this selection yet' });
    }

    return res.status(200).json(config);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching workout model', error: error.message });
  }
};

// ── NEW: Get workouts filtered by type + user subscription ──
export const getWorkoutsByType = async (req, res) => {
  try {
    const type = normalizeSegment(req.params.type);
    const bodyPart = normalizeSegment(req.query.bodyPart);

    if (!['home', 'gym', 'ai'].includes(type)) {
      return res.status(400).json({ message: 'Invalid workout type. Must be home, gym, or ai.' });
    }

    const userPlan = req.user?.subscriptionPlan || 'free';
    const allowedLevels = PLAN_LEVELS[userPlan] || PLAN_LEVELS.free;

    // Build query
    const query = { type, level: { $in: allowedLevels } };
    if (bodyPart) query.bodyPart = bodyPart;

    // Fetch only workouts the user's plan allows (and body part if provided)
    const workouts = await Workout.find(query)
      .sort({ level: 1, difficulty: 1 })
      .lean();

    // Also get total count (all levels) so frontend can show "X of Y available"
    const totalAvailable = await Workout.countDocuments({ type });

    return res.status(200).json({
      workouts,
      userPlan,
      allowedLevels,
      totalAvailable,
      filteredCount: workouts.length,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch workouts', error: error.message });
  }
};

// ── NEW: Get ALL workouts (debug / admin) ──
export const getAllWorkouts = async (req, res) => {
  try {
    const userPlan = req.user?.subscriptionPlan || 'free';
    const allowedLevels = PLAN_LEVELS[userPlan] || PLAN_LEVELS.free;

    const workouts = await Workout.find({ level: { $in: allowedLevels } })
      .sort({ type: 1, level: 1 })
      .lean();

    return res.status(200).json({
      workouts,
      userPlan,
      count: workouts.length,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch workouts', error: error.message });
  }
};
