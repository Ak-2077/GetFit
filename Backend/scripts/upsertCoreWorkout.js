import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import Workout from '../models/workout.js';

dotenv.config();

async function upsert() {
  try {
    await connectDB();
    const filter = { name: 'Sit-ups', type: 'home' };
    const update = {
      $set: {
        name: 'Sit-ups',
        type: 'home',
        level: 'basic',
        duration: '10 min',
        difficulty: 'easy',
        description: 'Classic sit-up for core strength',
        bodyPart: 'core',
      },
    };
    const opts = { upsert: true, new: true };
    const res = await Workout.findOneAndUpdate(filter, update, opts);
    console.log('Upserted workout:', res.name, res.type, res.level, res.bodyPart);
    process.exit(0);
  } catch (err) {
    console.error('Upsert failed:', err);
    process.exit(1);
  }
}

upsert();
