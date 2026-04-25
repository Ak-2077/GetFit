import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema(
  {
    target: {
      type: String,
      required: true,
      trim: true,
    },
    channel: {
      type: String,
      enum: ['phone', 'email'],
      required: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ target: 1, channel: 1 });

export default mongoose.model('Otp', otpSchema);