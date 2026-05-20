import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Workout from '../models/workout.js';

dotenv.config();

const ALL_EXERCISES = [
  // Upper Chest
  { name: 'Incline Dumbbell Press', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Upper Chest', description: 'Isolates the upper chest using dumbbells.' },
  { name: 'Incline Barbell Bench Press', type: 'gym', duration: '12 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Upper Chest', description: 'Builds mass in the upper pectoral muscles using a barbell.' },
  { name: 'Incline Smith Machine Press', type: 'gym', duration: '10 min', difficulty: 'easy', bodyPart: 'chest', subCategory: 'Upper Chest', description: 'Guided upper chest press.' },
  { name: 'Low To High Cable Fly', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Upper Chest', description: 'Constant tension isolation for the upper chest.' },
  { name: 'Guillotine Press', type: 'gym', duration: '10 min', difficulty: 'hard', bodyPart: 'chest', subCategory: 'Upper Chest', description: 'Neck press for upper chest isolation.' },

  // Middle Chest
  { name: 'Flat Barbell Bench Press', type: 'gym', duration: '12 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Middle Chest', description: 'The gold standard for chest mass and strength.' },
  { name: 'Flat Dumbbell Press', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Middle Chest', description: 'Allows a deeper stretch for the middle chest.' },
  { name: 'Machine Chest Press', type: 'gym', duration: '10 min', difficulty: 'easy', bodyPart: 'chest', subCategory: 'Middle Chest', description: 'Guided press for overall chest development.' },
  { name: 'Dumbbell Squeeze Press', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Middle Chest', description: 'Pressing with dumbbells squeezed together.' },
  { name: 'Hex Press', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Middle Chest', description: 'Neutral grip press emphasizing the inner chest.' },

  // Lower Chest
  { name: 'Decline Bench Press', type: 'gym', duration: '12 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Lower Chest', description: 'Focuses on the lower portion of the pectorals.' },
  { name: 'Chest Dips', type: 'gym', duration: '10 min', difficulty: 'hard', bodyPart: 'chest', subCategory: 'Lower Chest', description: 'Bodyweight compound movement for the lower chest.' },
  { name: 'Decline Dumbbell Press', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Lower Chest', description: 'Dumbbell press on a decline bench.' },
  { name: 'High To Low Cable Fly', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Lower Chest', description: 'Cable cross focusing on the lower chest.' },
  { name: 'Decline Smith Machine Press', type: 'gym', duration: '10 min', difficulty: 'easy', bodyPart: 'chest', subCategory: 'Lower Chest', description: 'Guided lower chest press.' },

  // Isolation Exercises
  { name: 'Pec Deck Fly', type: 'gym', duration: '10 min', difficulty: 'easy', bodyPart: 'chest', subCategory: 'Isolation Exercises', description: 'Machine fly for strict chest isolation.' },
  { name: 'Cable Crossover', type: 'gym', duration: '12 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Isolation Exercises', description: 'Cable isolation for the entire chest.' },
  { name: 'Single Arm Cable Fly', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Isolation Exercises', description: 'Unilateral chest isolation.' },
  { name: 'Dumbbell Fly', type: 'gym', duration: '10 min', difficulty: 'medium', bodyPart: 'chest', subCategory: 'Isolation Exercises', description: 'Classic dumbbell isolation for the pecs.' },
];

const PRO_EXERCISES = [
  'Incline Dumbbell Press', 'Incline Barbell Bench Press', // Upper
  'Flat Barbell Bench Press', 'Flat Dumbbell Press',       // Middle
  'Decline Bench Press', 'Chest Dips',                     // Lower
  'Pec Deck Fly', 'Cable Crossover'                        // Isolation
];

async function seedProChest() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    // Wipe any existing chest workouts that have a subCategory
    const deleted = await Workout.deleteMany({ type: 'gym', bodyPart: 'chest', subCategory: { $exists: true, $ne: '' } });
    console.log(`Cleared ${deleted.deletedCount} existing structured chest exercises.`);
    
    let count = 0;
    
    // Insert Pro Level (only the 8 allowed)
    for (const workout of ALL_EXERCISES) {
      if (PRO_EXERCISES.includes(workout.name)) {
        await Workout.create({ ...workout, level: 'pro' });
        count++;
      }
    }

    // Insert Pro Plus Level (all 19)
    for (const workout of ALL_EXERCISES) {
      await Workout.create({ ...workout, level: 'pro_plus' });
      count++;
    }

    console.log(`Successfully inserted ${count} structured chest exercises.`);
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

seedProChest();
