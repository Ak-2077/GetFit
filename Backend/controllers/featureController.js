import User from '../models/user.js';

/**
 * Feature access map — determines which tools each subscription tier unlocks.
 * Keeping this server-side ensures the frontend never hardcodes access.
 */
const FEATURE_MAP = {
  free: ['BMI', 'CALORIES', 'WWP'],
  pro: ['BMI', 'CALORIES', 'BMB', 'AI_DIET', 'WWP'],
  pro_plus: ['BMI', 'CALORIES', 'BMB', 'AI_DIET', 'WWP'],
};

export const getFeatures = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await User.findById(userId).select('subscriptionPlan').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const plan = user.subscriptionPlan || 'free';
    const allowedFeatures = FEATURE_MAP[plan] || FEATURE_MAP.free;

    return res.status(200).json({
      subscriptionPlan: plan,
      allowedFeatures,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to fetch features',
      error: error.message,
    });
  }
};
