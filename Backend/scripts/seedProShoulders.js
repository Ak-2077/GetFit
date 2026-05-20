import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Workout from '../models/workout.js';

dotenv.config();

const ALL_EXERCISES = [
  // Front Delts
  { name: 'Dumbbell Front Raise', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'shoulders', subCategory: 'Front Delts', description: 'Isolates the anterior deltoid using dumbbells.' },
  { name: 'Barbell Front Raise', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'shoulders', subCategory: 'Front Delts', description: 'Builds mass in the front delts using a barbell.' },
  { name: 'Arnold Press', type: 'gym', duration: '12 min', difficulty: 'medium', bodyPart: 'shoulders', subCategory: 'Front Delts', description: 'Rotational shoulder press targeting all three heads with emphasis on the front.' },
  { name: 'Plate Front Raise', type: 'gym', duration: '10 min', difficulty: 'easy', bodyPart: 'shoulders', subCategory: 'Front Delts', description: 'Grip a weight plate to build the anterior deltoids.' },
  { name: 'Military Press', type: 'gym', duration: '15 min', difficulty: 'hard', bodyPart: 'shoulders', subCategory: 'Front Delts', description: 'Strict standing barbell press for raw shoulder power.' },

  // Side Delts
  { name: 'Dumbbell Lateral Raise', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'shoulders', subCategory: 'Side Delts', description: 'The gold standard for medial deltoid width.' },
  { name: 'Cable Lateral Raise', type: 'gym', duration: '12 min', difficulty: 'medium', bodyPart: 'shoulders', subCategory: 'Side Delts', description: 'Constant tension isolation for the side delts.' },
  { name: 'Leaning Lateral Raise', type: 'gym', duration: '10 min', difficulty: 'hard', bodyPart: 'shoulders', subCategory: 'Side Delts', description: 'Extended range of motion lateral raise by leaning away from a pole.' },
  { name: 'Machine Lateral Raise', type: 'gym', duration: '10 min', difficulty: 'easy', bodyPart: 'shoulders', subCategory: 'Side Delts', description: 'Guided isolation for strict medial delt activation.' },
  { name: 'Upright Row', type: 'gym', duration: '12 min', difficulty: 'medium', bodyPart: 'shoulders', subCategory: 'Side Delts', description: 'Compound pulling movement for side delts and traps.' },

  // Rear Delts
  { name: 'Reverse Pec Deck Fly', type: 'gym', duration: '12 min', difficulty: 'medium', bodyPart: 'shoulders', subCategory: 'Rear Delts', description: 'Rear delt isolation on the pec deck machine.' },
  { name: 'Bent-Over Rear Delt Fly', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'shoulders', subCategory: 'Rear Delts', description: 'Dumbbell reverse fly for posterior deltoid development.' },
  { name: 'Face Pull', type: 'gym', duration: '12 min', difficulty: 'medium', bodyPart: 'shoulders', subCategory: 'Rear Delts', description: 'Cable pull for rear delts and rotator cuff health.' },
  { name: 'Cable Rear Delt Fly', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'shoulders', subCategory: 'Rear Delts', description: 'Criss-cross cable isolation for the rear delts.' },
  { name: 'Rear Delt Row', type: 'gym', duration: '12 min', difficulty: 'hard', bodyPart: 'shoulders', subCategory: 'Rear Delts', description: 'Wide-grip barbell row flared out to hit the posterior delts.' },
];

const PRO_EXERCISES = [
  'Dumbbell Front Raise', 'Barbell Front Raise',
  'Dumbbell Lateral Raise', 'Cable Lateral Raise'
];

async function seedProShoulders() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    // Wipe any existing shoulder workouts that have a subCategory
    // This prevents duplicates or leftover 'pro' tier ones that we change
    const deleted = await Workout.deleteMany({ type: 'gym', bodyPart: 'shoulders', subCategory: { $exists: true, $ne: '' } });
    console.log(`Cleared ${deleted.deletedCount} existing structured shoulder exercises.`);
    
    let count = 0;
    
    // Insert Pro Level (only the 6 allowed)
    for (const workout of ALL_EXERCISES) {
      if (PRO_EXERCISES.includes(workout.name)) {
        await Workout.create({ ...workout, level: 'pro' });
        count++;
      }
    }

    // Insert Pro Plus Level (all 15)
    for (const workout of ALL_EXERCISES) {
      await Workout.create({ ...workout, level: 'pro_plus' });
      count++;
    }

    console.log(`Successfully inserted ${count} structured shoulder exercises.`);
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

seedProShoulders();
