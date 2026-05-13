import Exercise from '../models/exercise.js';

// ── Mapping: specific muscles → broad category fallback ──
const MUSCLE_FALLBACK = {
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  quadriceps: 'legs',
  hamstrings: 'legs',
  adductors: 'legs',
  calves: 'legs',
  glutes: 'legs',
  obliques: 'abs',
  upper_back: 'back',
  lower_back: 'back',
  traps: 'shoulders',
};

/**
 * GET /api/exercises/:muscleGroup
 * Returns exercises for the requested muscle group.
 * Falls back to the broader category if no specific exercises exist.
 */
export const getExercisesByMuscle = async (req, res) => {
  try {
    const muscle = (req.params.muscleGroup || '').trim().toLowerCase();

    if (!muscle) {
      return res.status(400).json({ message: 'muscleGroup parameter is required' });
    }

    // Try exact muscle group first
    let exercises = await Exercise.find({ muscleGroup: muscle })
      .sort({ difficulty: 1, name: 1 })
      .lean();

    let source = 'exact';

    // Fallback to broader category if no results
    if (exercises.length === 0 && MUSCLE_FALLBACK[muscle]) {
      exercises = await Exercise.find({ muscleGroup: MUSCLE_FALLBACK[muscle] })
        .sort({ difficulty: 1, name: 1 })
        .lean();
      source = 'fallback';
    }

    return res.status(200).json({
      muscleGroup: muscle,
      fallbackGroup: source === 'fallback' ? MUSCLE_FALLBACK[muscle] : null,
      exercises,
      count: exercises.length,
      source,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to fetch exercises',
      error: error.message,
    });
  }
};

/**
 * GET /api/exercises
 * Returns all exercises grouped by muscleGroup.
 */
export const getAllExercises = async (req, res) => {
  try {
    const exercises = await Exercise.find()
      .sort({ muscleGroup: 1, difficulty: 1 })
      .lean();

    // Group by muscleGroup
    const grouped = {};
    exercises.forEach((ex) => {
      if (!grouped[ex.muscleGroup]) grouped[ex.muscleGroup] = [];
      grouped[ex.muscleGroup].push(ex);
    });

    return res.status(200).json({
      exercises,
      grouped,
      totalCount: exercises.length,
      muscleGroups: Object.keys(grouped),
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to fetch exercises',
      error: error.message,
    });
  }
};
