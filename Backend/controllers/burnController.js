import BurnLog from '../models/burnLog.js';

export const addBurnLog = async (req, res) => {
  try {
    const userId = req.userId;
    const { caloriesBurned, activity, durationMinutes } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    if (!caloriesBurned || caloriesBurned <= 0) {
      return res.status(400).json({ message: 'caloriesBurned must be greater than 0' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const burnLog = new BurnLog({
      userId,
      caloriesBurned,
      activity,
      durationMinutes,
      date: today,
    });

    await burnLog.save();
    res.status(201).json({ message: 'Burn log added', burnLog });
  } catch (err) {
    res.status(500).json({ message: 'Error adding burn log', error: err.message });
  }
};

export const getTodaysBurnLog = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const logs = await BurnLog.find({ userId, date: { $gte: today } })
      .sort({ createdAt: -1 });

    const totalCaloriesBurned = logs.reduce(
      (sum, log) => sum + (log.caloriesBurned || 0),
      0
    );

    res.status(200).json({
      logs,
      totalCaloriesBurned,
      count: logs.length,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching burn log', error: err.message });
  }
};

export const removeBurnLog = async (req, res) => {
  try {
    const { logId } = req.params;
    const userId = req.userId;

    const log = await BurnLog.findById(logId);
    if (!log) {
      return res.status(404).json({ message: 'Burn log entry not found' });
    }

    if (log.userId.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await BurnLog.findByIdAndDelete(logId);
    res.status(200).json({ message: 'Burn log removed' });
  } catch (err) {
    res.status(500).json({ message: 'Error removing burn log', error: err.message });
  }
};
