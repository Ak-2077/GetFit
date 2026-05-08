import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/user.js';

dotenv.config();

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

const email = getArg('--email') || process.env.TARGET_EMAIL;
const plan = getArg('--plan') || process.env.TARGET_PLAN;
const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

if (!uri) {
  console.error('Missing MongoDB URI. Set MONGO_URI (or MONGODB_URI) in environment.');
  process.exit(1);
}

if (!email || !plan) {
  console.error('Usage: node setSubscription.js --email user@example.com --plan pro');
  process.exit(1);
}

const VALID = ['free', 'pro', 'pro_plus'];
if (!VALID.includes(plan)) {
  console.error('Invalid plan. Must be one of:', VALID.join(', '));
  process.exit(1);
}

async function run() {
  try {
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB');

    const user = await User.findOne({ email });
    if (!user) {
      console.error('User not found for email:', email);
      process.exit(2);
    }

    const current = user.subscriptionPlan || 'free';
    user.subscriptionPlan = plan;
    await user.save();

    console.log(`Updated user ${email}: ${current} -> ${plan}`);
    process.exit(0);
  } catch (err) {
    console.error('Update failed:', err.message || err);
    process.exit(3);
  }
}

run();
