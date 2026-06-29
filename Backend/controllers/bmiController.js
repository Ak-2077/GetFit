// BMI category thresholds (WHO standard)
const BMI_THRESHOLDS = { underweight: 18.5, normal: 25, overweight: 30 };

const getCategory = (bmi) => {
  if (bmi < BMI_THRESHOLDS.underweight) return { category: 'Underweight', color: '#FF8A65' };
  if (bmi < BMI_THRESHOLDS.normal) return { category: 'Normal', color: '#1FA463' };
  if (bmi < BMI_THRESHOLDS.overweight) return { category: 'Overweight', color: '#FFD600' };
  return { category: 'Obese', color: '#FF4D4D' };
};

const buildAdvice = (category, kgToHealthy) => {
  switch (category) {
    case 'Underweight':
      return `You're below the healthy range. Aim to gain about ${kgToHealthy} kg gradually with nutrient-dense meals and strength training.`;
    case 'Overweight':
      return `You're slightly above the healthy range. Losing about ${kgToHealthy} kg through a modest calorie deficit and regular activity will bring you into range.`;
    case 'Obese':
      return `Your BMI is in the obese range. Losing about ${kgToHealthy} kg with a sustainable diet and exercise plan significantly improves health. Consider professional guidance.`;
    default:
      return `You're in the healthy weight range. Maintain it with balanced nutrition and consistent activity.`;
  }
};

export const calculateBMI = async (req, res) => {
  try {
    const { age, weight, height, gender } = req.body;

    if (!weight || !height) {
      return res.status(400).json({ message: 'Weight and height are required' });
    }

    const w = Number(weight);
    const h = Number(height);
    const a = Number(age) || 25;

    if (w <= 0 || h <= 0) {
      return res.status(400).json({ message: 'Weight and height must be positive numbers' });
    }

    const heightM = h / 100;
    const bmi = w / (heightM * heightM);
    const bmiRounded = Math.round(bmi * 10) / 10;

    const { category, color } = getCategory(bmi);

    // BMR calculation (Mifflin-St Jeor)
    const g = (gender || '').toLowerCase();
    const sex = g === 'female' ? 0 : 1;
    const bmr = g === 'female'
      ? 10 * w + 6.25 * h - 5 * a - 161
      : 10 * w + 6.25 * h - 5 * a + 5;

    // Healthy weight range for this height
    const idealMin = Math.round(18.5 * heightM * heightM * 10) / 10;
    const idealMax = Math.round(24.9 * heightM * heightM * 10) / 10;

    // Weight to move toward the nearest healthy boundary
    let weightDeltaKg = 0;
    let weightDirection = 'maintain'; // 'lose' | 'gain' | 'maintain'
    if (w < idealMin) {
      weightDeltaKg = Math.round((idealMin - w) * 10) / 10;
      weightDirection = 'gain';
    } else if (w > idealMax) {
      weightDeltaKg = Math.round((w - idealMax) * 10) / 10;
      weightDirection = 'lose';
    }

    // Body-fat estimate (Deurenberg formula) — approximate, screening only
    const bodyFat = Math.round((1.2 * bmi + 0.23 * a - 10.8 * sex - 5.4) * 10) / 10;
    const bodyFatPct = Math.max(0, bodyFat);

    return res.status(200).json({
      bmi: bmiRounded,
      category,
      color,
      bmr: Math.round(bmr),
      bodyFat: bodyFatPct,
      idealWeightRange: { min: idealMin, max: idealMax },
      weightGoal: {
        direction: weightDirection,        // lose | gain | maintain
        deltaKg: weightDeltaKg,            // kg to lose/gain (0 if maintain)
      },
      advice: buildAdvice(category, weightDeltaKg),
    });
  } catch (error) {
    return res.status(500).json({ message: 'BMI calculation failed', error: error.message });
  }
};
