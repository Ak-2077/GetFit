import bcrypt from 'bcryptjs';
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

    const { name, weight, height, age, gender, goal, diet, level } = req.body;

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

    // ── Update user ─────────────────────────────────────
    const user = await User.findByIdAndUpdate(
      userId,
      {
        name: name.trim(),
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
        onboardingCompleted: true,
      },
      { new: true }
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

    const { name, avatar, notificationsEnabled } = req.body;

    const update = {};
    if (name !== undefined) update.name = typeof name === 'string' ? name.trim() : name;
    if (avatar !== undefined) update.avatar = avatar;
    if (notificationsEnabled !== undefined) update.notificationsEnabled = !!notificationsEnabled;

    const user = await User.findByIdAndUpdate(userId, update, { new: true }).select('-password');
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
 * Permanently delete user and all associated data.
 */
export async function deleteAccount(req, res) {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Import related models dynamically to avoid circular deps
    const { default: FoodLog } = await import('../models/foodLog.js');
    const { default: BurnLog } = await import('../models/burnLog.js');
    const { default: Otp } = await import('../models/otp.js');

    // Delete all related data
    await Promise.all([
      FoodLog.deleteMany({ userId }),
      BurnLog.deleteMany({ userId }),
      Otp.deleteMany({ phone: user.phone }),
    ]);

    // Delete user
    await User.deleteOne({ _id: userId });

    console.log(`[DELETE] Account deleted: ${userId} (${user.email || user.phone})`);

    return res.json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to delete account' });
  }
}
