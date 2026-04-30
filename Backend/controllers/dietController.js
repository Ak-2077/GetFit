import User from '../models/user.js';

const DIET_PLANS = {
  lose: {
    title: 'Fat Loss Plan',
    description: 'Calorie-deficit diet focused on lean protein and vegetables',
    meals: [
      { time: 'Breakfast (8 AM)', items: ['Egg whites (4) — 68 kcal', 'Oatmeal (40g) — 150 kcal', 'Black coffee — 5 kcal'], total: 223 },
      { time: 'Snack (11 AM)', items: ['Greek yogurt (150g) — 90 kcal', 'Almonds (10) — 70 kcal'], total: 160 },
      { time: 'Lunch (1 PM)', items: ['Grilled chicken (150g) — 240 kcal', 'Brown rice (100g) — 110 kcal', 'Salad — 50 kcal'], total: 400 },
      { time: 'Snack (4 PM)', items: ['Whey protein shake — 120 kcal', 'Apple — 80 kcal'], total: 200 },
      { time: 'Dinner (7 PM)', items: ['Grilled fish (150g) — 200 kcal', 'Steamed veggies — 80 kcal', 'Quinoa (50g) — 90 kcal'], total: 370 },
    ],
  },
  gain: {
    title: 'Muscle Gain Plan',
    description: 'Calorie-surplus diet focused on protein and complex carbs',
    meals: [
      { time: 'Breakfast (7 AM)', items: ['Whole eggs (4) — 280 kcal', 'Toast (2) + peanut butter — 300 kcal', 'Banana — 105 kcal'], total: 685 },
      { time: 'Snack (10 AM)', items: ['Mass gainer shake — 400 kcal', 'Mixed nuts (40g) — 250 kcal'], total: 650 },
      { time: 'Lunch (1 PM)', items: ['Chicken breast (200g) — 330 kcal', 'White rice (150g) — 195 kcal', 'Sweet potato (100g) — 90 kcal'], total: 615 },
      { time: 'Pre-workout (5 PM)', items: ['Banana + peanut butter — 200 kcal', 'Creatine — 0 kcal'], total: 200 },
      { time: 'Dinner (8 PM)', items: ['Salmon (200g) — 400 kcal', 'Pasta (100g) — 160 kcal', 'Avocado (half) — 120 kcal'], total: 680 },
    ],
  },
  maintain: {
    title: 'Maintenance Plan',
    description: 'Balanced diet to maintain current weight and body composition',
    meals: [
      { time: 'Breakfast (8 AM)', items: ['Eggs (2) + toast — 280 kcal', 'Fruit bowl — 100 kcal'], total: 380 },
      { time: 'Snack (11 AM)', items: ['Yogurt + granola — 200 kcal'], total: 200 },
      { time: 'Lunch (1 PM)', items: ['Chicken/paneer (150g) — 250 kcal', 'Rice (100g) — 130 kcal', 'Dal/lentils — 120 kcal'], total: 500 },
      { time: 'Snack (4 PM)', items: ['Protein bar — 200 kcal', 'Green tea — 0 kcal'], total: 200 },
      { time: 'Dinner (7 PM)', items: ['Fish/tofu (150g) — 200 kcal', 'Chapati (2) — 150 kcal', 'Veggies — 80 kcal'], total: 430 },
    ],
  },
};

const VEG_DIET_PLANS = {
  lose: {
    title: 'Veg Fat Loss Plan',
    description: 'Plant-based calorie-deficit diet',
    meals: [
      { time: 'Breakfast (8 AM)', items: ['Moong dal cheela (2) — 160 kcal', 'Green smoothie — 90 kcal'], total: 250 },
      { time: 'Snack (11 AM)', items: ['Sprouts chaat — 120 kcal', 'Buttermilk — 40 kcal'], total: 160 },
      { time: 'Lunch (1 PM)', items: ['Paneer tikka (100g) — 200 kcal', 'Brown rice (80g) — 90 kcal', 'Dal — 120 kcal', 'Salad — 50 kcal'], total: 460 },
      { time: 'Snack (4 PM)', items: ['Roasted chana (30g) — 110 kcal', 'Apple — 80 kcal'], total: 190 },
      { time: 'Dinner (7 PM)', items: ['Mixed veg curry — 150 kcal', 'Chapati (1) — 80 kcal', 'Raita — 60 kcal'], total: 290 },
    ],
  },
  gain: {
    title: 'Veg Muscle Gain Plan',
    description: 'Plant-based calorie-surplus diet',
    meals: [
      { time: 'Breakfast (7 AM)', items: ['Paneer paratha (2) — 400 kcal', 'Banana shake — 250 kcal'], total: 650 },
      { time: 'Snack (10 AM)', items: ['Mixed nuts + dates — 300 kcal', 'Soy milk — 120 kcal'], total: 420 },
      { time: 'Lunch (1 PM)', items: ['Rajma curry — 250 kcal', 'White rice (150g) — 195 kcal', 'Curd — 100 kcal', 'Roti (2) — 160 kcal'], total: 705 },
      { time: 'Snack (5 PM)', items: ['Peanut butter toast (2) — 350 kcal', 'Banana — 105 kcal'], total: 455 },
      { time: 'Dinner (8 PM)', items: ['Tofu stir fry — 220 kcal', 'Quinoa (100g) — 180 kcal', 'Palak paneer — 200 kcal'], total: 600 },
    ],
  },
  maintain: {
    title: 'Veg Maintenance Plan',
    description: 'Balanced vegetarian diet',
    meals: [
      { time: 'Breakfast (8 AM)', items: ['Idli (3) + sambar — 250 kcal', 'Tea — 30 kcal'], total: 280 },
      { time: 'Snack (11 AM)', items: ['Fruit bowl — 120 kcal', 'Nuts (15g) — 90 kcal'], total: 210 },
      { time: 'Lunch (1 PM)', items: ['Dal (150ml) — 140 kcal', 'Rice (100g) — 130 kcal', 'Sabzi — 100 kcal', 'Roti (1) — 80 kcal'], total: 450 },
      { time: 'Snack (4 PM)', items: ['Chana chaat — 150 kcal', 'Lassi — 100 kcal'], total: 250 },
      { time: 'Dinner (7 PM)', items: ['Paneer bhurji — 200 kcal', 'Chapati (2) — 160 kcal', 'Salad — 40 kcal'], total: 400 },
    ],
  },
};

export const getDietPlan = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await User.findById(userId)
      .select('name goal goalCalories maintenanceCalories weight height age gender dietPreference activityLevel')
      .lean();

    if (!user) return res.status(404).json({ message: 'User not found' });

    let goalKey = 'maintain';
    if (user.goal === 'lose' || user.goal === 'lose_fat') goalKey = 'lose';
    else if (user.goal === 'gain' || user.goal === 'gain_muscle') goalKey = 'gain';

    const isVeg = user.dietPreference === 'veg';
    const planSource = isVeg ? VEG_DIET_PLANS : DIET_PLANS;
    const plan = planSource[goalKey] || planSource.maintain;

    const totalPlanCalories = plan.meals.reduce((s, m) => s + m.total, 0);
    const goalCalories = user.goalCalories || user.maintenanceCalories || 2000;

    return res.status(200).json({
      userName: user.name || 'User',
      dietPreference: isVeg ? 'vegetarian' : 'non-vegetarian',
      currentGoal: goalKey,
      goalCalories,
      plan: {
        ...plan,
        totalCalories: totalPlanCalories,
        mealsCount: plan.meals.length,
      },
      availableGoals: ['lose', 'maintain', 'gain'],
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate diet plan', error: error.message });
  }
};
