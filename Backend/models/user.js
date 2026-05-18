import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: String,
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    password: {
      type: String,
      select: true,
    },
    authProvider: {
      type: String,
      enum: ['phone', 'email', 'email_password', 'google', 'apple'],
      default: 'phone',
    },
    googleSub: {
      type: String,
      trim: true,
    },
    appleSub: {
      type: String,
      trim: true,
    },
    avatar: String,
    // fitness fields
    height: String,
    weight: String,
    age: Number,
    gender: {
      type: String,
      enum: ['male', 'female', 'other', null],
      default: null,
    },
    goal: {
      type: String,
      enum: ['lose_fat', 'gain_muscle', 'maintain', 'gain', 'lose', null],
      default: null,
    },
    targetWeight: String,
    goalTimelineWeeks: Number,
    activityPreference: String,
    dietPreference: {
      type: String,
      enum: ['veg', 'non_veg', null],
      default: null,
    },
    activityLevel: String,
    level: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced', null],
      default: null,
    },
    // Computed fitness metrics
    bmi: {
      type: Number,
      default: null,
    },
    bodyType: {
      type: String,
      enum: ['ectomorph', 'mesomorph', 'endomorph', null],
      default: null,
    },
    maintenanceCalories: {
      type: Number,
      default: null,
    },
    goalCalories: {
      type: Number,
      default: null,
    },
    dailyProteinTarget: {
      type: Number,
      default: null,
    },
    // Subscription
    // ⚠ This is a CACHE for fast reads. The Subscription collection
    //   is the source of truth. See services/subscriptionService.js.
    subscriptionPlan: {
      type: String,
      enum: ['free', 'pro', 'pro_plus'],
      default: 'free',
    },
    subscriptionExpiresAt: {
      type: Date,
      default: null,
    },
    activeSubscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    // Preferences
    notificationsEnabled: {
      type: Boolean,
      default: true,
    },
    onboardingCompleted: {
      type: Boolean,
      default: false,
    },
    // activity metrics for profile rings
    moveTarget: {
      type: Number,
      default: 380,
    },
    moveCurrent: {
      type: Number,
      default: 0,
    },
    steps: {
      type: Number,
      default: 0,
    },
    stepDistanceKm: {
      type: Number,
      default: 0,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
  },
  { timestamps: true }
);

userSchema.index(
  { phone: 1 },
  { name: 'phone_1', unique: true, partialFilterExpression: { phone: { $type: 'string' } } }
);
userSchema.index(
  { email: 1 },
  { name: 'email_1', unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);
userSchema.index(
  { googleSub: 1 },
  { unique: true, partialFilterExpression: { googleSub: { $type: 'string' } } }
);
userSchema.index(
  { appleSub: 1 },
  { unique: true, partialFilterExpression: { appleSub: { $type: 'string' } } }
);

export default mongoose.model('User', userSchema);
