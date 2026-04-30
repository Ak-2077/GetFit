import Food from '../models/food.js';

// Built-in exercise database for search
const EXERCISES = [
  { name: 'Push Ups', category: 'chest', muscle: 'Chest, Triceps', caloriesPer10Min: 60, difficulty: 'beginner' },
  { name: 'Pull Ups', category: 'back', muscle: 'Back, Biceps', caloriesPer10Min: 80, difficulty: 'intermediate' },
  { name: 'Squats', category: 'legs', muscle: 'Quads, Glutes', caloriesPer10Min: 70, difficulty: 'beginner' },
  { name: 'Lunges', category: 'legs', muscle: 'Quads, Hamstrings', caloriesPer10Min: 65, difficulty: 'beginner' },
  { name: 'Deadlift', category: 'back', muscle: 'Back, Hamstrings', caloriesPer10Min: 90, difficulty: 'advanced' },
  { name: 'Bench Press', category: 'chest', muscle: 'Chest, Triceps', caloriesPer10Min: 75, difficulty: 'intermediate' },
  { name: 'Plank', category: 'core', muscle: 'Core, Abs', caloriesPer10Min: 40, difficulty: 'beginner' },
  { name: 'Burpees', category: 'full_body', muscle: 'Full Body', caloriesPer10Min: 100, difficulty: 'intermediate' },
  { name: 'Mountain Climbers', category: 'core', muscle: 'Core, Shoulders', caloriesPer10Min: 80, difficulty: 'beginner' },
  { name: 'Jumping Jacks', category: 'cardio', muscle: 'Full Body', caloriesPer10Min: 70, difficulty: 'beginner' },
  { name: 'Bicep Curls', category: 'arms', muscle: 'Biceps', caloriesPer10Min: 45, difficulty: 'beginner' },
  { name: 'Tricep Dips', category: 'arms', muscle: 'Triceps', caloriesPer10Min: 55, difficulty: 'beginner' },
  { name: 'Shoulder Press', category: 'shoulder', muscle: 'Shoulders, Triceps', caloriesPer10Min: 65, difficulty: 'intermediate' },
  { name: 'Crunches', category: 'core', muscle: 'Abs', caloriesPer10Min: 50, difficulty: 'beginner' },
  { name: 'Leg Press', category: 'legs', muscle: 'Quads, Glutes', caloriesPer10Min: 75, difficulty: 'intermediate' },
  { name: 'Lat Pulldown', category: 'back', muscle: 'Lats, Biceps', caloriesPer10Min: 60, difficulty: 'beginner' },
  { name: 'Russian Twists', category: 'core', muscle: 'Obliques', caloriesPer10Min: 55, difficulty: 'beginner' },
  { name: 'Box Jumps', category: 'legs', muscle: 'Quads, Calves', caloriesPer10Min: 85, difficulty: 'intermediate' },
  { name: 'Cable Flyes', category: 'chest', muscle: 'Chest', caloriesPer10Min: 50, difficulty: 'intermediate' },
  { name: 'Hip Thrusts', category: 'legs', muscle: 'Glutes, Hamstrings', caloriesPer10Min: 70, difficulty: 'intermediate' },
];

const WORKOUTS = [
  { name: 'Arms Workout', bodyPart: 'arms', duration: '30 min', exercises: 6 },
  { name: 'Back Workout', bodyPart: 'back', duration: '35 min', exercises: 5 },
  { name: 'Chest Workout', bodyPart: 'chest', duration: '30 min', exercises: 5 },
  { name: 'Core Workout', bodyPart: 'core', duration: '20 min', exercises: 6 },
  { name: 'Legs Workout', bodyPart: 'legs', duration: '40 min', exercises: 6 },
  { name: 'Shoulder Workout', bodyPart: 'shoulder', duration: '30 min', exercises: 5 },
  { name: 'Full Body HIIT', bodyPart: 'full_body', duration: '25 min', exercises: 8 },
  { name: 'Cardio Burn', bodyPart: 'cardio', duration: '20 min', exercises: 5 },
];

export const globalSearch = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.status(400).json({ message: 'Query must be at least 2 characters' });
    }

    const regex = new RegExp(q, 'i');
    const userId = req.userId;

    // Search foods from DB
    const visibilityFilter = {
      $or: [{ source: { $in: ['openfoodfacts', 'custom'] } }, { userId }],
    };

    let foods = [];
    try {
      foods = await Food.find({ $and: [{ $text: { $search: q } }, visibilityFilter] })
        .select('name brand calories protein carbs fat category')
        .sort({ score: { $meta: 'textScore' } })
        .limit(8)
        .lean();
    } catch {
      foods = await Food.find({
        $and: [
          { $or: [{ name: regex }, { brand: regex }] },
          visibilityFilter,
        ],
      })
        .select('name brand calories protein carbs fat category')
        .limit(8)
        .lean();
    }

    // Search exercises
    const exercises = EXERCISES.filter(
      (e) => regex.test(e.name) || regex.test(e.category) || regex.test(e.muscle)
    ).slice(0, 8);

    // Search workouts
    const workouts = WORKOUTS.filter(
      (w) => regex.test(w.name) || regex.test(w.bodyPart)
    ).slice(0, 6);

    // Nutrition = foods with macro details
    const nutrition = foods.slice(0, 5).map((f) => ({
      name: f.name,
      brand: f.brand,
      calories: f.calories,
      protein: f.protein || 0,
      carbs: f.carbs || 0,
      fat: f.fat || 0,
    }));

    return res.status(200).json({ foods, exercises, workouts, nutrition });
  } catch (error) {
    return res.status(500).json({ message: 'Search failed', error: error.message });
  }
};
