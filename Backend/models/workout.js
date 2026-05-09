import mongoose from 'mongoose';

const workoutSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['home', 'gym', 'ai'],
      required: true,
    },
    level: {
      type: String,
      enum: ['basic', 'pro', 'pro_plus'],
      required: true,
    },
    duration: {
      type: String,
      required: true,
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium',
    },
    description: {
      type: String,
      default: '',
    },
    bodyPart: {
      type: String,
      enum: ['chest', 'legs', 'shoulders', 'arms', 'back', 'core', 'other'],
      default: 'other',
    },
  },
  { timestamps: true }
);

// Compound index for efficient filtering by type + level
workoutSchema.index({ type: 1, level: 1 });

export default mongoose.model('Workout', workoutSchema);
