/**
 * Seed script — populates home (bodyweight / calisthenics) exercises
 * organized by body part with subcategories, same structure as gym.
 *
 * Run:  node scripts/seedHomeMuscleGroups.js
 *
 * Tiers:
 *   basic    → free users  (3-5 per body part)
 *   pro      → pro users   (3-5 more per body part)
 *   pro_plus → pro+ users  (all exercises, including advanced)
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Workout from '../models/workout.js';

dotenv.config();

// ─────────────────────────────────────────────────────────────
//  CHEST  (bodyweight)
// ─────────────────────────────────────────────────────────────
const CHEST_BASIC = [
  { name: 'Standard Push-ups', duration: '10 min', difficulty: 'easy', description: 'The classic push-up — chest, triceps and shoulders.', subCategory: 'Middle Chest' },
  { name: 'Wide Push-ups', duration: '10 min', difficulty: 'easy', description: 'Wide hand placement to emphasize the outer chest fibers.', subCategory: 'Middle Chest' },
  { name: 'Knee Push-ups', duration: '8 min', difficulty: 'easy', description: 'Beginner regression with knees on the ground.', subCategory: 'Middle Chest' },
  { name: 'Incline Push-ups', duration: '8 min', difficulty: 'easy', description: 'Hands elevated on a bench — lower chest emphasis.', subCategory: 'Lower Chest' },
];

const CHEST_PRO = [
  { name: 'Decline Push-ups', duration: '10 min', difficulty: 'medium', description: 'Feet elevated push-up for upper chest emphasis.', subCategory: 'Upper Chest' },
  { name: 'Diamond Push-ups', duration: '10 min', difficulty: 'medium', description: 'Narrow hand position for inner chest and triceps.', subCategory: 'Middle Chest' },
  { name: 'Archer Push-ups', duration: '12 min', difficulty: 'medium', description: 'Unilateral pressing — one arm does most of the work.', subCategory: 'Middle Chest' },
  { name: 'Pseudo Planche Push-ups', duration: '10 min', difficulty: 'hard', description: 'Hands turned back, lean forward for upper chest activation.', subCategory: 'Upper Chest' },
];

const CHEST_PRO_PLUS = [
  { name: 'Clap Push-ups', duration: '10 min', difficulty: 'hard', description: 'Explosive plyometric push-up with a mid-air clap.', subCategory: 'Middle Chest' },
  { name: 'One-Arm Push-up', duration: '15 min', difficulty: 'hard', description: 'Ultimate unilateral pressing strength and balance skill.', subCategory: 'Middle Chest' },
  { name: 'Planche Push-ups', duration: '15 min', difficulty: 'hard', description: 'Advanced — push-up from a planche lean position.', subCategory: 'Upper Chest' },
  { name: 'Ring Push-ups', duration: '12 min', difficulty: 'hard', description: 'Unstable rings demand stabilizer and deep chest activation.', subCategory: 'Isolation Exercises' },
  { name: 'Typewriter Push-ups', duration: '12 min', difficulty: 'hard', description: 'Lateral shifting push-up — peak unilateral chest tension.', subCategory: 'Middle Chest' },
];

// ─────────────────────────────────────────────────────────────
//  SHOULDERS  (bodyweight)
// ─────────────────────────────────────────────────────────────
const SHOULDERS_BASIC = [
  { name: 'Pike Push-ups', duration: '10 min', difficulty: 'easy', description: 'Hips high push-up targeting anterior deltoids.', subCategory: 'Front Delts' },
  { name: 'Wall Push-ups', duration: '8 min', difficulty: 'easy', description: 'Beginner vertical pressing against a wall.', subCategory: 'Front Delts' },
  { name: 'Arm Circles', duration: '5 min', difficulty: 'easy', description: 'Dynamic shoulder warm-up and endurance drill.', subCategory: 'Side Delts' },
  { name: 'Shoulder Taps', duration: '8 min', difficulty: 'easy', description: 'Plank position — tap opposite shoulder for stability.', subCategory: 'Front Delts' },
];

const SHOULDERS_PRO = [
  { name: 'Elevated Pike Push-ups', duration: '12 min', difficulty: 'medium', description: 'Feet elevated pike for greater deltoid load.', subCategory: 'Front Delts' },
  { name: 'Hindu Push-ups', duration: '12 min', difficulty: 'medium', description: 'Flowing push-up hitting shoulders, chest and back.', subCategory: 'Front Delts' },
  { name: 'Crab Walk', duration: '10 min', difficulty: 'medium', description: 'Reverse crawl — posterior shoulders and stabilizers.', subCategory: 'Rear Delts' },
  { name: 'Side Plank Reach-Through', duration: '10 min', difficulty: 'medium', description: 'Rotational stability for medial and rear delts.', subCategory: 'Side Delts' },
];

const SHOULDERS_PRO_PLUS = [
  { name: 'Handstand Push-ups', duration: '15 min', difficulty: 'hard', description: 'Full vertical press against a wall — raw shoulder strength.', subCategory: 'Front Delts' },
  { name: 'Freestanding Handstand Hold', duration: '10 min', difficulty: 'hard', description: 'Balance skill — entire shoulder girdle under tension.', subCategory: 'Front Delts' },
  { name: 'Tiger Bend Push-ups', duration: '15 min', difficulty: 'hard', description: 'Elbow-to-handstand transition — extreme shoulder power.', subCategory: 'Front Delts' },
  { name: 'Wall Handstand Shoulder Taps', duration: '12 min', difficulty: 'hard', description: 'Handstand on wall with alternating shoulder taps.', subCategory: 'Side Delts' },
  { name: 'Decline Pike Push-ups', duration: '12 min', difficulty: 'hard', description: 'Feet high on a box pike press — near-vertical pressing.', subCategory: 'Front Delts' },
];

// ─────────────────────────────────────────────────────────────
//  BICEPS  (bodyweight)
// ─────────────────────────────────────────────────────────────
const BICEPS_BASIC = [
  { name: 'Chin-ups', duration: '10 min', difficulty: 'medium', description: 'Supinated grip pull-up — the king of bodyweight bicep builders.', subCategory: 'Short Head' },
  { name: 'Doorframe Curls', duration: '8 min', difficulty: 'easy', description: 'Lean back and curl yourself using a doorframe edge.', subCategory: 'Long Head' },
  { name: 'Towel Curls', duration: '8 min', difficulty: 'easy', description: 'Loop a towel around your foot and curl for resistance.', subCategory: 'Short Head' },
];

const BICEPS_PRO = [
  { name: 'Commando Chin-ups', duration: '12 min', difficulty: 'medium', description: 'Alternating grip pull-up — brachialis and biceps.', subCategory: 'Brachialis' },
  { name: 'Inverted Row Curl Grip', duration: '10 min', difficulty: 'medium', description: 'Supinated inverted row for bicep-focused pulling.', subCategory: 'Short Head' },
  { name: 'Isometric Chin-up Hold', duration: '8 min', difficulty: 'medium', description: 'Hold at top of chin-up for time under tension.', subCategory: 'Long Head' },
];

const BICEPS_PRO_PLUS = [
  { name: 'One-Arm Chin-up Negatives', duration: '12 min', difficulty: 'hard', description: 'Slow eccentric single-arm chin-up descent.', subCategory: 'Long Head' },
  { name: 'Pelican Curls', duration: '12 min', difficulty: 'hard', description: 'Ring-based bodyweight curl — extreme bicep isolation.', subCategory: 'Short Head' },
  { name: 'Headbanger Pull-ups', duration: '10 min', difficulty: 'hard', description: 'Horizontal pumping at the top of a pull-up bar.', subCategory: 'Brachialis' },
  { name: 'Ring Chin-ups', duration: '12 min', difficulty: 'hard', description: 'Supinated grip on rings — unstable bicep builder.', subCategory: 'Short Head' },
];

// ─────────────────────────────────────────────────────────────
//  TRICEPS  (bodyweight)
// ─────────────────────────────────────────────────────────────
const TRICEPS_BASIC = [
  { name: 'Bench Dips', duration: '10 min', difficulty: 'easy', description: 'Hands on a bench behind you — basic tricep isolation.', subCategory: 'Lateral Head' },
  { name: 'Close-Grip Push-ups', duration: '10 min', difficulty: 'easy', description: 'Narrow hand push-up for triceps emphasis.', subCategory: 'Lateral Head' },
  { name: 'Bodyweight Tricep Extension', duration: '10 min', difficulty: 'easy', description: 'Lean on a counter and extend arms — skull crusher motion.', subCategory: 'Long Head' },
];

const TRICEPS_PRO = [
  { name: 'Parallel Bar Dips', duration: '12 min', difficulty: 'medium', description: 'Full dips on bars — tricep dominant with upright torso.', subCategory: 'Lateral Head' },
  { name: 'Sphinx Push-ups', duration: '10 min', difficulty: 'medium', description: 'Forearm to hand transition push-up — tricep focused.', subCategory: 'Long Head' },
  { name: 'Bodyweight Skull Crushers', duration: '10 min', difficulty: 'medium', description: 'Lower forehead to bar and extend — pure tricep.', subCategory: 'Long Head' },
];

const TRICEPS_PRO_PLUS = [
  { name: 'Ring Dips', duration: '12 min', difficulty: 'hard', description: 'Dips on unstable rings — extreme tricep and stabilizer demand.', subCategory: 'Lateral Head' },
  { name: 'Korean Dips', duration: '12 min', difficulty: 'hard', description: 'Dips with bar behind you — deep stretch and contraction.', subCategory: 'Long Head' },
  { name: 'Tiger Bend Press', duration: '15 min', difficulty: 'hard', description: 'Advanced floor transition from forearms to hands.', subCategory: 'Medial Head' },
  { name: 'Weighted Dips Bodyweight Plus', duration: '12 min', difficulty: 'hard', description: 'Add a backpack for progressive overload on dips.', subCategory: 'Lateral Head' },
];

// ─────────────────────────────────────────────────────────────
//  FOREARMS  (bodyweight)
// ─────────────────────────────────────────────────────────────
const FOREARMS_BASIC = [
  { name: 'Dead Hang', duration: '5 min', difficulty: 'easy', description: 'Hang from a bar for grip endurance and forearm strength.', subCategory: 'Forearms' },
  { name: 'Wrist Push-ups', duration: '8 min', difficulty: 'easy', description: 'Push-ups on the back of your wrists for extensors.', subCategory: 'Forearms' },
  { name: 'Finger Tip Push-ups', duration: '8 min', difficulty: 'medium', description: 'Push-ups on fingertips for grip and forearm strength.', subCategory: 'Forearms' },
];

const FOREARMS_PRO = [
  { name: 'Towel Hang', duration: '8 min', difficulty: 'medium', description: 'Hang from a towel draped over a bar — thick grip training.', subCategory: 'Forearms' },
  { name: 'Single Arm Dead Hang', duration: '8 min', difficulty: 'hard', description: 'One-arm bar hang for grip strength and forearm hypertrophy.', subCategory: 'Forearms' },
];

const FOREARMS_PRO_PLUS = [
  { name: 'Towel Pull-ups', duration: '12 min', difficulty: 'hard', description: 'Pull-ups gripping a towel — extreme grip and forearm builder.', subCategory: 'Forearms' },
  { name: 'Plate Pinch Walk', duration: '8 min', difficulty: 'hard', description: 'Pinch two plates together and walk for time.', subCategory: 'Forearms' },
  { name: 'Lever Bar Wrist Rotations', duration: '10 min', difficulty: 'hard', description: 'Rotate a weighted bar for wrist pronation and supination.', subCategory: 'Forearms' },
];

// ─────────────────────────────────────────────────────────────
//  ABS  (bodyweight)
// ─────────────────────────────────────────────────────────────
const ABS_BASIC = [
  { name: 'Crunches', duration: '8 min', difficulty: 'easy', description: 'Classic upper ab contraction — short range isolation.', subCategory: 'Upper Abs' },
  { name: 'Sit-ups', duration: '10 min', difficulty: 'easy', description: 'Full range sit-up for core and hip flexor activation.', subCategory: 'Middle Abs' },
  { name: 'Lying Leg Raises', duration: '10 min', difficulty: 'easy', description: 'Supine leg raise for lower abdominal emphasis.', subCategory: 'Lower Abs' },
  { name: 'Dead Bug', duration: '8 min', difficulty: 'easy', description: 'Anti-extension core drill — opposite arm and leg movement.', subCategory: 'Middle Abs' },
  { name: 'Plank', duration: '8 min', difficulty: 'easy', description: 'Core anti-extension isometric hold — full body tension.', subCategory: 'Middle Abs' },
];

const ABS_PRO = [
  { name: 'V-ups', duration: '10 min', difficulty: 'medium', description: 'Simultaneous upper and lower body crunch — full abs.', subCategory: 'Upper Abs' },
  { name: 'Hanging Leg Raises', duration: '10 min', difficulty: 'medium', description: 'Hang from a bar and raise legs — lower ab focus.', subCategory: 'Lower Abs' },
  { name: 'Flutter Kicks', duration: '10 min', difficulty: 'medium', description: 'Alternating rapid leg kicks while lying supine.', subCategory: 'Lower Abs' },
  { name: 'Mountain Climbers', duration: '10 min', difficulty: 'medium', description: 'Dynamic core drill with cardio and hip flexor drive.', subCategory: 'Middle Abs' },
  { name: 'Ab Wheel Rollout', duration: '10 min', difficulty: 'hard', description: 'Anti-extension rollout for deep core activation.', subCategory: 'Middle Abs' },
];

const ABS_PRO_PLUS = [
  { name: 'Dragon Flag', duration: '12 min', difficulty: 'hard', description: 'Advanced core lever — full body rigid plank on bench.', subCategory: 'Lower Abs' },
  { name: 'L-Sit Hold', duration: '10 min', difficulty: 'hard', description: 'Hip flexor and core compression isometric on bars.', subCategory: 'Lower Abs' },
  { name: 'Toes to Bar', duration: '12 min', difficulty: 'hard', description: 'Hanging toe touch — full range abdominal contraction.', subCategory: 'Upper Abs' },
  { name: 'Hanging Windshield Wipers', duration: '12 min', difficulty: 'hard', description: 'Rotational hanging leg movement — abs and obliques.', subCategory: 'Lower Abs' },
  { name: 'Hollow Body Hold', duration: '10 min', difficulty: 'hard', description: 'Gymnastic core drill — full body curved isometric.', subCategory: 'Middle Abs' },
];

// ─────────────────────────────────────────────────────────────
//  OBLIQUES  (bodyweight)
// ─────────────────────────────────────────────────────────────
const OBLIQUES_BASIC = [
  { name: 'Side Plank', duration: '8 min', difficulty: 'easy', description: 'Lateral core isometric hold — anti-lateral flexion.', subCategory: 'Obliques' },
  { name: 'Russian Twist', duration: '10 min', difficulty: 'easy', description: 'Seated rotational core exercise with or without weight.', subCategory: 'Obliques' },
  { name: 'Side Crunches', duration: '8 min', difficulty: 'easy', description: 'Lying lateral crunch for oblique isolation.', subCategory: 'Obliques' },
];

const OBLIQUES_PRO = [
  { name: 'Bicycle Crunches', duration: '10 min', difficulty: 'medium', description: 'Alternating elbow-to-knee crunch for oblique activation.', subCategory: 'Obliques' },
  { name: 'Side Plank Hip Dips', duration: '10 min', difficulty: 'medium', description: 'Dynamic side plank with hip drops for oblique endurance.', subCategory: 'Obliques' },
  { name: 'Wood Choppers', duration: '10 min', difficulty: 'medium', description: 'Diagonal rotational movement pattern — core power.', subCategory: 'Obliques' },
];

const OBLIQUES_PRO_PLUS = [
  { name: 'Hanging Oblique Raises', duration: '12 min', difficulty: 'hard', description: 'Hang from bar and raise knees to each side alternately.', subCategory: 'Obliques' },
  { name: 'Copenhagen Plank', duration: '10 min', difficulty: 'hard', description: 'Adductor-supported side plank — oblique and inner thigh.', subCategory: 'Obliques' },
  { name: 'Side V-ups', duration: '10 min', difficulty: 'hard', description: 'Lying on side, simultaneously raise legs and torso.', subCategory: 'Obliques' },
];

// ─────────────────────────────────────────────────────────────
//  QUADS  (bodyweight)
// ─────────────────────────────────────────────────────────────
const QUADS_BASIC = [
  { name: 'Bodyweight Squats', duration: '10 min', difficulty: 'easy', description: 'Foundational lower body movement — hip hinge pattern.', subCategory: 'Quads' },
  { name: 'Wall Sit', duration: '8 min', difficulty: 'easy', description: 'Isometric quad hold with back against a wall.', subCategory: 'Quads' },
  { name: 'Forward Lunges', duration: '10 min', difficulty: 'easy', description: 'Step forward and lower — unilateral quad and glute.', subCategory: 'Quads' },
  { name: 'Step-ups', duration: '10 min', difficulty: 'easy', description: 'Step onto an elevated surface for quad activation.', subCategory: 'Quads' },
];

const QUADS_PRO = [
  { name: 'Bulgarian Split Squat', duration: '12 min', difficulty: 'medium', description: 'Rear foot elevated single-leg squat for quad hypertrophy.', subCategory: 'Quads' },
  { name: 'Jump Squats', duration: '10 min', difficulty: 'medium', description: 'Explosive plyometric squat for power and quad development.', subCategory: 'Quads' },
  { name: 'Goblet Squat Hold', duration: '10 min', difficulty: 'medium', description: 'Deep squat isometric hold with arms as counterbalance.', subCategory: 'Quads' },
  { name: 'Reverse Lunges', duration: '10 min', difficulty: 'medium', description: 'Step backward lunge — easier on knees, quad dominant.', subCategory: 'Quads' },
];

const QUADS_PRO_PLUS = [
  { name: 'Pistol Squats', duration: '12 min', difficulty: 'hard', description: 'Single-leg full depth squat — balance, strength and mobility.', subCategory: 'Quads' },
  { name: 'Sissy Squats', duration: '12 min', difficulty: 'hard', description: 'Lean back at the knees for extreme quad isolation.', subCategory: 'Quads' },
  { name: 'Shrimp Squat', duration: '12 min', difficulty: 'hard', description: 'Rear-foot-grab single leg squat — deep quad stretch.', subCategory: 'Quads' },
  { name: 'Box Jump', duration: '10 min', difficulty: 'hard', description: 'Explosive vertical jump onto an elevated box.', subCategory: 'Quads' },
];

// ─────────────────────────────────────────────────────────────
//  ADDUCTORS  (bodyweight)
// ─────────────────────────────────────────────────────────────
const ADDUCTORS_BASIC = [
  { name: 'Side Lunges', duration: '10 min', difficulty: 'easy', description: 'Lateral lunge for inner thigh and adductor stretch.', subCategory: 'Adductors' },
  { name: 'Sumo Squat', duration: '10 min', difficulty: 'easy', description: 'Wide stance squat emphasizing inner thighs.', subCategory: 'Adductors' },
  { name: 'Lying Adductor Squeeze', duration: '8 min', difficulty: 'easy', description: 'Squeeze a pillow between knees for adductor activation.', subCategory: 'Adductors' },
];

const ADDUCTORS_PRO = [
  { name: 'Cossack Squat', duration: '12 min', difficulty: 'medium', description: 'Deep lateral squat shifting weight side to side.', subCategory: 'Adductors' },
  { name: 'Sliding Side Lunge', duration: '10 min', difficulty: 'medium', description: 'Slide one leg out laterally for adductor eccentric load.', subCategory: 'Adductors' },
];

const ADDUCTORS_PRO_PLUS = [
  { name: 'Copenhagen Plank Hold', duration: '10 min', difficulty: 'hard', description: 'Side plank with top leg on bench — adductor isometric.', subCategory: 'Adductors' },
  { name: 'Single Leg Cossack Squat', duration: '12 min', difficulty: 'hard', description: 'Deep one-leg lateral squat for mobility and strength.', subCategory: 'Adductors' },
  { name: 'Wide Stance Squat Hold', duration: '8 min', difficulty: 'hard', description: 'Isometric deep sumo hold for adductor endurance.', subCategory: 'Adductors' },
];

// ─────────────────────────────────────────────────────────────
//  CALVES  (bodyweight)
// ─────────────────────────────────────────────────────────────
const CALVES_BASIC = [
  { name: 'Standing Calf Raises', duration: '8 min', difficulty: 'easy', description: 'Rise onto toes on flat ground for calf development.', subCategory: 'Calves' },
  { name: 'Seated Calf Raise', duration: '8 min', difficulty: 'easy', description: 'Sit on a chair and raise heels — soleus emphasis.', subCategory: 'Calves' },
  { name: 'Stair Calf Raises', duration: '8 min', difficulty: 'easy', description: 'Calf raise off a stair edge for full range of motion.', subCategory: 'Calves' },
];

const CALVES_PRO = [
  { name: 'Single Leg Calf Raise', duration: '10 min', difficulty: 'medium', description: 'One leg calf raise for unilateral calf strength.', subCategory: 'Calves' },
  { name: 'Jump Rope Calf Hops', duration: '10 min', difficulty: 'medium', description: 'Rope skipping on toes for calf endurance and power.', subCategory: 'Calves' },
];

const CALVES_PRO_PLUS = [
  { name: 'Explosive Calf Jumps', duration: '10 min', difficulty: 'hard', description: 'Repeated vertical calf jumps for plyometric calf power.', subCategory: 'Calves' },
  { name: 'Donkey Calf Raise', duration: '10 min', difficulty: 'hard', description: 'Bent over calf raise — stretched gastrocnemius emphasis.', subCategory: 'Calves' },
  { name: 'Weighted Stair Calf Raise', duration: '10 min', difficulty: 'hard', description: 'Add a backpack for progressive calf overload.', subCategory: 'Calves' },
];

// ─────────────────────────────────────────────────────────────
//  BACK  (bodyweight)
// ─────────────────────────────────────────────────────────────
const BACK_BASIC = [
  { name: 'Superman Hold', duration: '8 min', difficulty: 'easy', description: 'Prone back extension isometric hold for erectors.', subCategory: 'Back' },
  { name: 'Reverse Snow Angels', duration: '8 min', difficulty: 'easy', description: 'Lying face down, sweep arms — rear delts and mid-back.', subCategory: 'Back' },
  { name: 'Bird Dog', duration: '8 min', difficulty: 'easy', description: 'Opposite arm-leg extension for spinal stability.', subCategory: 'Back' },
];

const BACK_PRO = [
  { name: 'Inverted Rows', duration: '12 min', difficulty: 'medium', description: 'Body under a bar — horizontal pull for mid-back.', subCategory: 'Back' },
  { name: 'Prone Y-T-W Raises', duration: '10 min', difficulty: 'medium', description: 'Three arm positions face down for rear delts and traps.', subCategory: 'Back' },
  { name: 'Back Extensions', duration: '10 min', difficulty: 'medium', description: 'Dynamic prone back raise for erector strength.', subCategory: 'Back' },
];

const BACK_PRO_PLUS = [
  { name: 'Ring Rows', duration: '12 min', difficulty: 'hard', description: 'Gymnastic ring horizontal pulling — adjustable difficulty.', subCategory: 'Back' },
  { name: 'Archer Inverted Row', duration: '12 min', difficulty: 'hard', description: 'One arm pulls while other assists — unilateral back work.', subCategory: 'Back' },
  { name: 'Front Lever Raises', duration: '12 min', difficulty: 'hard', description: 'Pull from hang to horizontal — extreme lat demand.', subCategory: 'Back' },
];

// ─────────────────────────────────────────────────────────────
//  LATS  (bodyweight)
// ─────────────────────────────────────────────────────────────
const LATS_BASIC = [
  { name: 'Straight Arm Pull', duration: '8 min', difficulty: 'easy', description: 'Use a doorframe or band for straight arm lat engagement.', subCategory: 'Lats' },
  { name: 'Resistance Band Pulldown', duration: '10 min', difficulty: 'easy', description: 'Anchor a band overhead and pull down — lat isolation.', subCategory: 'Lats' },
  { name: 'Lying Lat Pullover', duration: '8 min', difficulty: 'easy', description: 'Lie on floor with arms overhead, engage lats to pull.', subCategory: 'Lats' },
];

const LATS_PRO = [
  { name: 'Pull-ups', duration: '12 min', difficulty: 'medium', description: 'Overhand grip vertical pull — king of lat builders.', subCategory: 'Lats' },
  { name: 'Wide Grip Pull-ups', duration: '12 min', difficulty: 'medium', description: 'Extra-wide grip for outer lat width emphasis.', subCategory: 'Lats' },
  { name: 'Close Grip Pull-ups', duration: '12 min', difficulty: 'medium', description: 'Narrow grip for inner lat and brachialis activation.', subCategory: 'Lats' },
];

const LATS_PRO_PLUS = [
  { name: 'Muscle-ups', duration: '15 min', difficulty: 'hard', description: 'Pull-up into dip transition — explosive lat pull and press.', subCategory: 'Lats' },
  { name: 'Archer Pull-ups', duration: '12 min', difficulty: 'hard', description: 'One arm pulls while other is extended — unilateral lat.', subCategory: 'Lats' },
  { name: 'Front Lever Hold', duration: '12 min', difficulty: 'hard', description: 'Full body horizontal hold from a bar — extreme lat isometric.', subCategory: 'Lats' },
  { name: 'One-Arm Pull-up Negatives', duration: '12 min', difficulty: 'hard', description: 'Slow single-arm descent — peak lat overload.', subCategory: 'Lats' },
];

// ─────────────────────────────────────────────────────────────
//  TRAPS  (bodyweight)
// ─────────────────────────────────────────────────────────────
const TRAPS_BASIC = [
  { name: 'Scapular Push-ups', duration: '8 min', difficulty: 'easy', description: 'Plank position scapula protraction and retraction.', subCategory: 'Traps' },
  { name: 'Prone Shrugs', duration: '8 min', difficulty: 'easy', description: 'Lying face down, shrug shoulders toward ears.', subCategory: 'Traps' },
  { name: 'Wall Slides', duration: '8 min', difficulty: 'easy', description: 'Back against wall, slide arms up — lower trap activation.', subCategory: 'Traps' },
];

const TRAPS_PRO = [
  { name: 'Scapular Pull-ups', duration: '10 min', difficulty: 'medium', description: 'Hang from bar and retract scapulae — lower trap focus.', subCategory: 'Traps' },
  { name: 'Inverted Shrug Row', duration: '10 min', difficulty: 'medium', description: 'Inverted row with shrug at the top for upper traps.', subCategory: 'Traps' },
];

const TRAPS_PRO_PLUS = [
  { name: 'Handstand Shrugs', duration: '10 min', difficulty: 'hard', description: 'Handstand against wall with shoulder shrugs.', subCategory: 'Traps' },
  { name: 'Ring Face Pulls', duration: '10 min', difficulty: 'hard', description: 'Face pull motion on rings for mid and lower traps.', subCategory: 'Traps' },
  { name: 'Weighted Scapular Pull-ups', duration: '10 min', difficulty: 'hard', description: 'Add a backpack — loaded scapular depression and retraction.', subCategory: 'Traps' },
];

// ─────────────────────────────────────────────────────────────
//  GLUTES  (bodyweight)
// ─────────────────────────────────────────────────────────────
const GLUTES_BASIC = [
  { name: 'Glute Bridges', duration: '10 min', difficulty: 'easy', description: 'Supine hip extension for glute activation.', subCategory: 'Glutes' },
  { name: 'Donkey Kicks', duration: '10 min', difficulty: 'easy', description: 'On all fours, kick one leg back for glute isolation.', subCategory: 'Glutes' },
  { name: 'Fire Hydrants', duration: '8 min', difficulty: 'easy', description: 'Lateral hip abduction on all fours — glute medius.', subCategory: 'Glutes' },
  { name: 'Bodyweight Hip Thrust', duration: '10 min', difficulty: 'easy', description: 'Back on a bench, drive hips up for glute max.', subCategory: 'Glutes' },
];

const GLUTES_PRO = [
  { name: 'Single Leg Glute Bridge', duration: '10 min', difficulty: 'medium', description: 'Unilateral hip thrust for glute strength imbalances.', subCategory: 'Glutes' },
  { name: 'Curtsy Lunges', duration: '10 min', difficulty: 'medium', description: 'Cross-behind lunge for glute medius emphasis.', subCategory: 'Glutes' },
  { name: 'Frog Pumps', duration: '10 min', difficulty: 'medium', description: 'Feet together, knees out hip thrust — glute max squeeze.', subCategory: 'Glutes' },
];

const GLUTES_PRO_PLUS = [
  { name: 'Elevated Single Leg Hip Thrust', duration: '12 min', difficulty: 'hard', description: 'Foot on a raised surface for greater glute range.', subCategory: 'Glutes' },
  { name: 'Skater Squats', duration: '12 min', difficulty: 'hard', description: 'Single-leg squat leaning forward — glute dominant.', subCategory: 'Glutes' },
  { name: 'Nordic Hip Extension', duration: '12 min', difficulty: 'hard', description: 'Prone hip extension with anchored feet for glute power.', subCategory: 'Glutes' },
];

// ─────────────────────────────────────────────────────────────
//  HAMSTRINGS  (bodyweight)
// ─────────────────────────────────────────────────────────────
const HAMSTRINGS_BASIC = [
  { name: 'Lying Leg Curl Towel', duration: '10 min', difficulty: 'easy', description: 'Lie face down, curl a towel with heels for hamstrings.', subCategory: 'Hamstrings' },
  { name: 'Good Mornings Bodyweight', duration: '10 min', difficulty: 'easy', description: 'Hip hinge with hands behind head — hamstring stretch.', subCategory: 'Hamstrings' },
  { name: 'Glute-Ham Bridge', duration: '10 min', difficulty: 'easy', description: 'Bridge with feet far from hips — hamstring dominant.', subCategory: 'Hamstrings' },
];

const HAMSTRINGS_PRO = [
  { name: 'Single Leg Deadlift', duration: '10 min', difficulty: 'medium', description: 'One-leg hip hinge for hamstring and balance.', subCategory: 'Hamstrings' },
  { name: 'Sliding Leg Curl', duration: '10 min', difficulty: 'medium', description: 'Slide feet out from bridge — eccentric hamstring curl.', subCategory: 'Hamstrings' },
  { name: 'Swiss Ball Leg Curl', duration: '10 min', difficulty: 'medium', description: 'Curl a stability ball with heels while bridging.', subCategory: 'Hamstrings' },
];

const HAMSTRINGS_PRO_PLUS = [
  { name: 'Nordic Hamstring Curl', duration: '12 min', difficulty: 'hard', description: 'Slow eccentric knee extension — gold standard hamstring.', subCategory: 'Hamstrings' },
  { name: 'Single Leg Sliding Curl', duration: '10 min', difficulty: 'hard', description: 'One-leg slide curl for unilateral hamstring overload.', subCategory: 'Hamstrings' },
  { name: 'Elevated Glute-Ham Raise', duration: '12 min', difficulty: 'hard', description: 'GHD-style raise using a partner or furniture anchor.', subCategory: 'Hamstrings' },
];


// ─────────────────────────────────────────────────────────────
//  Build the full exercise list
// ─────────────────────────────────────────────────────────────
function buildGroup(arr, level, bodyPart, defaultSubCategory) {
  return arr.map((e) => ({
    ...e,
    type: 'home',
    level,
    bodyPart,
    subCategory: e.subCategory || defaultSubCategory,
  }));
}

const ALL_EXERCISES = [
  // CHEST
  ...buildGroup(CHEST_BASIC,       'basic',    'chest',      'Middle Chest'),
  ...buildGroup(CHEST_PRO,         'pro',      'chest',      'Middle Chest'),
  ...buildGroup(CHEST_PRO_PLUS,    'pro_plus', 'chest',      'Middle Chest'),

  // SHOULDERS
  ...buildGroup(SHOULDERS_BASIC,   'basic',    'shoulders',  'Front Delts'),
  ...buildGroup(SHOULDERS_PRO,     'pro',      'shoulders',  'Front Delts'),
  ...buildGroup(SHOULDERS_PRO_PLUS,'pro_plus', 'shoulders',  'Front Delts'),

  // BICEPS
  ...buildGroup(BICEPS_BASIC,      'basic',    'biceps',     'Biceps'),
  ...buildGroup(BICEPS_PRO,        'pro',      'biceps',     'Biceps'),
  ...buildGroup(BICEPS_PRO_PLUS,   'pro_plus', 'biceps',     'Biceps'),

  // TRICEPS
  ...buildGroup(TRICEPS_BASIC,     'basic',    'triceps',    'Triceps'),
  ...buildGroup(TRICEPS_PRO,       'pro',      'triceps',    'Triceps'),
  ...buildGroup(TRICEPS_PRO_PLUS,  'pro_plus', 'triceps',    'Triceps'),

  // FOREARMS
  ...buildGroup(FOREARMS_BASIC,    'basic',    'forearms',   'Forearms'),
  ...buildGroup(FOREARMS_PRO,      'pro',      'forearms',   'Forearms'),
  ...buildGroup(FOREARMS_PRO_PLUS, 'pro_plus', 'forearms',   'Forearms'),

  // ABS
  ...buildGroup(ABS_BASIC,         'basic',    'abs',        'Abs'),
  ...buildGroup(ABS_PRO,           'pro',      'abs',        'Abs'),
  ...buildGroup(ABS_PRO_PLUS,      'pro_plus', 'abs',        'Abs'),

  // OBLIQUES
  ...buildGroup(OBLIQUES_BASIC,    'basic',    'obliques',   'Obliques'),
  ...buildGroup(OBLIQUES_PRO,      'pro',      'obliques',   'Obliques'),
  ...buildGroup(OBLIQUES_PRO_PLUS, 'pro_plus', 'obliques',   'Obliques'),

  // QUADS
  ...buildGroup(QUADS_BASIC,       'basic',    'quads',      'Quads'),
  ...buildGroup(QUADS_PRO,         'pro',      'quads',      'Quads'),
  ...buildGroup(QUADS_PRO_PLUS,    'pro_plus', 'quads',      'Quads'),

  // ADDUCTORS
  ...buildGroup(ADDUCTORS_BASIC,   'basic',    'adductors',  'Adductors'),
  ...buildGroup(ADDUCTORS_PRO,     'pro',      'adductors',  'Adductors'),
  ...buildGroup(ADDUCTORS_PRO_PLUS,'pro_plus', 'adductors',  'Adductors'),

  // CALVES
  ...buildGroup(CALVES_BASIC,      'basic',    'calves',     'Calves'),
  ...buildGroup(CALVES_PRO,        'pro',      'calves',     'Calves'),
  ...buildGroup(CALVES_PRO_PLUS,   'pro_plus', 'calves',     'Calves'),

  // BACK
  ...buildGroup(BACK_BASIC,        'basic',    'back',       'Back'),
  ...buildGroup(BACK_PRO,          'pro',      'back',       'Back'),
  ...buildGroup(BACK_PRO_PLUS,     'pro_plus', 'back',       'Back'),

  // LATS
  ...buildGroup(LATS_BASIC,        'basic',    'lats',       'Lats'),
  ...buildGroup(LATS_PRO,          'pro',      'lats',       'Lats'),
  ...buildGroup(LATS_PRO_PLUS,     'pro_plus', 'lats',       'Lats'),

  // TRAPS
  ...buildGroup(TRAPS_BASIC,       'basic',    'traps',      'Traps'),
  ...buildGroup(TRAPS_PRO,         'pro',      'traps',      'Traps'),
  ...buildGroup(TRAPS_PRO_PLUS,    'pro_plus', 'traps',      'Traps'),

  // GLUTES
  ...buildGroup(GLUTES_BASIC,      'basic',    'glutes',     'Glutes'),
  ...buildGroup(GLUTES_PRO,        'pro',      'glutes',     'Glutes'),
  ...buildGroup(GLUTES_PRO_PLUS,   'pro_plus', 'glutes',     'Glutes'),

  // HAMSTRINGS
  ...buildGroup(HAMSTRINGS_BASIC,     'basic',    'hamstrings', 'Hamstrings'),
  ...buildGroup(HAMSTRINGS_PRO,       'pro',      'hamstrings', 'Hamstrings'),
  ...buildGroup(HAMSTRINGS_PRO_PLUS,  'pro_plus', 'hamstrings', 'Hamstrings'),
];

// ─────────────────────────────────────────────────────────────
//  Seed runner
// ─────────────────────────────────────────────────────────────
const TARGET_BODY_PARTS = [
  'chest', 'shoulders', 'biceps', 'triceps', 'forearms',
  'abs', 'obliques', 'quads', 'adductors', 'calves',
  'back', 'lats', 'traps', 'glutes', 'hamstrings',
];

async function seed() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    // Remove existing HOME exercises for these body parts to prevent duplicates
    const deleted = await Workout.deleteMany({
      type: 'home',
      bodyPart: { $in: TARGET_BODY_PARTS },
    });
    console.log(`Cleared ${deleted.deletedCount} existing home muscle-group exercises.`);

    const inserted = await Workout.insertMany(ALL_EXERCISES);
    console.log(`Seeded ${inserted.length} home exercises successfully.\n`);

    const levels = ['basic', 'pro', 'pro_plus'];
    for (const bp of TARGET_BODY_PARTS) {
      const total = inserted.filter((w) => w.bodyPart === bp).length;
      const breakdown = levels.map((l) => {
        const n = inserted.filter((w) => w.bodyPart === bp && w.level === l).length;
        return `${l}: ${n}`;
      }).join(' | ');
      console.log(`  ${bp.padEnd(12)} -> ${total} exercises  (${breakdown})`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
}

seed();
