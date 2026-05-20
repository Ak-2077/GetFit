import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Workout from '../models/workout.js';

dotenv.config();

const WORKOUTS = [
  {
    name: 'Sit-ups',
    type: 'home',
    level: 'basic',
    duration: '10 min',
    difficulty: 'easy',
    description: 'Classic sit-up for core strength',
    bodyPart: 'core',
  },
  {
    name: 'Lateral Raises',
    type: 'gym',
    level: 'basic',
    duration: '10 min',
    difficulty: 'easy',
    description: 'Dumbbell isolation for medial deltoid width.',
    bodyPart: 'shoulders',
  },
  {
    name: 'Reverse Peck Deck Fly',
    type: 'gym',
    level: 'pro',
    duration: '12 min',
    difficulty: 'medium',
    description: 'Rear delt fly on the pec deck machine.',
    bodyPart: 'shoulders',
  },
];

async function upsert() {
  try {
    await connectDB();

    for (const workout of WORKOUTS) {
      const filter = { name: workout.name, type: workout.type };
      const update = { $set: workout };
      const opts = { upsert: true, new: true };
      const res = await Workout.findOneAndUpdate(filter, update, opts);
      console.log('Upserted workout:', res.name, res.type, res.level, res.bodyPart);
    }

    process.exit(0);
  } catch (err) {
    console.error('Upsert failed:', err);
    process.exit(1);
  }
}

upsert();
