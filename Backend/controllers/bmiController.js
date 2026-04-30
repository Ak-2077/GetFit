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

    let category, color;
    if (bmi < 18.5) {
      category = 'Underweight';
      color = '#FF4D4D';
    } else if (bmi < 25) {
      category = 'Normal';
      color = '#1FA463';
    } else if (bmi < 30) {
      category = 'Overweight';
      color = '#FFA500';
    } else {
      category = 'Obese';
      color = '#FF4D4D';
    }

    // BMR calculation (Mifflin-St Jeor)
    const g = (gender || '').toLowerCase();
    let bmr;
    if (g === 'female') {
      bmr = 10 * w + 6.25 * h - 5 * a - 161;
    } else {
      bmr = 10 * w + 6.25 * h - 5 * a + 5;
    }

    return res.status(200).json({
      bmi: bmiRounded,
      category,
      color,
      bmr: Math.round(bmr),
      idealWeightRange: {
        min: Math.round(18.5 * heightM * heightM * 10) / 10,
        max: Math.round(24.9 * heightM * heightM * 10) / 10,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'BMI calculation failed', error: error.message });
  }
};
