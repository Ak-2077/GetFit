import User from '../models/user.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const PLANS = {
  beginner: [
    { focus: 'Full Body', exercises: ['Push Ups 3×10', 'Squats 3×12', 'Plank 3×30s', 'Lunges 3×10'], duration: '25 min', restBetween: '60s' },
    { focus: 'Cardio', exercises: ['Jumping Jacks 3×20', 'Burpees 3×8', 'Mountain Climbers 3×15', 'High Knees 3×20'], duration: '20 min', restBetween: '45s' },
    { focus: 'Rest Day', exercises: ['Light stretching', 'Walk 20 min'], duration: '20 min', restBetween: '—' },
    { focus: 'Upper Body', exercises: ['Push Ups 3×12', 'Tricep Dips 3×10', 'Shoulder Taps 3×15', 'Plank 3×40s'], duration: '25 min', restBetween: '60s' },
    { focus: 'Lower Body', exercises: ['Squats 4×12', 'Lunges 3×10', 'Glute Bridges 3×15', 'Calf Raises 3×20'], duration: '30 min', restBetween: '60s' },
    { focus: 'Core', exercises: ['Crunches 3×15', 'Leg Raises 3×12', 'Russian Twists 3×20', 'Plank 3×45s'], duration: '20 min', restBetween: '45s' },
    { focus: 'Active Recovery', exercises: ['Yoga 20 min', 'Walk 30 min'], duration: '50 min', restBetween: '—' },
  ],
  intermediate: [
    { focus: 'Push (Chest/Shoulders)', exercises: ['Push Ups 4×15', 'Pike Push Ups 3×10', 'Diamond Push Ups 3×10', 'Shoulder Press 3×12'], duration: '35 min', restBetween: '45s' },
    { focus: 'Pull (Back/Biceps)', exercises: ['Pull Ups 4×8', 'Inverted Rows 3×12', 'Bicep Curls 3×12', 'Face Pulls 3×15'], duration: '35 min', restBetween: '45s' },
    { focus: 'Legs & Core', exercises: ['Squats 4×15', 'Lunges 4×12', 'Box Jumps 3×10', 'Plank 3×60s'], duration: '40 min', restBetween: '60s' },
    { focus: 'HIIT Cardio', exercises: ['Burpees 4×10', 'Mountain Climbers 4×20', 'Jump Squats 3×15', 'Sprint Intervals 5×30s'], duration: '25 min', restBetween: '30s' },
    { focus: 'Push (Chest/Triceps)', exercises: ['Bench Press 4×10', 'Incline Push Ups 3×12', 'Tricep Dips 4×10', 'Cable Flyes 3×12'], duration: '35 min', restBetween: '45s' },
    { focus: 'Pull + Arms', exercises: ['Lat Pulldown 4×10', 'Barbell Rows 3×10', 'Hammer Curls 3×12', 'Rear Delt Flyes 3×15'], duration: '35 min', restBetween: '45s' },
    { focus: 'Rest / Flexibility', exercises: ['Foam rolling 15 min', 'Stretching 15 min', 'Walk 30 min'], duration: '60 min', restBetween: '—' },
  ],
  advanced: [
    { focus: 'Chest & Triceps', exercises: ['Bench Press 5×8', 'Incline Press 4×10', 'Cable Flyes 4×12', 'Close Grip Bench 4×10', 'Tricep Pushdowns 4×12'], duration: '50 min', restBetween: '60s' },
    { focus: 'Back & Biceps', exercises: ['Deadlift 5×5', 'Pull Ups 4×10', 'Barbell Rows 4×8', 'Cable Rows 3×12', 'Barbell Curls 4×10'], duration: '50 min', restBetween: '60s' },
    { focus: 'Legs', exercises: ['Squats 5×8', 'Leg Press 4×12', 'Romanian DL 4×10', 'Leg Curls 3×12', 'Calf Raises 4×15'], duration: '55 min', restBetween: '90s' },
    { focus: 'Shoulders & Arms', exercises: ['OHP 4×8', 'Lateral Raises 4×15', 'Face Pulls 3×15', 'Skull Crushers 4×10', 'Preacher Curls 3×12'], duration: '45 min', restBetween: '60s' },
    { focus: 'Full Body Power', exercises: ['Clean & Press 4×6', 'Front Squats 4×8', 'Weighted Pull Ups 4×6', 'Burpee Box Jumps 3×8'], duration: '45 min', restBetween: '90s' },
    { focus: 'HIIT + Core', exercises: ['Tabata Circuits 4 rounds', 'Weighted Plank 3×45s', 'Ab Wheel 3×12', 'Hanging Leg Raises 3×10'], duration: '35 min', restBetween: '30s' },
    { focus: 'Active Recovery', exercises: ['Light swim or jog 30 min', 'Mobility work 20 min'], duration: '50 min', restBetween: '—' },
  ],
};

export const getWorkoutPlan = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await User.findById(userId)
      .select('name level goal weight')
      .lean();

    if (!user) return res.status(404).json({ message: 'User not found' });

    const level = user.level || 'beginner';
    const plan = PLANS[level] || PLANS.beginner;

    const schedule = DAYS.map((day, i) => ({
      day,
      dayIndex: i,
      ...plan[i],
      exerciseCount: plan[i].exercises.length,
    }));

    const totalWeeklyDuration = plan.reduce((s, d) => {
      const mins = parseInt(d.duration) || 0;
      return s + mins;
    }, 0);

    return res.status(200).json({
      userName: user.name || 'User',
      level,
      goal: user.goal || 'maintain',
      schedule,
      totalWeeklyDuration: `${totalWeeklyDuration} min`,
      workoutDays: plan.filter(d => !d.focus.toLowerCase().includes('rest') && !d.focus.toLowerCase().includes('recovery')).length,
      restDays: plan.filter(d => d.focus.toLowerCase().includes('rest') || d.focus.toLowerCase().includes('recovery')).length,
      availableLevels: ['beginner', 'intermediate', 'advanced'],
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate workout plan', error: error.message });
  }
};
