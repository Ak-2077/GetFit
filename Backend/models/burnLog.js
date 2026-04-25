import mongoose from 'mongoose';

const burnLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    caloriesBurned: {
      type: Number,
      required: true,
    },
    activity: {
      type: String,
      default: '',
    },
    durationMinutes: {
      type: Number,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model('BurnLog', burnLogSchema);
