/**
 * scripts/testRazorpay.js
 * ──────────────────────────────────────────────────────────────
 * End-to-end smoke test for the Razorpay payment flow without
 * needing the mobile app.
 *
 *   1. Verifies env keys exist
 *   2. Calls Razorpay /v1/orders directly to confirm the keys work
 *   3. Inserts a test Subscription row in MongoDB
 *   4. Manually computes + verifies an HMAC signature exactly the
 *      way the controller does
 *
 * Run:
 *   node scripts/testRazorpay.js
 *
 * Optional flag:
 *   --planId=pro_yearly         (default pro_monthly)
 *   --userId=<existing user>    (default: picks any user)
 * ──────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';

import connectDB from '../config/db.js';
import User from '../models/user.js';
import Subscription from '../models/subscription.js';
import { getPlanById } from '../config/plans.js';
import {
  isRazorpayConfigured,
  createOrder,
  verifyPaymentSignature,
} from '../services/razorpayService.js';

/* ── Args ─────────────────────────────────────────────────── */

const arg = (k, fallback) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.split('=').slice(1).join('=') : fallback;
};

const planId = arg('planId', 'pro_monthly');
const userIdArg = arg('userId', null);

/* ── Pretty print ─────────────────────────────────────────── */

const ok = (msg) => console.log(`\x1b[32m✔\x1b[0m ${msg}`);
const fail = (msg) => console.log(`\x1b[31m✘\x1b[0m ${msg}`);
const info = (msg) => console.log(`\x1b[36m∙\x1b[0m ${msg}`);
const hr = () => console.log('─'.repeat(60));

/* ── Run ──────────────────────────────────────────────────── */

const run = async () => {
  console.log('\nRazorpay smoke test\n');
  hr();

  // 1. Keys ──────────────────────────────────────────────
  if (!isRazorpayConfigured()) {
    fail('RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing in .env');
    process.exit(1);
  }
  ok(`Keys loaded (id ${process.env.RAZORPAY_KEY_ID.slice(0, 12)}…)`);

  // 2. Plan ──────────────────────────────────────────────
  const plan = getPlanById(planId);
  if (!plan || plan.tier === 'free') {
    fail(`Plan "${planId}" not found or not purchasable`);
    process.exit(1);
  }
  ok(`Plan resolved: ${plan.name} ${plan.period} → ${plan.amountPaise} paise`);

  // 3. DB ────────────────────────────────────────────────
  await connectDB();
  ok('MongoDB connected');

  let userId = userIdArg;
  if (!userId) {
    const u = await User.findOne().select('_id phone email').lean();
    if (!u) {
      fail('No user in DB — sign up via the app first or pass --userId=<id>');
      process.exit(1);
    }
    userId = String(u._id);
    info(`Using existing user ${userId} (${u.phone || u.email || 'no contact'})`);
  }

  // 4. Razorpay order ────────────────────────────────────
  const receipt = `test_${Date.now()}_${userId.slice(-6)}`;
  let order;
  try {
    order = await createOrder({
      amount: plan.amountPaise,
      currency: plan.currency,
      receipt,
      notes: { userId, planId: plan.id, source: 'smoke-test' },
    });
  } catch (e) {
    fail(`createOrder failed: ${e.message}`);
    fail('  → Most common cause: wrong key/secret pair, or test mode mismatch');
    process.exit(1);
  }
  ok(`Razorpay order created: ${order.id} (status: ${order.status})`);

  // 5. Pending Subscription row ──────────────────────────
  const sub = await Subscription.create({
    userId,
    planId: plan.id,
    planTier: plan.tier,
    billingCycle: plan.billingCycle,
    platform: 'android',
    provider: 'razorpay',
    status: 'pending',
    amount: plan.amountPaise,
    currency: plan.currency,
    razorpayOrderId: order.id,
    metadata: { receipt, smokeTest: true },
  });
  ok(`Subscription row written (status=pending, id=${sub._id})`);

  // 6. Simulate signature ────────────────────────────────
  // In real life, Razorpay generates this. For the smoke test we
  // compute it ourselves to prove our verifier is reciprocal.
  const fakePaymentId = `pay_test_${Date.now()}`;
  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${order.id}|${fakePaymentId}`)
    .digest('hex');

  const valid = verifyPaymentSignature({
    razorpay_order_id: order.id,
    razorpay_payment_id: fakePaymentId,
    razorpay_signature: expectedSig,
  });
  if (!valid) {
    fail('verifyPaymentSignature() returned false on a self-generated sig — BUG');
    process.exit(1);
  }
  ok('HMAC signature round-trip verified');

  // 7. Tampered signature should fail ────────────────────
  const tampered = expectedSig.slice(0, -1) + (expectedSig.slice(-1) === 'a' ? 'b' : 'a');
  const shouldBeFalse = verifyPaymentSignature({
    razorpay_order_id: order.id,
    razorpay_payment_id: fakePaymentId,
    razorpay_signature: tampered,
  });
  if (shouldBeFalse) {
    fail('verifyPaymentSignature() accepted a tampered signature — BUG');
    process.exit(1);
  }
  ok('Tampered signature correctly rejected');

  // 8. Cleanup ───────────────────────────────────────────
  await Subscription.deleteOne({ _id: sub._id });
  info('Test Subscription row cleaned up');

  hr();
  console.log('\n\x1b[32mAll checks passed.\x1b[0m\n');
  console.log('You can now run the full UI flow:');
  console.log('  1. cd Frontend');
  console.log('  2. npm install react-native-razorpay');
  console.log('  3. npx expo prebuild && npx expo run:android');
  console.log('  4. Open Upgrade → Subscribe → use test card 4111 1111 1111 1111\n');

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (e) => {
  fail(`Unexpected error: ${e.message}`);
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
