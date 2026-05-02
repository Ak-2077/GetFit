import User from '../models/user.js';

export const upgradePlan = async (req, res) => {
  try {
    const userId = req.userId;
    const { plan } = req.body;

    if (!['free', 'pro', 'pro_plus'].includes(plan)) {
      return res.status(400).json({ message: 'Invalid plan. Must be free, pro, or pro_plus' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const currentPlan = user.subscriptionPlan || 'free';

    // Prevent downgrade (only upgrade allowed via this endpoint)
    const planRank = { free: 0, pro: 1, pro_plus: 2 };
    if (planRank[plan] <= planRank[currentPlan]) {
      return res.status(400).json({ message: `Cannot change from ${currentPlan} to ${plan}` });
    }

    user.subscriptionPlan = plan;
    await user.save();

    return res.status(200).json({
      message: `Upgraded to ${plan} successfully`,
      subscriptionPlan: plan,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Upgrade failed', error: error.message });
  }
};

export const getPlans = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId).select('subscriptionPlan').lean();
    const currentPlan = user?.subscriptionPlan || 'free';

    const plans = [
      {
        key: 'free', name: 'Free Plan', price: '₹0', period: 'forever',
        features: [
          { name: 'Basic Food Logging', included: true },
          { name: 'Step Tracking', included: true },
          { name: 'BMI Calculator', included: true },
          { name: 'Calories Calculator', included: true },
          { name: 'Weekly Workout Plan', included: true },
          { name: 'Balance Meal Meter', included: false },
          { name: 'AI Diet Plans', included: false },
          { name: 'Priority Support', included: false },
        ],
      },
      {
        key: 'pro', name: 'AI Trainer Pro', price: '₹2450', period: '/month', badge: 'Most Popular',
        features: [
          { name: 'Basic Food Logging', included: true },
          { name: 'Step Tracking', included: true },
          { name: 'BMI Calculator', included: true },
          { name: 'Calories Calculator', included: true },
          { name: 'Weekly Workout Plan', included: true },
          { name: 'Balance Meal Meter', included: true },
          { name: 'AI Diet Plans', included: true },
          { name: 'Priority Support', included: false },
        ],
      },
      {
        key: 'pro_plus', name: 'AI Trainer Pro+', price: '₹3999', period: '/month', badge: 'Best Value',
        features: [
          { name: 'Basic Food Logging', included: true },
          { name: 'Step Tracking', included: true },
          { name: 'BMI Calculator', included: true },
          { name: 'Calories Calculator', included: true },
          { name: 'Weekly Workout Plan', included: true },
          { name: 'Balance Meal Meter', included: true },
          { name: 'AI Diet Plans', included: true },
          { name: 'Priority Support', included: true },
        ],
      },
    ];

    return res.status(200).json({ currentPlan, plans });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch plans', error: error.message });
  }
};
