const WORKOUT_MODELS = {
  home: {
    legs: {
      mode: 'home',
      bodyPart: 'legs',
      modelId: 'home_legs_situps',
      title: 'Legs Animation',
      source: 'local',
    },
  },
  gym: {},
};

const normalizeSegment = (value = '') => String(value).trim().toLowerCase();

export const getWorkoutModel = async (req, res) => {
  try {
    const mode = normalizeSegment(req.query.mode);
    const bodyPart = normalizeSegment(req.query.bodyPart);

    if (!mode || !bodyPart) {
      return res.status(400).json({ message: 'mode and bodyPart are required' });
    }

    const config = WORKOUT_MODELS?.[mode]?.[bodyPart];
    if (!config) {
      return res.status(404).json({ message: 'No animation model configured for this selection yet' });
    }

    return res.status(200).json(config);
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching workout model', error: error.message });
  }
};
