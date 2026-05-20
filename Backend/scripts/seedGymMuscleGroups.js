/**
 * Seed script — Gym Muscle Group Exercises (Basic, Pro, Pro Plus)
 * Adds exercises for all major muscle groups across Basic, Pro, and Pro Plus tiers.
 *
 * Run:  node scripts/seedGymMuscleGroups.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Workout from '../models/workout.js';

dotenv.config();

// ─────────────────────────────────────────────────────────────
//  BICEPS
// ─────────────────────────────────────────────────────────────
const BICEPS_BASIC = [
  { name: 'Dumbbell Hammer Curl', duration: '10 min', difficulty: 'easy', description: 'Neutral grip curl for brachialis and brachioradialis development.' },
  { name: 'EZ Bar Curl', duration: '10 min', difficulty: 'easy', description: 'Angled grip barbell curl reducing wrist strain.' },
];

const BICEPS_PRO = [
  { name: 'Incline Dumbbell Curl', duration: '12 min', difficulty: 'medium', description: 'Stretched-position bicep curl on an incline bench for peak contraction.' },
  { name: 'Cable Curl', duration: '10 min', difficulty: 'medium', description: 'Constant tension curl using a low cable pulley.' },
];

const BICEPS_PRO_PLUS = [
  // ── Long Head (outer bicep peak — arm behind body, supinated)
  { name: 'Bayesian Curl',         duration: '12 min', difficulty: 'medium', subCategory: 'Long Head',   description: 'Cable curl behind the body for maximum long-head stretch and peak development.' },
  { name: 'Drag Curl',             duration: '10 min', difficulty: 'medium', subCategory: 'Long Head',   description: 'Barbell dragged up the torso with elbows back for maximum long-head recruitment.' },
  { name: 'Spider Curl',           duration: '10 min', difficulty: 'medium', subCategory: 'Long Head',   description: 'Prone incline curl allowing full arm extension for long-head stretch.' },

  // ── Short Head (inner bicep thickness — arm in front, narrow grip)
  { name: 'Preacher Curl',         duration: '12 min', difficulty: 'medium', subCategory: 'Short Head',  description: 'Arm braced forward on preacher pad — maximally loads the short head.' },
  { name: 'Concentration Curl',    duration: '10 min', difficulty: 'medium', subCategory: 'Short Head',  description: 'Elbow anchored to thigh eliminates momentum — pure short head isolation.' },
  { name: 'Machine Preacher Curl', duration: '12 min', difficulty: 'medium', subCategory: 'Short Head',  description: 'Guided preacher curl machine for consistent short head tension at peak.' },

  // ── Brachialis (underlying muscle pushing bicep up — neutral / overhand grip)
  { name: 'Cross Body Hammer Curl', duration: '10 min', difficulty: 'medium', subCategory: 'Brachialis', description: 'Neutral grip curl across the body — peak brachialis and brachioradialis load.' },
  { name: 'Reverse EZ Bar Curl',    duration: '10 min', difficulty: 'hard',   subCategory: 'Brachialis', description: 'Overhand grip curl — shifts stress entirely to brachialis and forearm extensors.' },
];

// ─────────────────────────────────────────────────────────────
//  TRICEPS
// ─────────────────────────────────────────────────────────────
const TRICEPS_BASIC = [
  { name: 'Tricep Rope Pushdown', duration: '10 min', difficulty: 'easy', description: 'Cable pushdown with rope attachment for tricep isolation.' },
  { name: 'Overhead Tricep Extension', duration: '10 min', difficulty: 'easy', description: 'Dumbbell or cable overhead extension for the long head.' },
];

const TRICEPS_PRO = [
  { name: 'V-Bar Pushdown', duration: '10 min', difficulty: 'medium', description: 'Angled bar pushdown for lateral and medial head activation.' },
  { name: 'Diamond Push-up', duration: '10 min', difficulty: 'medium', description: 'Close-hand push-up variation targeting triceps heavily.' },
];

const TRICEPS_PRO_PLUS = [
  // ── Long Head (largest head — activated overhead / fully stretched)
  { name: 'EZ Bar Skull Crusher',      duration: '12 min', difficulty: 'medium', subCategory: 'Long Head',    description: 'Lying extension bringing bar to forehead — maximum long head stretch and load.' },
  { name: 'Ring Tricep Extension',      duration: '12 min', difficulty: 'hard',   subCategory: 'Long Head',    description: 'Overhead bodyweight extension on rings — long head under full stretch.' },
  { name: 'Weighted Dips',             duration: '15 min', difficulty: 'hard',   subCategory: 'Long Head',    description: 'Parallel dips with forward lean and added weight — heavy long head compound.' },

  // ── Lateral Head (outer sweep — visible from the side, activated in pushdowns)
  { name: 'Tate Press',                duration: '12 min', difficulty: 'hard',   subCategory: 'Lateral Head', description: 'Elbows-flared dumbbell press with elbows out — isolates the lateral head.' },
  { name: 'Cable Kickback',            duration: '10 min', difficulty: 'medium', subCategory: 'Lateral Head', description: 'Arm fully extended back — peak lateral head contraction at lockout.' },
  { name: 'JM Press',                  duration: '12 min', difficulty: 'hard',   subCategory: 'Lateral Head', description: 'Hybrid press — heavy lateral and medial head overload close to lockout.' },

  // ── Medial Head (deepest — supports lockout, active at all angles)
  { name: 'Close Grip Bench Press',    duration: '15 min', difficulty: 'hard',   subCategory: 'Medial Head',  description: 'Narrow grip press — medial head dominates through full lock-out range.' },
  { name: 'Single Arm Reverse Pushdown', duration: '10 min', difficulty: 'medium', subCategory: 'Medial Head', description: 'Reverse grip unilateral pushdown targeting the medial head at full extension.' },
];

// ─────────────────────────────────────────────────────────────
//  FOREARMS
// ─────────────────────────────────────────────────────────────
const FOREARMS_BASIC = [
  { name: 'Wrist Curl', duration: '8 min', difficulty: 'easy', description: 'Seated barbell or dumbbell wrist curl for forearm flexors.' },
  { name: 'Reverse Wrist Curl', duration: '8 min', difficulty: 'easy', description: 'Overhand wrist curl targeting forearm extensors.' },
];

const FOREARMS_PRO = [
  { name: 'Hammer Curl', duration: '10 min', difficulty: 'medium', description: 'Neutral grip curl developing brachioradialis and forearm thickness.' },
  { name: 'Farmer Walk', duration: '10 min', difficulty: 'medium', description: 'Loaded carry developing grip strength and forearm endurance.' },
];

const FOREARMS_PRO_PLUS = [
  { name: 'Plate Pinch Hold', duration: '10 min', difficulty: 'hard', description: 'Pinching weight plates together to build finger and grip strength.' },
  { name: 'Behind The Back Wrist Curl', duration: '8 min', difficulty: 'medium', description: 'Extended range wrist curl targeting the forearm flexors.' },
  { name: 'Fat Grip Farmer Carry', duration: '10 min', difficulty: 'hard', description: 'Thick bar loaded carry for massive forearm and grip development.' },
  { name: 'Dead Hangs', duration: '8 min', difficulty: 'medium', description: 'Hanging from a bar to build grip and forearm endurance.' },
  { name: 'Towel Pull-Ups', duration: '12 min', difficulty: 'hard', description: 'Pull-ups gripping towels for extreme grip and forearm challenge.' },
  { name: 'Wrist Roller', duration: '8 min', difficulty: 'medium', description: 'Rolling weight on a wrist roller for full forearm development.' },
  { name: 'Lever Bar Rotation', duration: '8 min', difficulty: 'hard', description: 'Rotating a lever bar to build forearm pronation and supination strength.' },
  { name: 'Reverse Grip Cable Curl', duration: '10 min', difficulty: 'medium', description: 'Cable curl with overhand grip for brachioradialis and forearm extensors.' },
];

// ─────────────────────────────────────────────────────────────
//  ABS
// ─────────────────────────────────────────────────────────────
const ABS_BASIC = [
  { name: 'Crunches', duration: '10 min', difficulty: 'easy', description: 'Classic abdominal crunch for rectus abdominis activation.' },
  { name: 'Leg Raises', duration: '10 min', difficulty: 'easy', description: 'Supine leg raise for lower ab and hip flexor engagement.' },
];

const ABS_PRO = [
  { name: 'Cable Crunch', duration: '10 min', difficulty: 'medium', description: 'Kneeling cable crunch for progressive loaded ab training.' },
  { name: 'Hollow Body Hold', duration: '10 min', difficulty: 'medium', description: 'Core compression isometric for full ab tension.' },
];

const ABS_PRO_PLUS = [
  // ── Upper Abs (top of rectus abdominis — shortened position, curl-type movements)
  { name: 'Decline Sit-Up',       duration: '10 min', difficulty: 'medium', subCategory: 'Upper Abs', description: 'Full range decline sit-up — upper rectus abdominis through complete ROM.' },
  { name: 'Weighted Cable Crunch', duration: '12 min', difficulty: 'hard',   subCategory: 'Upper Abs', description: 'Heavy kneeling cable crunch — progressive overload for upper ab hypertrophy.' },
  { name: 'Ab Wheel Rollout',     duration: '10 min', difficulty: 'hard',   subCategory: 'Upper Abs', description: 'Anti-extension rollout — upper abs and serratus resist spinal extension.' },

  // ── Middle Abs (mid section of rectus abdominis — full contraction exercises)
  { name: 'V-Ups',                duration: '10 min', difficulty: 'medium', subCategory: 'Middle Abs', description: 'Simultaneous upper and lower crunch — peaks the mid rectus abdominis.' },
  { name: 'Dragon Flag',          duration: '12 min', difficulty: 'hard',   subCategory: 'Middle Abs', description: 'Bruce Lee-style full body lever — mid abs brace the entire rigid plank.' },

  // ── Lower Abs (lower rectus and transverse — hip flexion, leg raise movements)
  { name: 'Hanging Leg Raise',    duration: '10 min', difficulty: 'hard',   subCategory: 'Lower Abs', description: 'Dead hang leg raise — lower abs and hip flexors through full range.' },
  { name: 'Toes To Bar',          duration: '10 min', difficulty: 'hard',   subCategory: 'Lower Abs', description: 'Toes pulled to bar — peak lower ab compression at full hip flexion.' },
  { name: 'L-Sit Hold',           duration: '10 min', difficulty: 'hard',   subCategory: 'Lower Abs', description: 'Hip flexor isometric — lower abs held under maximum static tension.' },
];

// ─────────────────────────────────────────────────────────────
//  OBLIQUES
// ─────────────────────────────────────────────────────────────
const OBLIQUES_BASIC = [
  { name: 'Side Plank', duration: '8 min', difficulty: 'easy', description: 'Lateral core isometric hold targeting the obliques.' },
  { name: 'Bicycle Crunch', duration: '8 min', difficulty: 'easy', description: 'Rotating crunch for oblique and rectus abdominis activation.' },
];

const OBLIQUES_PRO = [
  { name: 'Wood Chopper', duration: '10 min', difficulty: 'medium', description: 'Diagonal cable chop for rotational core strength and obliques.' },
  { name: 'Russian Twist', duration: '10 min', difficulty: 'medium', description: 'Seated rotation with weight for oblique endurance and strength.' },
];

const OBLIQUES_PRO_PLUS = [
  { name: 'Landmine Rotation', duration: '12 min', difficulty: 'hard', description: 'Rotational landmine press for explosive oblique and core strength.' },
  { name: 'Hanging Oblique Raise', duration: '10 min', difficulty: 'hard', description: 'Side-bent leg raise from a dead hang for lateral oblique peak.' },
  { name: 'Medicine Ball Twist', duration: '10 min', difficulty: 'medium', description: 'Rotational slam or pass for oblique power and core conditioning.' },
  { name: 'Cable Side Bend', duration: '10 min', difficulty: 'medium', description: 'Lateral cable bend for oblique isolation and hypertrophy.' },
  { name: 'Windshield Wipers', duration: '10 min', difficulty: 'hard', description: 'Hanging leg rotation for extreme oblique and core rotational strength.' },
  { name: 'Side Plank Hip Lift', duration: '10 min', difficulty: 'medium', description: 'Dynamic side plank with hip dip for oblique endurance.' },
  { name: 'Dumbbell Side Bend', duration: '10 min', difficulty: 'medium', description: 'Standing lateral bend with dumbbell for oblique isolation.' },
  { name: 'Russian Twist Hold', duration: '10 min', difficulty: 'hard', description: 'Isometric hold at oblique peak for time under tension.' },
];

// ─────────────────────────────────────────────────────────────
//  QUADS
// ─────────────────────────────────────────────────────────────
const QUADS_BASIC = [
  { name: 'Goblet Squat', duration: '12 min', difficulty: 'easy', description: 'Dumbbell or kettlebell squat for quad and glute development.' },
  { name: 'Wall Sit', duration: '8 min', difficulty: 'easy', description: 'Isometric quad hold against a wall for endurance.' },
];

const QUADS_PRO = [
  { name: 'Front Squat', duration: '15 min', difficulty: 'medium', description: 'Barbell front rack squat with quad-dominant mechanics.' },
  { name: 'Leg Extension', duration: '10 min', difficulty: 'medium', description: 'Machine isolation for quadricep development.' },
];

const QUADS_PRO_PLUS = [
  { name: 'Barbell Hack Squat', duration: '15 min', difficulty: 'hard', description: 'Behind-the-leg barbell squat for quad isolation and sweep.' },
  { name: 'Pistol Squat', duration: '15 min', difficulty: 'hard', description: 'Single-leg full depth squat requiring balance, strength and mobility.' },
  { name: 'Sissy Squat', duration: '12 min', difficulty: 'hard', description: 'Extreme quad isolation leaning back while knee tracks forward.' },
  { name: 'Deficit Bulgarian Split Squat', duration: '15 min', difficulty: 'hard', description: 'Rear foot elevated split squat with front foot elevated for extra depth.' },
  { name: 'Pause Front Squat', duration: '15 min', difficulty: 'hard', description: 'Front squat with pause at bottom for quad strength out of the hole.' },
  { name: 'Smith Machine Squat', duration: '15 min', difficulty: 'medium', description: 'Guided barbell squat for quad-focused loading without balance demands.' },
  { name: 'Jump Squat', duration: '12 min', difficulty: 'hard', description: 'Explosive squat jump for quad power and fast-twitch development.' },
  { name: 'Walking Barbell Lunges', duration: '12 min', difficulty: 'hard', description: 'Barbell loaded walking lunges for quad and glute hypertrophy.' },
];

// ─────────────────────────────────────────────────────────────
//  ADDUCTORS
// ─────────────────────────────────────────────────────────────
const ADDUCTORS_BASIC = [
  { name: 'Cable Hip Adduction', duration: '10 min', difficulty: 'easy', description: 'Cable machine adduction for inner thigh isolation.' },
  { name: 'Adductor Machine', duration: '10 min', difficulty: 'easy', description: 'Seated machine press for inner thigh and adductor development.' },
];

const ADDUCTORS_PRO = [
  { name: 'Sumo Squat', duration: '12 min', difficulty: 'medium', description: 'Wide stance squat emphasizing adductors and inner thighs.' },
  { name: 'Side Lunge', duration: '10 min', difficulty: 'medium', description: 'Lateral lunge targeting adductors and inner quad.' },
];

const ADDUCTORS_PRO_PLUS = [
  { name: 'Sumo Deadlift', duration: '20 min', difficulty: 'hard', description: 'Wide stance deadlift loading the adductors and glutes heavily.' },
  { name: 'Cossack Squat', duration: '12 min', difficulty: 'hard', description: 'Deep lateral squat with extreme adductor and hip flexor stretch.' },
  { name: 'Copenhagen Adduction', duration: '10 min', difficulty: 'hard', description: 'Side plank with top leg elevated for adductor bodyweight loading.' },
  { name: 'Wide Stance Leg Press', duration: '12 min', difficulty: 'medium', description: 'Wide stance leg press for adductor and inner quad emphasis.' },
  { name: 'Resistance Band Adduction', duration: '10 min', difficulty: 'medium', description: 'Standing adduction against resistance band for inner thigh isolation.' },
  { name: 'Barbell Sumo Squat', duration: '15 min', difficulty: 'hard', description: 'Wide stance barbell squat for maximal adductor recruitment.' },
  { name: 'Lateral Lunges', duration: '12 min', difficulty: 'medium', description: 'Side lunge loaded with dumbbells for adductor and leg development.' },
  { name: 'Sliding Side Lunges', duration: '10 min', difficulty: 'hard', description: 'Slider lateral lunge for eccentric adductor loading.' },
];

// ─────────────────────────────────────────────────────────────
//  CALVES
// ─────────────────────────────────────────────────────────────
const CALVES_BASIC = [
  { name: 'Standing Calf Raise', duration: '8 min', difficulty: 'easy', description: 'Bodyweight or machine calf raise for gastrocnemius development.' },
  { name: 'Seated Calf Raise', duration: '8 min', difficulty: 'easy', description: 'Machine calf raise for soleus and lower calf development.' },
];

const CALVES_PRO = [
  { name: 'Single Leg Calf Raise', duration: '8 min', difficulty: 'medium', description: 'Unilateral calf raise for balanced lower leg development.' },
  { name: 'Leg Press Calf Raise', duration: '10 min', difficulty: 'medium', description: 'Calf press using the leg press machine for loaded extension.' },
];

const CALVES_PRO_PLUS = [
  { name: 'Donkey Calf Raise', duration: '10 min', difficulty: 'hard', description: 'Bent-over calf raise with partner resistance for peak gastrocnemius.' },
  { name: 'Jump Rope Calf Burn', duration: '10 min', difficulty: 'hard', description: 'High-rep jump rope for calf endurance and explosive conditioning.' },
  { name: 'Single Leg Box Jump', duration: '12 min', difficulty: 'hard', description: 'Unilateral explosive box jump for calf and leg power.' },
  { name: 'Weighted Standing Calf Raise', duration: '10 min', difficulty: 'medium', description: 'Heavy barbell or smith machine calf raise for hypertrophy.' },
  { name: 'Tibialis Raise', duration: '8 min', difficulty: 'medium', description: 'Anterior tibialis strengthening to balance calf development and reduce shin splints.' },
  { name: 'Explosive Calf Hops', duration: '10 min', difficulty: 'hard', description: 'Rapid double-leg hops for fast-twitch calf and ankle strength.' },
  { name: 'Stair Calf Burn', duration: '10 min', difficulty: 'hard', description: 'Step edge full range calf raises for deep gastrocnemius stretch.' },
  { name: 'Smith Machine Calf Raise', duration: '10 min', difficulty: 'medium', description: 'Guided heavy calf raise for consistent range of motion.' },
];

// ─────────────────────────────────────────────────────────────
//  BACK
// ─────────────────────────────────────────────────────────────
const BACK_BASIC = [
  { name: 'Dumbbell Row', duration: '12 min', difficulty: 'easy', description: 'Single arm dumbbell row for back thickness and lat development.' },
  { name: 'Seated Cable Row', duration: '12 min', difficulty: 'easy', description: 'Mid-back and lat development using a seated cable row.' },
];

const BACK_PRO = [
  { name: 'T-Bar Row', duration: '15 min', difficulty: 'medium', description: 'Landmine or lever T-bar row for back thickness and rhomboids.' },
  { name: 'Bent Over Barbell Row', duration: '15 min', difficulty: 'medium', description: 'Compound horizontal pull for overall back mass.' },
];

const BACK_PRO_PLUS = [
  { name: 'Weighted Pull-Up', duration: '15 min', difficulty: 'hard', description: 'Loaded vertical pull for advanced lat and upper back development.' },
  { name: 'Meadows Row', duration: '12 min', difficulty: 'hard', description: 'Landmine unilateral row with deep stretch for lat thickness.' },
  { name: 'Rack Pull', duration: '20 min', difficulty: 'hard', description: 'Partial range deadlift from pins for upper back and trap loading.' },
  { name: 'Pendlay Row', duration: '15 min', difficulty: 'hard', description: 'Explosive strict barbell row from the floor for back strength.' },
  { name: 'Seal Row', duration: '12 min', difficulty: 'hard', description: 'Chest-supported prone row eliminating momentum for pure back work.' },
  { name: 'Deficit Deadlift', duration: '20 min', difficulty: 'hard', description: 'Extended range deadlift from an elevated platform for back strength.' },
  { name: 'Machine High Row', duration: '12 min', difficulty: 'medium', description: 'Upper back isolation with high pulley row machine.' },
  { name: 'Chest Supported T-Bar Row', duration: '12 min', difficulty: 'medium', description: 'T-bar row with chest support to eliminate back swing.' },
];

// ─────────────────────────────────────────────────────────────
//  LATS
// ─────────────────────────────────────────────────────────────
const LATS_BASIC = [
  { name: 'Wide Grip Lat Pulldown', duration: '12 min', difficulty: 'easy', description: 'Wide overhand pulldown for lat width development.' },
  { name: 'Straight Arm Pushdown', duration: '10 min', difficulty: 'easy', description: 'Cable straight arm pulldown for lat isolation and mind-muscle connection.' },
];

const LATS_PRO = [
  { name: 'Pull-Up', duration: '12 min', difficulty: 'medium', description: 'Bodyweight vertical pull — the king of lat development.' },
  { name: 'Underhand Lat Pulldown', duration: '12 min', difficulty: 'medium', description: 'Supinated grip pulldown for lower lat sweep activation.' },
];

const LATS_PRO_PLUS = [
  { name: 'Muscle-Up', duration: '15 min', difficulty: 'hard', description: 'Pull-up into dip transition requiring explosive false-grip pulling strength.' },
  { name: 'Weighted Pull-Up', duration: '15 min', difficulty: 'hard', description: 'Loaded pull-up for progressive lat and bicep overload.' },
  { name: 'Archer Pull-Up', duration: '12 min', difficulty: 'hard', description: 'Unilateral side-to-side pull-up for lateral lat focus.' },
  { name: 'Neutral Grip Pull-Up', duration: '12 min', difficulty: 'hard', description: 'Parallel grip pull-up for lat and bicep integration.' },
  { name: 'One Arm Lat Pulldown', duration: '12 min', difficulty: 'hard', description: 'Unilateral lat pulldown for balanced lat development.' },
  { name: 'Straight Arm Cable Pulldown', duration: '10 min', difficulty: 'medium', description: 'Strict lat isolation using straight-arm cable technique.' },
  { name: 'Close Grip Pull-Down', duration: '12 min', difficulty: 'medium', description: 'Narrow grip pulldown for lower lat and inner back development.' },
  { name: 'Resistance Band Pull-Up', duration: '10 min', difficulty: 'medium', description: 'Band-assisted pull-up for lat development at varying resistance.' },
];

// ─────────────────────────────────────────────────────────────
//  TRAPS
// ─────────────────────────────────────────────────────────────
const TRAPS_BASIC = [
  { name: 'Dumbbell Shrug', duration: '10 min', difficulty: 'easy', description: 'Dumbbell shoulder shrug for upper trap thickness.' },
  { name: 'Barbell Shrug', duration: '10 min', difficulty: 'easy', description: 'Barbell loaded shrug for upper and middle trap development.' },
];

const TRAPS_PRO = [
  { name: 'Upright Row', duration: '12 min', difficulty: 'medium', description: 'Barbell or dumbbell upright pull for trap and side delt compound work.' },
  { name: 'Cable Shrug', duration: '10 min', difficulty: 'medium', description: 'Cable machine shrug for constant trap tension.' },
];

const TRAPS_PRO_PLUS = [
  { name: 'Snatch Grip High Pull', duration: '15 min', difficulty: 'hard', description: 'Wide grip explosive pull from floor for upper trap and power.' },
  { name: "Farmer's Walk", duration: '12 min', difficulty: 'hard', description: 'Heavy loaded carry for full trap, grip and core development.' },
  { name: 'Barbell Power Shrug', duration: '12 min', difficulty: 'hard', description: 'Explosive shrug with leg drive for trap power development.' },
  { name: 'Rack Pull Shrug', duration: '15 min', difficulty: 'hard', description: 'Shrug at the top of a rack pull position for upper trap overload.' },
  { name: 'Dumbbell Incline Shrug', duration: '10 min', difficulty: 'medium', description: 'Prone incline shrug for mid and lower trap isolation.' },
  { name: 'Trap Bar Deadlift', duration: '20 min', difficulty: 'hard', description: 'Hex bar deadlift for balanced trap and leg recruitment.' },
  { name: 'Cable Upright Row', duration: '12 min', difficulty: 'medium', description: 'Cable upright row for consistent tension on traps and side delts.' },
  { name: 'Heavy Dumbbell Shrugs', duration: '10 min', difficulty: 'hard', description: 'Max-load dumbbell shrugs for trap hypertrophy.' },
];

// ─────────────────────────────────────────────────────────────
//  GLUTES
// ─────────────────────────────────────────────────────────────
const GLUTES_BASIC = [
  { name: 'Glute Bridge', duration: '10 min', difficulty: 'easy', description: 'Supine hip extension for glute activation and strength.' },
  { name: 'Donkey Kicks', duration: '8 min', difficulty: 'easy', description: 'Quadruped glute kickback for glute isolation and activation.' },
];

const GLUTES_PRO = [
  { name: 'Hip Thrust', duration: '12 min', difficulty: 'medium', description: 'Barbell hip thrust — best exercise for glute mass and strength.' },
  { name: 'Cable Glute Kickback', duration: '10 min', difficulty: 'medium', description: 'Cable kickback for glute isolation with constant tension.' },
];

const GLUTES_PRO_PLUS = [
  { name: 'Barbell Hip Thrust', duration: '15 min', difficulty: 'hard', description: 'Heavy loaded hip thrust for maximum glute hypertrophy and strength.' },
  { name: 'Deficit Reverse Lunge', duration: '12 min', difficulty: 'hard', description: 'Reverse lunge from an elevated platform for deeper glute stretch.' },
  { name: 'Bulgarian Split Squat', duration: '15 min', difficulty: 'hard', description: 'Rear foot elevated split squat for glute and quad mass.' },
  { name: 'Cable Kickback', duration: '10 min', difficulty: 'medium', description: 'Cable rear leg drive for glute isolation at peak contraction.' },
  { name: 'Smith Machine Hip Thrust', duration: '15 min', difficulty: 'medium', description: 'Guided hip thrust for consistent glute loading.' },
  { name: 'Curtsy Lunge', duration: '12 min', difficulty: 'hard', description: 'Cross-behind lunge for glute medius and lateral glute activation.' },
  { name: 'Frog Pumps', duration: '10 min', difficulty: 'medium', description: 'High-rep supine glute pump with heels together for glute activation.' },
  { name: 'Romanian Deadlift', duration: '15 min', difficulty: 'hard', description: 'Hip hinge RDL for glute and hamstring stretch under load.' },
];

// ─────────────────────────────────────────────────────────────
//  HAMSTRINGS
// ─────────────────────────────────────────────────────────────
const HAMSTRINGS_BASIC = [
  { name: 'Lying Leg Curl', duration: '10 min', difficulty: 'easy', description: 'Machine leg curl for hamstring isolation in lying position.' },
  { name: 'Seated Leg Curl', duration: '10 min', difficulty: 'easy', description: 'Machine hamstring curl in seated position for full stretch.' },
];

const HAMSTRINGS_PRO = [
  { name: 'Romanian Deadlift', duration: '15 min', difficulty: 'medium', description: 'Hip hinge movement for hamstring and glute development.' },
  { name: 'Single Leg Curl', duration: '10 min', difficulty: 'medium', description: 'Unilateral machine leg curl for balanced hamstring development.' },
];

const HAMSTRINGS_PRO_PLUS = [
  { name: 'Glute Ham Raise', duration: '12 min', difficulty: 'hard', description: 'GHR machine for eccentric and concentric hamstring strength.' },
  { name: 'Stiff Leg Deadlift', duration: '15 min', difficulty: 'hard', description: 'Straight leg deadlift for hamstring stretch and hip hinge strength.' },
  { name: 'Nordic Ham Curl', duration: '12 min', difficulty: 'hard', description: 'Partner-assisted Nordic curl — extreme hamstring eccentric strength.' },
  { name: 'Single Leg Romanian Deadlift', duration: '12 min', difficulty: 'hard', description: 'Unilateral RDL for hamstring balance and hip stability.' },
  { name: 'Stability Ball Leg Curl', duration: '10 min', difficulty: 'medium', description: 'Supine ball curl for hamstring isolation and core co-activation.' },
  { name: 'Good Mornings', duration: '12 min', difficulty: 'hard', description: 'Barbell good mornings for hamstring, glute and lower back strength.' },
  { name: 'Kettlebell Swing', duration: '12 min', difficulty: 'medium', description: 'Hip hinge explosive swing for hamstring power and conditioning.' },
  { name: 'Deficit Romanian Deadlift', duration: '15 min', difficulty: 'hard', description: 'RDL from an elevated platform for extended hamstring stretch.' },
];

// ─────────────────────────────────────────────────────────────
//  Build the full exercise list
// ─────────────────────────────────────────────────────────────
function buildGroup(arr, level, bodyPart, subCategory) {
  return arr.map((e) => ({ ...e, type: 'gym', level, bodyPart, subCategory }));
}

// Helper that preserves a per-item subCategory if already set
function buildGroupSmart(arr, level, bodyPart, defaultSubCategory) {
  return arr.map((e) => ({
    ...e,
    type: 'gym',
    level,
    bodyPart,
    subCategory: e.subCategory || defaultSubCategory,
  }));
}

const ALL_EXERCISES = [
  // BICEPS — Pro Plus has per-exercise subCategory (Long Head / Short Head / Brachialis)
  ...buildGroup(BICEPS_BASIC,     'basic',    'biceps',  'Biceps'),
  ...buildGroup(BICEPS_PRO,       'pro',      'biceps',  'Biceps'),
  ...buildGroupSmart(BICEPS_PRO_PLUS,  'pro_plus', 'biceps',  'Biceps'),

  // TRICEPS — Pro Plus has per-exercise subCategory (Long Head / Lateral Head / Medial Head)
  ...buildGroup(TRICEPS_BASIC,    'basic',    'triceps', 'Triceps'),
  ...buildGroup(TRICEPS_PRO,      'pro',      'triceps', 'Triceps'),
  ...buildGroupSmart(TRICEPS_PRO_PLUS, 'pro_plus', 'triceps', 'Triceps'),

  // FOREARMS
  ...buildGroup(FOREARMS_BASIC,    'basic',    'forearms', 'Forearms'),
  ...buildGroup(FOREARMS_PRO,      'pro',      'forearms', 'Forearms'),
  ...buildGroup(FOREARMS_PRO_PLUS, 'pro_plus', 'forearms', 'Forearms'),

  // ABS — Pro Plus has per-exercise subCategory (Upper Abs / Middle Abs / Lower Abs)
  ...buildGroup(ABS_BASIC,        'basic',    'abs', 'Abs'),
  ...buildGroup(ABS_PRO,          'pro',      'abs', 'Abs'),
  ...buildGroupSmart(ABS_PRO_PLUS, 'pro_plus', 'abs', 'Abs'),

  // OBLIQUES
  ...buildGroup(OBLIQUES_BASIC,   'basic',    'obliques',   'Obliques'),
  ...buildGroup(OBLIQUES_PRO,     'pro',      'obliques',   'Obliques'),
  ...buildGroup(OBLIQUES_PRO_PLUS,'pro_plus', 'obliques',   'Obliques'),

  // QUADS
  ...buildGroup(QUADS_BASIC,      'basic',    'quads',      'Quads'),
  ...buildGroup(QUADS_PRO,        'pro',      'quads',      'Quads'),
  ...buildGroup(QUADS_PRO_PLUS,   'pro_plus', 'quads',      'Quads'),

  // ADDUCTORS
  ...buildGroup(ADDUCTORS_BASIC,  'basic',    'adductors',  'Adductors'),
  ...buildGroup(ADDUCTORS_PRO,    'pro',      'adductors',  'Adductors'),
  ...buildGroup(ADDUCTORS_PRO_PLUS,'pro_plus','adductors',  'Adductors'),

  // CALVES
  ...buildGroup(CALVES_BASIC,     'basic',    'calves',     'Calves'),
  ...buildGroup(CALVES_PRO,       'pro',      'calves',     'Calves'),
  ...buildGroup(CALVES_PRO_PLUS,  'pro_plus', 'calves',     'Calves'),

  // BACK
  ...buildGroup(BACK_BASIC,       'basic',    'back',       'Back'),
  ...buildGroup(BACK_PRO,         'pro',      'back',       'Back'),
  ...buildGroup(BACK_PRO_PLUS,    'pro_plus', 'back',       'Back'),

  // LATS
  ...buildGroup(LATS_BASIC,       'basic',    'lats',       'Lats'),
  ...buildGroup(LATS_PRO,         'pro',      'lats',       'Lats'),
  ...buildGroup(LATS_PRO_PLUS,    'pro_plus', 'lats',       'Lats'),

  // TRAPS
  ...buildGroup(TRAPS_BASIC,      'basic',    'traps',      'Traps'),
  ...buildGroup(TRAPS_PRO,        'pro',      'traps',      'Traps'),
  ...buildGroup(TRAPS_PRO_PLUS,   'pro_plus', 'traps',      'Traps'),

  // GLUTES
  ...buildGroup(GLUTES_BASIC,     'basic',    'glutes',     'Glutes'),
  ...buildGroup(GLUTES_PRO,       'pro',      'glutes',     'Glutes'),
  ...buildGroup(GLUTES_PRO_PLUS,  'pro_plus', 'glutes',     'Glutes'),

  // HAMSTRINGS
  ...buildGroup(HAMSTRINGS_BASIC,    'basic',    'hamstrings', 'Hamstrings'),
  ...buildGroup(HAMSTRINGS_PRO,      'pro',      'hamstrings', 'Hamstrings'),
  ...buildGroup(HAMSTRINGS_PRO_PLUS, 'pro_plus', 'hamstrings', 'Hamstrings'),
];

// ─────────────────────────────────────────────────────────────
//  Seed runner
// ─────────────────────────────────────────────────────────────
const TARGET_BODY_PARTS = [
  'biceps', 'triceps', 'forearms', 'abs', 'obliques',
  'quads', 'adductors', 'calves', 'back', 'lats', 'traps',
  'glutes', 'hamstrings',
];

async function seed() {
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB');

    // Remove existing exercises for these body parts to prevent duplicates
    const deleted = await Workout.deleteMany({
      type: 'gym',
      bodyPart: { $in: TARGET_BODY_PARTS },
    });
    console.log(`🗑️  Cleared ${deleted.deletedCount} existing muscle-group gym exercises.`);

    const inserted = await Workout.insertMany(ALL_EXERCISES);
    console.log(`✅ Seeded ${inserted.length} gym exercises successfully.\n`);

    const levels = ['basic', 'pro', 'pro_plus'];
    for (const bp of TARGET_BODY_PARTS) {
      const total = inserted.filter((w) => w.bodyPart === bp).length;
      const breakdown = levels.map((l) => {
        const n = inserted.filter((w) => w.bodyPart === bp && w.level === l).length;
        return `${l}: ${n}`;
      }).join(' | ');
      console.log(`  ${bp.padEnd(12)} → ${total} exercises  (${breakdown})`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

seed();
