import User from '../models/user.js';

export const calculateBMB = async (req, res) => {
  try {
    const { protein, carbs, fat, fiber } = req.body;
    const p = Number(protein) || 0;
    const c = Number(carbs) || 0;
    const f = Number(fat) || 0;
    const fb = Number(fiber) || 0;

    const totalCal = p * 4 + c * 4 + f * 9;
    if (totalCal === 0) {
      return res.status(400).json({ message: 'Please provide at least one macro value' });
    }

    const proteinPct = (p * 4 / totalCal) * 100;
    const carbsPct = (c * 4 / totalCal) * 100;
    const fatPct = (f * 9 / totalCal) * 100;

    // Ideal ranges for a balanced meal
    const idealProtein = { min: 20, max: 35 };
    const idealCarbs = { min: 40, max: 55 };
    const idealFat = { min: 20, max: 35 };

    const scoreFor = (val, min, max) =>
      val >= min && val <= max
        ? 100
        : Math.max(0, 100 - Math.abs(val - (min + max) / 2) * 3);

    const proteinScore = scoreFor(proteinPct, idealProtein.min, idealProtein.max);
    const carbsScore = scoreFor(carbsPct, idealCarbs.min, idealCarbs.max);
    const fatScore = scoreFor(fatPct, idealFat.min, idealFat.max);
    const overallScore = Math.round((proteinScore + carbsScore + fatScore) / 3);

    const tips = [];
    if (proteinPct < idealProtein.min) tips.push('Increase protein intake — add eggs, chicken, or lentils');
    if (proteinPct > idealProtein.max) tips.push('Reduce protein slightly — balance with more carbs');
    if (carbsPct < idealCarbs.min) tips.push('Add more complex carbs — oats, brown rice, sweet potatoes');
    if (carbsPct > idealCarbs.max) tips.push('Reduce carbs — swap refined grains for vegetables');
    if (fatPct < idealFat.min) tips.push('Add healthy fats — nuts, avocado, olive oil');
    if (fatPct > idealFat.max) tips.push('Reduce fat intake — choose lean protein sources');
    if (fb < 25) tips.push('Increase fiber — eat more fruits, vegetables, and whole grains');
    if (tips.length === 0) tips.push('Great job! Your meal balance is excellent');

    let rating;
    if (overallScore >= 80) rating = 'Excellent';
    else if (overallScore >= 60) rating = 'Good';
    else if (overallScore >= 40) rating = 'Fair';
    else rating = 'Poor';

    return res.status(200).json({
      totalCalories: Math.round(totalCal),
      macros: {
        protein: { grams: p, percentage: Math.round(proteinPct), score: Math.round(proteinScore), ideal: '20-35%' },
        carbs: { grams: c, percentage: Math.round(carbsPct), score: Math.round(carbsScore), ideal: '40-55%' },
        fat: { grams: f, percentage: Math.round(fatPct), score: Math.round(fatScore), ideal: '20-35%' },
        fiber: { grams: fb, adequate: fb >= 25 },
      },
      overallScore,
      rating,
      tips,
    });
  } catch (error) {
    return res.status(500).json({ message: 'BMB calculation failed', error: error.message });
  }
};
