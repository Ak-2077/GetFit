import mongoose from 'mongoose';

const exerciseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    muscleGroup: {
      type: String,
      required: true,
      enum: [
        'chest', 'shoulders', 'biceps', 'triceps', 'forearms',
        'abs', 'obliques',
        'quadriceps', 'hamstrings', 'adductors', 'calves', 'glutes',
        'upper_back', 'lower_back', 'traps',
        'arms', 'legs', 'back', 'core',
      ],
      index: true,
    },
    targetMuscle: {
      type: String,
      trim: true,
      default: '',
    },
    difficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'intermediate',
    },
    instructions: {
      type: [String],
      default: [],
    },
    image: {
      type: String,
      default: '',
    },
    equipment: {
      type: String,
      enum: ['none', 'dumbbell', 'barbell', 'machine', 'cable', 'bodyweight', 'band', 'other'],
      default: 'bodyweight',
    },
    sets: {
      type: String,
      default: '3',
    },
    reps: {
      type: String,
      default: '12',
    },
    duration: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

exerciseSchema.index({ muscleGroup: 1, difficulty: 1 });

export default mongoose.model('Exercise', exerciseSchema);
