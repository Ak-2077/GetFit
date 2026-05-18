/**
 * scripts/testWebhook.js
 * ──────────────────────────────────────────────────────────────
 * Simulates a Razorpay payment.captured webhook hitting our
 * /api/payments/razorpay/webhook endpoint via the public tunnel.
 *
 *   node scripts/testWebhook.js --url=https://xxx.trycloudflare.com
 *
 * Optional:
 *   --orderId=order_XXX     reuse a specific order id (otherwise
 *                            creates a fresh pending sub for this run)
 *   --bad                   send an INVALID signature to confirm
 *                            the server rejects it with 400
 *
 * Prereqs:
 *   • backend running locally and reachable through --url
 *   • RAZORPAY_WEBHOOK_SECRET set in .env (matches the one you
 *     configured in the Razorpay dashboard)
 * ──────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';

import connectDB from '../config/db.js';
import User from '../models/user.js';
import Subscription from '../models/subscription.js';
import { getPlanById } from '../config/plans.js';

const arg = (k, fb) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  if (m) return m.split('=').slice(1).join('=');
  return process.argv.includes(`--${k}`) ? true : fb;
};

const tunnelUrl = arg('url', null);
const orderIdArg = arg('orderId', null);
const sendBad = Boolean(arg('bad', false));

const ok = (m) => console.log(`\x1b[32m✔\x1b[0m ${m}`);
const fail = (m) => console.log(`\x1b[31m✘\x1b[0m ${m}`);
const info = (m) => console.log(`\x1b[36m∙\x1b[0m ${m}`);
const hr = () => console.log('─'.repeat(60));

const run = async () => {
  console.log('\nWebhook smoke test\n');
  hr();

  if (!tunnelUrl) {
    fail('Missing --url=<https://...trycloudflare.com>');
    process.exit(1);
  }
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    fail('RAZORPAY_WEBHOOK_SECRET missing in .env');
    process.exit(1);
  }
  ok(`Tunnel: ${tunnelUrl}`);
  ok(`Webhook secret loaded (length ${process.env.RAZORPAY_WEBHOOK_SECRET.length})`);

  // 1. Reach the tunnel ──────────────────────────────────
  const ping = await fetch(tunnelUrl + '/').catch((e) => ({ ok: false, _err: e }));
  if (!ping.ok) {
    fail(`Tunnel unreachable: ${ping._err?.message || ping.status}`);
    process.exit(1);
  }
  ok('Tunnel reaches backend (GET / → 200)');

  // 2. DB ────────────────────────────────────────────────
  await connectDB();

  // 3. Find or create a pending sub to fire the webhook against
  let sub;
  if (orderIdArg) {
    sub = await Subscription.findOne({ razorpayOrderId: orderIdArg });
    if (!sub) {
      fail(`No subscription found for order ${orderIdArg}`);
      process.exit(1);
    }
    info(`Using existing pending sub ${sub._id} (${sub.status})`);
  } else {
    const u = await User.findOne().select('_id').lean();
    if (!u) {
      fail('No user in DB to run the test against');
      process.exit(1);
    }
    const plan = getPlanById('pro_monthly');
    sub = await Subscription.create({
      userId: u._id,
      planId: plan.id,
      planTier: plan.tier,
      billingCycle: plan.billingCycle,
      platform: 'android',
      provider: 'razorpay',
      status: 'pending',
      amount: plan.amountPaise,
      currency: plan.currency,
      razorpayOrderId: `order_test_${Date.now()}`,
      metadata: { source: 'webhook-smoke-test' },
    });
    ok(`Created pending sub ${sub._id} for order ${sub.razorpayOrderId}`);
  }

  // 4. Build a Razorpay-shaped payment.captured payload ──
  const payload = {
    entity: 'event',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: `pay_test_${Date.now()}`,
          amount: sub.amount,
          currency: sub.currency,
          status: 'captured',
          order_id: sub.razorpayOrderId,
          method: 'card',
          captured: true,
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  };

  const rawBody = JSON.stringify(payload);

  // Real signature — matches what Razorpay would send
  const goodSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const signature = sendBad ? goodSig.replace(/.$/, 'x') : goodSig;
  info(`Sending ${sendBad ? '\x1b[31mTAMPERED\x1b[0m' : 'valid'} signature`);

  // 5. POST to the tunnel ────────────────────────────────
  const res = await fetch(tunnelUrl + '/api/payments/razorpay/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature,
    },
    body: rawBody,
  });
  const text = await res.text();

  if (sendBad) {
    if (res.status === 400) {
      ok(`Tampered signature correctly rejected (HTTP 400 — "${text}")`);
    } else {
      fail(`Expected 400, got ${res.status} — "${text}"`);
      process.exit(1);
    }
  } else {
    if (res.status === 200) {
      ok(`Webhook accepted (HTTP 200 — "${text}")`);
    } else {
      fail(`Webhook rejected (HTTP ${res.status} — "${text}")`);
      process.exit(1);
    }

    // 6. Confirm the sub was activated by the webhook ─
    const fresh = await Subscription.findById(sub._id).lean();
    if (fresh.status === 'active' && fresh.verified) {
      ok(`Subscription activated by webhook (expires ${fresh.expiryDate?.toISOString().slice(0, 10)})`);
      const user = await User.findById(fresh.userId).select('subscriptionPlan').lean();
      ok(`User cache updated: subscriptionPlan = "${user.subscriptionPlan}"`);
    } else {
      fail(`Sub status is "${fresh.status}" — webhook did not activate it`);
      process.exit(1);
    }
  }

  // Cleanup if we created the row
  if (!orderIdArg) {
    await Subscription.deleteOne({ _id: sub._id });
    info('Test sub cleaned up');
  }

  hr();
  console.log('\n\x1b[32mAll checks passed.\x1b[0m\n');
  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (e) => {
  fail(`Unexpected error: ${e.message}`);
  console.error(e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
