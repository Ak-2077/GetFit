/**
 * Seed script — populates the workouts collection with exercise data.
 * Run:  node scripts/seedWorkouts.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Workout from '../models/workout.js';

dotenv.config();

const WORKOUTS = [
  // ═══════════════════════════════════════════════
  //  HOME (Calisthenics) — FREE TIER (10)
  // ═══════════════════════════════════════════════
  { name: 'Push-ups', type: 'home', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Classic chest, tricep and shoulder push — many variations.' },
  { name: 'Bodyweight Squats', type: 'home', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Foundational lower body movement — hip hinge pattern.' },
  { name: 'Lunges', type: 'home', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Unilateral leg strength, balance, and coordination.' },
  { name: 'Plank', type: 'home', level: 'basic', duration: '8 min', difficulty: 'easy', description: 'Core anti-extension isometric — full body tension.' },
  { name: 'Incline Push-ups', type: 'home', level: 'basic', duration: '8 min', difficulty: 'easy', description: 'Beginner push-up regression using elevated surface.' },
  { name: 'Mountain Climbers', type: 'home', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Dynamic core drill with cardio and hip flexor drive.' },
  { name: 'Glute Bridges', type: 'home', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Hip extension for glute activation and posterior chain.' },
  { name: 'Superman Hold', type: 'home', level: 'basic', duration: '8 min', difficulty: 'easy', description: 'Prone lower back extension isometric hold.' },
  { name: 'Jumping Jacks', type: 'home', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Full body warm-up and low-intensity cardio drill.' },
  { name: 'High Knees', type: 'home', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Running in place — hip flexor drive and cardio.' },

  // HOME (Calisthenics) — PRO TIER (10)
  { name: 'Pull-ups', type: 'home', level: 'pro', duration: '12 min', difficulty: 'medium', description: 'Upper body vertical pulling compound — overhand grip.' },
  { name: 'Dips', type: 'home', level: 'pro', duration: '12 min', difficulty: 'medium', description: 'Chest and tricep pressing compound on parallel bars.' },
  { name: 'Hanging Leg Raises', type: 'home', level: 'pro', duration: '10 min', difficulty: 'medium', description: 'Core compression and hip flexor strength hang.' },
  { name: 'Decline Push-ups', type: 'home', level: 'pro', duration: '10 min', difficulty: 'medium', description: 'Upper chest emphasis push from feet elevated.' },
  { name: 'Bulgarian Split Squat', type: 'home', level: 'pro', duration: '12 min', difficulty: 'medium', description: 'Unilateral leg hypertrophy — rear foot elevated.' },
  { name: 'Archer Push-ups', type: 'home', level: 'pro', duration: '12 min', difficulty: 'medium', description: 'Unilateral push-up variation for chest isolation.' },
  { name: 'Commando Pull-ups', type: 'home', level: 'pro', duration: '12 min', difficulty: 'hard', description: 'Alternating grip side-to-side pull-up variation.' },
  { name: 'L-Sit Hold', type: 'home', level: 'pro', duration: '10 min', difficulty: 'hard', description: 'Hip flexor and core compression isometric on bars.' },
  { name: 'Ring Rows', type: 'home', level: 'pro', duration: '12 min', difficulty: 'medium', description: 'Horizontal pull on gymnastics rings — adjustable angle.' },
  { name: 'Nordic Curl', type: 'home', level: 'pro', duration: '10 min', difficulty: 'hard', description: 'Eccentric hamstring strengthening — partner assisted.' },

  // HOME (Calisthenics) — PRO PLUS TIER (10)
  { name: 'Muscle-ups', type: 'home', level: 'pro_plus', duration: '15 min', difficulty: 'hard', description: 'Pull-up into dip transition — requires explosive false-grip pull.' },
  { name: 'Handstand Push-ups', type: 'home', level: 'pro_plus', duration: '15 min', difficulty: 'hard', description: 'Strict vertical pressing — full shoulder strength & balance.' },
  { name: 'Front Lever', type: 'home', level: 'pro_plus', duration: '12 min', difficulty: 'hard', description: 'Full body horizontal isometric — scapula retraction hold.' },
  { name: 'Planche', type: 'home', level: 'pro_plus', duration: '15 min', difficulty: 'hard', description: 'Shoulder-dominant horizontal pressed hold — advanced skill.' },
  { name: 'Pistol Squats', type: 'home', level: 'pro_plus', duration: '12 min', difficulty: 'hard', description: 'Single-leg full depth squat — balance, strength and mobility.' },
  { name: 'Back Lever', type: 'home', level: 'pro_plus', duration: '12 min', difficulty: 'hard', description: 'Posterior shoulder isometric skill on rings or bar.' },
  { name: 'Human Flag', type: 'home', level: 'pro_plus', duration: '12 min', difficulty: 'hard', description: 'Lateral core isometric pressing against vertical pole.' },
  { name: 'One-Arm Push-up', type: 'home', level: 'pro_plus', duration: '15 min', difficulty: 'hard', description: 'Ultimate unilateral pressing strength & balance skill.' },
  { name: 'Typewriter Pull-up', type: 'home', level: 'pro_plus', duration: '12 min', difficulty: 'hard', description: 'Lateral shifting pull-up — unilateral peak tension.' },
  { name: 'Dragon Flag', type: 'home', level: 'pro_plus', duration: '12 min', difficulty: 'hard', description: 'Advanced core lever — full body rigid plank on bench.' },

  // ═══════════════════════════════════════════════
  //  GYM — FREE TIER (10)
  // ═══════════════════════════════════════════════
  { name: 'Bench Press', type: 'gym', level: 'basic', duration: '15 min', difficulty: 'easy', description: 'Barbell chest press — the gold standard for upper body pushing strength.' },
  { name: 'Lat Pulldown', type: 'gym', level: 'basic', duration: '12 min', difficulty: 'easy', description: 'Cable machine exercise targeting the latissimus dorsi and biceps.' },
  { name: 'Leg Press', type: 'gym', level: 'basic', duration: '15 min', difficulty: 'easy', description: 'Machine-based lower body exercise for quads and glutes.' },
  { name: 'Cable Rows', type: 'gym', level: 'basic', duration: '12 min', difficulty: 'easy', description: 'Seated cable row for mid-back thickness and posture improvement.' },
  { name: 'Dumbbell Curls', type: 'gym', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Isolation exercise for bicep peak development.' },
  { name: 'Leg Curl', type: 'gym', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Machine isolation for hamstring development.' },
  { name: 'Shoulder Press Machine', type: 'gym', level: 'basic', duration: '12 min', difficulty: 'easy', description: 'Guided overhead pressing for deltoid development.' },
  { name: 'Chest Fly Machine', type: 'gym', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Isolation movement for chest inner fiber activation.' },
  { name: 'Leg Extension', type: 'gym', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Quad isolation using leg extension machine.' },
  { name: 'Tricep Pushdown', type: 'gym', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Cable isolation for tricep long head development.' },

  // GYM — PRO TIER (10)
  { name: 'Deadlift', type: 'gym', level: 'pro', duration: '20 min', difficulty: 'medium', description: 'Compound posterior chain exercise — king of all lifts.' },
  { name: 'Barbell Rows', type: 'gym', level: 'pro', duration: '15 min', difficulty: 'medium', description: 'Bent over barbell row for back thickness and strength.' },
  { name: 'Overhead Press', type: 'gym', level: 'pro', duration: '15 min', difficulty: 'medium', description: 'Standing barbell press for shoulder and upper chest development.' },
  { name: 'Incline Bench Press', type: 'gym', level: 'pro', duration: '15 min', difficulty: 'medium', description: 'Upper chest-focused pressing movement on an incline bench.' },
  { name: 'Romanian Deadlift', type: 'gym', level: 'pro', duration: '15 min', difficulty: 'medium', description: 'Hip hinge movement for hamstring and glute development.' },
  { name: 'Weighted Pull-ups', type: 'gym', level: 'pro', duration: '15 min', difficulty: 'hard', description: 'Loaded vertical pull for advanced back development.' },
  { name: 'Hack Squat', type: 'gym', level: 'pro', duration: '15 min', difficulty: 'medium', description: 'Machine squat variation targeting quads and glutes.' },
  { name: 'Face Pulls', type: 'gym', level: 'pro', duration: '10 min', difficulty: 'easy', description: 'Rear delt and rotator cuff health exercise.' },
  { name: 'Skull Crushers', type: 'gym', level: 'pro', duration: '12 min', difficulty: 'medium', description: 'Lying tricep extension for long head emphasis.' },
  { name: 'Preacher Curls', type: 'gym', level: 'pro', duration: '10 min', difficulty: 'medium', description: 'Strict bicep isolation eliminating momentum.' },

  // GYM — PRO PLUS TIER (10)
  { name: 'Clean & Jerk', type: 'gym', level: 'pro_plus', duration: '25 min', difficulty: 'hard', description: 'Olympic lift combining explosive power, coordination and full body strength.' },
  { name: 'Snatch', type: 'gym', level: 'pro_plus', duration: '25 min', difficulty: 'hard', description: 'Single-motion Olympic lift — the most technical barbell movement.' },
  { name: 'Front Squats', type: 'gym', level: 'pro_plus', duration: '20 min', difficulty: 'hard', description: 'Quad-dominant squat variation requiring excellent mobility.' },
  { name: 'Pause Squats', type: 'gym', level: 'pro_plus', duration: '20 min', difficulty: 'hard', description: 'Tempo squat with pause at bottom for strength out of the hole.' },
  { name: 'Deficit Deadlift', type: 'gym', level: 'pro_plus', duration: '20 min', difficulty: 'hard', description: 'Extended range deadlift from elevated platform.' },
  { name: 'Viking Press', type: 'gym', level: 'pro_plus', duration: '15 min', difficulty: 'hard', description: 'Landmine overhead press for shoulder power and stability.' },
  { name: 'Zercher Squat', type: 'gym', level: 'pro_plus', duration: '20 min', difficulty: 'hard', description: 'Barbell held in elbow crease for unique core and quad demand.' },
  { name: 'Pendlay Rows', type: 'gym', level: 'pro_plus', duration: '15 min', difficulty: 'hard', description: 'Strict barbell row from floor — explosive pulling strength.' },
  { name: 'Jefferson Deadlift', type: 'gym', level: 'pro_plus', duration: '15 min', difficulty: 'hard', description: 'Straddle stance deadlift for anti-rotation core demand.' },
  { name: 'Sissy Squat', type: 'gym', level: 'pro_plus', duration: '12 min', difficulty: 'hard', description: 'Extreme quad isolation with bodyweight or added load.' },

  // ═══════════════════════════════════════════════
  //  AI TRAINER — FREE TIER (10)
  // ═══════════════════════════════════════════════
  { name: 'Beginner Full Body', type: 'ai', level: 'basic', duration: '20 min', difficulty: 'easy', description: '3-day total body starter routine — AI-generated splits.' },
  { name: '10-min Cardio', type: 'ai', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Short guided cardio session — walking, jogging or cycling.' },
  { name: 'Basic Fat Burn', type: 'ai', level: 'basic', duration: '15 min', difficulty: 'easy', description: 'Low-intensity steady state cardio for fat oxidation.' },
  { name: 'Mobility Routine', type: 'ai', level: 'basic', duration: '12 min', difficulty: 'easy', description: 'Joint health and flexibility — hips, spine, shoulders.' },
  { name: 'Stretch Flow', type: 'ai', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Guided static and dynamic stretching sequence.' },
  { name: 'Posture Fix', type: 'ai', level: 'basic', duration: '12 min', difficulty: 'easy', description: 'Corrective exercise routine for forward head and slouch.' },
  { name: 'Chair Workout', type: 'ai', level: 'basic', duration: '10 min', difficulty: 'easy', description: 'Office-friendly exercises done seated or near a chair.' },
  { name: 'Morning Energize', type: 'ai', level: 'basic', duration: '7 min', difficulty: 'easy', description: 'Wake-up activation flow — 7 minutes to start the day.' },
  { name: 'Breathing Drill', type: 'ai', level: 'basic', duration: '8 min', difficulty: 'easy', description: 'Diaphragmatic breathing and box breathing technique.' },
  { name: 'Step Counter', type: 'ai', level: 'basic', duration: '15 min', difficulty: 'easy', description: 'Daily movement tracking with step and distance goal.' },

  // AI TRAINER — PRO TIER (10)
  { name: 'Personalized Fat Loss', type: 'ai', level: 'pro', duration: '30 min', difficulty: 'medium', description: 'AI-generated calorie deficit and cardio pairing plan.' },
  { name: 'Strength Training Plan', type: 'ai', level: 'pro', duration: '35 min', difficulty: 'medium', description: 'Progressive overload auto-program across 12 weeks.' },
  { name: 'Intermediate HIIT', type: 'ai', level: 'pro', duration: '20 min', difficulty: 'medium', description: 'Interval intensity auto-scaling to heart rate zones.' },
  { name: 'Core Training Program', type: 'ai', level: 'pro', duration: '25 min', difficulty: 'medium', description: '6-week periodized core program — stability to strength.' },
  { name: 'Custom Split', type: 'ai', level: 'pro', duration: '40 min', difficulty: 'medium', description: 'AI selects optimal PPL, Bro, Upper-Lower based on goals.' },
  { name: 'Adaptive Cardio', type: 'ai', level: 'pro', duration: '25 min', difficulty: 'medium', description: 'Auto-adjusting cardio intensity based on weekly feedback.' },
  { name: 'Macro Tracking', type: 'ai', level: 'pro', duration: '15 min', difficulty: 'easy', description: 'Nutrient targets calculated and linked to your workouts.' },
  { name: 'Weekly Planner', type: 'ai', level: 'pro', duration: '30 min', difficulty: 'medium', description: 'Auto-scheduled 7-day program with recovery days included.' },
  { name: 'Recovery Plan', type: 'ai', level: 'pro', duration: '20 min', difficulty: 'easy', description: 'Smart deload and rest day optimizer for overtraining.' },
  { name: 'Speed & Agility Drills', type: 'ai', level: 'pro', duration: '25 min', difficulty: 'hard', description: 'Velocity and direction-change training for athletes.' },

  // AI TRAINER — PRO PLUS TIER (10)
  { name: 'AI Adaptive Plan', type: 'ai', level: 'pro_plus', duration: '45 min', difficulty: 'hard', description: 'Real-time program adjustment based on daily performance data.' },
  { name: 'Real-time Form Guidance', type: 'ai', level: 'pro_plus', duration: '30 min', difficulty: 'medium', description: 'Computer vision rep counting and form correction feedback.' },
  { name: 'HIIT + Strength Hybrid', type: 'ai', level: 'pro_plus', duration: '40 min', difficulty: 'hard', description: 'Combined modality programming for power and conditioning.' },
  { name: 'Endurance Training', type: 'ai', level: 'pro_plus', duration: '45 min', difficulty: 'hard', description: 'AI-coached 5K to marathon running and cycling plans.' },
  { name: 'Smart Progress Tracking', type: 'ai', level: 'pro_plus', duration: '20 min', difficulty: 'medium', description: 'AI-driven performance analytics and plateau detection.' },
  { name: 'Body Scan Analysis', type: 'ai', level: 'pro_plus', duration: '15 min', difficulty: 'easy', description: 'AI body composition tracking via photo measurement tool.' },
  { name: 'Injury Prevention AI', type: 'ai', level: 'pro_plus', duration: '25 min', difficulty: 'medium', description: 'Movement screening protocol to detect imbalance risks.' },
  { name: 'Nutrition AI Coach', type: 'ai', level: 'pro_plus', duration: '30 min', difficulty: 'medium', description: 'Personalised meal planning, timing and supplement AI guide.' },
  { name: 'Goal Predictor', type: 'ai', level: 'pro_plus', duration: '15 min', difficulty: 'easy', description: 'AI timeline and milestone planner with weekly projections.' },
  { name: 'Elite Sport Mode', type: 'ai', level: 'pro_plus', duration: '50 min', difficulty: 'hard', description: 'Sport-specific peak performance plan for competitive athletes.' },
];
// Heuristic mapper: derive bodyPart from workout name when not explicitly provided
function mapNameToBodyPart(name = '') {
  const n = String(name).toLowerCase();
  const chest = ['bench', 'push', 'fly', 'incline', 'bench press', 'decline push'];
  const legs = ['squat', 'lunge', 'leg', 'deadlift', 'pistol', 'hack squat', 'leg press', 'front squat', 'pause squat'];
  const shoulders = ['shoulder', 'overhead', 'press', 'viking', 'arnold', 'shoulder press'];
  const arms = ['curl', 'tricep', 'triceps', 'bicep', 'biceps', 'dip', 'dips', 'skull', 'tricep pushdown', 'preacher curl', 'dumbbell curls'];
  const back = ['row', 'pull', 'lat', 'deadlift', 'pendlay', 'pull', 'pulldown', 'barbell rows', 'lat pulldown', 'face pulls'];
  const core = ['plank', 'crunch', 'situp', 'sit-up', 'leg raise', 'dragon', 'l-sit', 'core', 'mountain climber', 'superman', 'hanging leg raises'];

  const match = (arr) => arr.some(k => n.includes(k));
  if (match(chest)) return 'chest';
  if (match(legs)) return 'legs';
  if (match(shoulders)) return 'shoulders';
  if (match(arms)) return 'arms';
  if (match(back)) return 'back';
  if (match(core)) return 'core';
  return 'other';
}

async function seed() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');
    const deleted = await Workout.deleteMany({});
    console.log(`Cleared ${deleted.deletedCount} existing workouts`);

    // Ensure each workout has a bodyPart field
    const prepared = WORKOUTS.map((w) => ({
      ...w,
      bodyPart: w.bodyPart ? w.bodyPart : mapNameToBodyPart(w.name),
    }));

    const inserted = await Workout.insertMany(prepared);
    console.log(`Seeded ${inserted.length} workouts successfully`);
    for (const type of ['home', 'gym', 'ai']) {
      const count = inserted.filter(w => w.type === type).length;
      console.log(`  ${type}: ${count} workouts`);
    }
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

seed();
