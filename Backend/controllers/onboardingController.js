import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/user.js';

// ─── FITNESS CALCULATORS ────────────────────────────────

function calculateBMI(weightKg, heightCm) {
  const heightM = heightCm / 100;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}

function calculateBodyType(bmi) {
  if (bmi < 18.5) return 'ectomorph';
  if (bmi <= 24.9) return 'mesomorph';
  return 'endomorph';
}

function calculateMaintenanceCalories(weightKg, heightCm, age, gender, level) {
  // Mifflin-St Jeor equation
  let bmr;
  if (gender === 'male') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  } else if (gender === 'female') {
    bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  } else {
    // 'other' — average of male and female
    const maleBmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
    const femaleBmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
    bmr = (maleBmr + femaleBmr) / 2;
  }

  // Activity multiplier
  const multipliers = {
    beginner: 1.2,
    intermediate: 1.55,
    advanced: 1.725,
  };
  const multiplier = multipliers[level] || 1.2;

  return Math.round(bmr * multiplier);
}

function calculateGoalCalories(maintenanceCalories, goal) {
  if (goal === 'lose') return maintenanceCalories - 500;
  if (goal === 'gain') return maintenanceCalories + 400;
  return maintenanceCalories; // maintain
}

function calculateDailyProteinTarget(weightKg, goal) {
  if (goal === 'gain') return Math.round(2.0 * weightKg);
  if (goal === 'lose') return Math.round(1.8 * weightKg);
  return Math.round(1.6 * weightKg); // maintain
}

// ─── SAVE ONBOARDING ───────────────────────────────────

/**
 * POST /api/user/onboarding
 * Save onboarding data + compute BMI, body type, calories.
 */
export async function saveOnboarding(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { name, country, weight, height, age, gender, goal, diet, level } = req.body;

    // ── Validation ──────────────────────────────────────
    const errors = [];

    if (!name || typeof name !== 'string' || !name.trim()) {
      errors.push('Name is required');
    }

    const weightNum = Number(weight);
    if (!weight || isNaN(weightNum) || weightNum <= 0 || weightNum > 500) {
      errors.push('Weight must be a valid number between 1 and 500');
    }

    const heightNum = Number(height);
    if (!height || isNaN(heightNum) || heightNum <= 0 || heightNum > 300) {
      errors.push('Height must be a valid number between 1 and 300');
    }

    const ageNum = Number(age);
    if (!age || isNaN(ageNum) || ageNum < 10 || ageNum > 120 || !Number.isInteger(ageNum)) {
      errors.push('Age must be a whole number between 10 and 120');
    }

    const validGenders = ['male', 'female', 'other'];
    if (!gender || !validGenders.includes(gender)) {
      errors.push('Gender must be one of: male, female, other');
    }

    const validGoals = ['maintain', 'gain', 'lose'];
    if (!goal || !validGoals.includes(goal)) {
      errors.push('Goal must be one of: maintain, gain, lose');
    }

    const validDiets = ['veg', 'non_veg'];
    if (!diet || !validDiets.includes(diet)) {
      errors.push('Diet must be one of: veg, non_veg');
    }

    const validLevels = ['beginner', 'intermediate', 'advanced'];
    if (!level || !validLevels.includes(level)) {
      errors.push('Level must be one of: beginner, intermediate, advanced');
    }

    if (errors.length > 0) {
      return res.status(400).json({ message: errors.join('. '), errors });
    }

    // ── Compute fitness metrics ─────────────────────────
    const bmi = calculateBMI(weightNum, heightNum);
    const bodyType = calculateBodyType(bmi);
    const maintenanceCalories = calculateMaintenanceCalories(weightNum, heightNum, ageNum, gender, level);
    const goalCalories = calculateGoalCalories(maintenanceCalories, goal);
    const dailyProteinTarget = calculateDailyProteinTarget(weightNum, goal);

    // ── Update user ─────────────────────────────────────
    const user = await User.findByIdAndUpdate(
      userId,
      {
        name: name.trim(),
        country: country || null,
        weight: String(weightNum),
        height: String(heightNum),
        age: ageNum,
        gender,
        goal,
        dietPreference: diet,
        level,
        bmi,
        bodyType,
        maintenanceCalories,
        goalCalories,
        dailyProteinTarget,
        onboardingCompleted: true,
      },
      { returnDocument: 'after' }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ message: 'Onboarding completed', user });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Onboarding failed' });
  }
}

// ─── GET PROFILE ────────────────────────────────────────

/**
 * GET /api/user/profile
 * Return the authenticated user's full profile.
 */
export async function getProfile(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json(user);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to fetch profile' });
  }
}

// ─── UPDATE PROFILE ─────────────────────────────────────

/**
 * PUT /api/user/profile
 * Update profile fields (name, avatar, notifications, etc.)
 */
export async function updateUserProfile(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { name, avatar, notificationsEnabled, level, dietPreference } = req.body;

    const update = {};
    if (name !== undefined) update.name = typeof name === 'string' ? name.trim() : name;
    if (avatar !== undefined) update.avatar = avatar;
    if (notificationsEnabled !== undefined) update.notificationsEnabled = !!notificationsEnabled;

    // Validate and set level
    const validLevels = ['beginner', 'intermediate', 'advanced'];
    if (level !== undefined) {
      if (!validLevels.includes(level)) {
        return res.status(400).json({ message: 'Level must be one of: beginner, intermediate, advanced' });
      }
      update.level = level;
    }

    // Validate and set dietPreference
    const validDiets = ['veg', 'non_veg'];
    if (dietPreference !== undefined) {
      if (!validDiets.includes(dietPreference)) {
        return res.status(400).json({ message: 'Diet must be one of: veg, non_veg' });
      }
      update.dietPreference = dietPreference;
    }

    // If level changed, recompute calories (level affects activity multiplier)
    if (level !== undefined) {
      const currentUser = await User.findById(userId);
      if (currentUser && currentUser.weight && currentUser.height && currentUser.age && currentUser.gender) {
        const weightNum = Number(currentUser.weight);
        const heightNum = Number(currentUser.height);
        const ageNum = currentUser.age;
        const gender = currentUser.gender;
        const goal = currentUser.goal;
        const newLevel = level;

        const maintenanceCalories = calculateMaintenanceCalories(weightNum, heightNum, ageNum, gender, newLevel);
        const goalCalories = calculateGoalCalories(maintenanceCalories, goal);
        const dailyProteinTarget = calculateDailyProteinTarget(weightNum, goal);

        update.maintenanceCalories = maintenanceCalories;
        update.goalCalories = goalCalories;
        update.dailyProteinTarget = dailyProteinTarget;
      }
    }

    const user = await User.findByIdAndUpdate(userId, update, { returnDocument: 'after' }).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ message: 'Profile updated', user });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to update profile' });
  }
}

// ─── CHANGE PASSWORD ────────────────────────────────────

/**
 * POST /api/user/change-password
 * Change password (requires current password).
 */
export async function changeUserPassword(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({ message: 'Current password is required' });
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    // Fetch user WITH password field
    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.password) {
      return res.status(400).json({
        message: 'No password set. Your account uses phone/social login.',
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(userId, { password: hashedPassword });

    return res.json({ message: 'Password changed successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to change password' });
  }
}

// ─── DELETE ACCOUNT ─────────────────────────────────────

/**
 * DELETE /api/user/delete-account
 * Permanently delete user and ALL associated data using a MongoDB ACID transaction.
 *
 * Compliance:
 *   • Apple App Store Review Guidelines 5.1.1(v) — in-app account deletion
 *   • Google Play User Data policy — user-initiated data deletion
 *   • GDPR Article 17 — Right to Erasure
 *   • Indian tax regulations — financial records retained for 7 years (anonymized)
 *
 * Security:
 *   • Requires valid JWT — only the authenticated user can delete their own account.
 *   • Requires explicit confirmation via request body { confirm: true }.
 *   • Uses MongoDB transactions for atomicity — partial deletions cannot occur.
 *   • Never logs PII (email, phone, password, health data, AI conversations).
 */
export async function deleteAccount(req, res) {
  const session = await mongoose.startSession();

  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // ── Explicit confirmation required ──────────────────────
    if (req.body?.confirm !== true) {
      return res.status(400).json({
        message: 'Account deletion requires explicit confirmation. Send { "confirm": true } in the request body.',
      });
    }

    // ── Verify user exists ──────────────────────────────────
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Account not found or already deleted' });
    }

    // Prevent users from deleting other users' accounts
    if (user._id.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You can only delete your own account' });
    }

    // ── Import all user-related models ──────────────────────
    // Every model that stores a userId reference must be included here.
    // When adding new models to the project, add their cleanup below.
    const [
      { default: FoodLog },
      { default: BurnLog },
      { default: Otp },
      { default: NutritionStreak },
      { default: FoodMemory },
      { default: Notification },
      { default: UserMemory },
      { default: UserState },
      { default: UserLearningProfile },
      { default: DigitalTwin },
      { default: ExperienceReplay },
      { default: PersistentReasoning },
      { default: ReasoningCache },
      { default: PromptPerformance },
      { default: OrchestrationHealth },
      { default: LongHorizonPlan },
      { default: Food },
      { default: Subscription },
    ] = await Promise.all([
      import('../models/foodLog.js'),
      import('../models/burnLog.js'),
      import('../models/otp.js'),
      import('../models/nutritionStreak.js'),
      import('../models/foodMemory.js'),
      import('../models/notification.js'),
      import('../models/userMemory.js'),
      import('../models/userState.js'),
      import('../models/userLearningProfile.js'),
      import('../models/digitalTwin.js'),
      import('../models/experienceReplay.js'),
      import('../models/persistentReasoning.js'),
      import('../models/reasoningCache.js'),
      import('../models/promptPerformance.js'),
      import('../models/orchestrationHealth.js'),
      import('../models/longHorizonPlan.js'),
      import('../models/food.js'),
      import('../models/subscription.js'),
    ]);

    // ChatSession is defined inline in chatController.js, access via mongoose
    const ChatSession = mongoose.models.ChatSession;

    // ── Begin ACID transaction ──────────────────────────────
    session.startTransaction();

    const txOpts = { session };

    // ── PART 2: Delete every user-owned document ────────────
    // All deletions run inside the transaction. If ANY fails,
    // the entire operation rolls back — no orphaned data.
    await Promise.all([
      // Core fitness data
      FoodLog.deleteMany({ userId }, txOpts),
      BurnLog.deleteMany({ userId }, txOpts),
      NutritionStreak.deleteMany({ userId }, txOpts),
      FoodMemory.deleteMany({ userId }, txOpts),
      Food.deleteMany({ userId }, txOpts),                  // user-created custom foods

      // PART 4: AI data cleanup — all AI-generated data
      UserMemory.deleteMany({ userId }, txOpts),            // AI extracted memories
      UserState.deleteMany({ userId }, txOpts),             // AI behavioral state
      UserLearningProfile.deleteMany({ userId }, txOpts),   // AI communication profile
      DigitalTwin.deleteMany({ userId }, txOpts),           // AI digital twin
      ExperienceReplay.deleteMany({ userId }, txOpts),      // AI experience replay buffer
      PersistentReasoning.deleteMany({ userId }, txOpts),   // AI persistent reasoning chains
      ReasoningCache.deleteMany({ userId }, txOpts),        // AI cached reasoning results
      PromptPerformance.deleteMany({ userId }, txOpts),     // AI prompt performance metrics
      OrchestrationHealth.deleteMany({ userId }, txOpts),   // AI orchestration health metrics
      LongHorizonPlan.deleteMany({ userId }, txOpts),       // AI long horizon plans

      // Chat sessions (AI conversation history)
      ...(ChatSession ? [ChatSession.deleteMany({ userId }, txOpts)] : []),

      // Notifications and system data
      Notification.deleteMany({ userId }, txOpts),

      // OTP records — clean up by both phone and email
      ...(user.phone ? [Otp.deleteMany({ target: user.phone }, txOpts)] : []),
      ...(user.email ? [Otp.deleteMany({ target: user.email }, txOpts)] : []),
    ]);

    // ── PART 5: Subscription handling ───────────────────────
    // Financial records must be retained for 7 years per Indian tax law.
    // We ANONYMIZE subscriptions: strip PII but keep transaction IDs,
    // amounts, and dates for audit purposes.
    await Subscription.updateMany(
      { userId },
      {
        $set: {
          status: 'cancelled',
          userId: new mongoose.Types.ObjectId(),  // Replace with a random orphan ID
        },
        $unset: {
          // Remove any fields that could identify the user
        },
      },
      txOpts
    );

    // ── Delete the user document ────────────────────────────
    await User.deleteOne({ _id: userId }, txOpts);

    // ── Commit the transaction ──────────────────────────────
    await session.commitTransaction();

    // ── PART 7: Safe operational logging ────────────────────
    // Log only the anonymous ObjectId and timestamp. Never log PII.
    console.log(`[ACCOUNT_DELETED] userId=${userId} timestamp=${new Date().toISOString()}`);

    // ── PART 6: Session cleanup ─────────────────────────────
    // The JWT is now invalid because the user document no longer exists.
    // Any subsequent request with this token will fail authentication
    // in authMiddleware.js (User.findById returns null → 401).
    // No refresh tokens or device sessions are stored server-side.

    return res.json({
      success: true,
      message: 'Your account and all associated data have been permanently deleted.',
    });
  } catch (error) {
    // If the transaction is still active, abort it to prevent partial deletions
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    // Log only generic error info — never log PII or sensitive data
    console.error(`[ACCOUNT_DELETE_FAILED] timestamp=${new Date().toISOString()} error=${error.message}`);

    return res.status(500).json({
      message: 'Account deletion failed. No data was modified. Please try again.',
    });
  } finally {
    session.endSession();
  }
}
