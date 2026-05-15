/**
 * Backfill Subscription Documents
 * ─────────────────────────────────────────────────────────────
 * One-shot maintenance script for users whose `User.subscriptionPlan`
 * cache says "pro" / "pro_plus" but who have NO matching document in
 * the `Subscription` collection (the new source of truth).
 *
 * Common causes:
 *   • Plan granted via the old deprecated /upgrade-plan endpoint
 *   • Plan set manually in the DB or via a seed script
 *   • Dev/QA accounts created before the payments refactor
 *
 * Without this backfill, the cancel/restore/status endpoints all
 * return 404 because they query the Subscription collection.
 *
 * USAGE
 *   node scripts/backfillSubscription.js              # dry-run, lists candidates
 *   node scripts/backfillSubscription.js --apply      # actually inserts docs
 *   node scripts/backfillSubscription.js --apply --email=you@example.com
 *   node scripts/backfillSubscription.js --apply --userId=64f...
 *
 * The created Subscription doc is marked:
 *   provider:   'manual'
 *   verified:   true     (so findActiveForUser picks it up)
 *   autoRenew:  true
 *   status:     'active'
 *   expiryDate: User.subscriptionExpiresAt if present, else now+30d
 *   metadata.backfilledAt + metadata.reason
 * ──────────────────────────────────────────────────────────── */

import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/user.js';
import Subscription from '../models/subscription.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const EMAIL = (argv.find((a) => a.startsWith('--email=')) || '').split('=')[1];
const USER_ID = (argv.find((a) => a.startsWith('--userId=')) || '').split('=')[1];

const tierToPlanId = (tier) => {
  if (tier === 'pro') return 'pro_monthly';
  if (tier === 'pro_plus') return 'pro_plus_monthly';
  return null;
};

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGO_URI not set in env.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  // Build the candidate query.
  const q = { subscriptionPlan: { $in: ['pro', 'pro_plus'] } };
  if (EMAIL) q.email = EMAIL.toLowerCase();
  if (USER_ID) q._id = new mongoose.Types.ObjectId(USER_ID);

  const users = await User.find(q).lean();
  console.log(`Found ${users.length} premium user(s) in cache.`);

  let created = 0;
  let skipped = 0;

  for (const u of users) {
    const existing = await Subscription.findOne({
      userId: u._id,
      status: 'active',
      verified: true,
      expiryDate: { $gt: new Date() },
    }).lean();

    if (existing) {
      console.log(`  ⏭  ${u.email || u._id} — already has active sub (${existing._id})`);
      skipped++;
      continue;
    }

    const planId = tierToPlanId(u.subscriptionPlan);
    if (!planId) {
      console.log(`  ⏭  ${u.email || u._id} — unknown tier "${u.subscriptionPlan}"`);
      skipped++;
      continue;
    }

    const expiryDate =
      u.subscriptionExpiresAt && new Date(u.subscriptionExpiresAt) > new Date()
        ? new Date(u.subscriptionExpiresAt)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30d

    const doc = {
      userId: u._id,
      planId,
      planTier: u.subscriptionPlan,
      billingCycle: 'monthly',
      platform: 'android',
      provider: 'manual',
      status: 'active',
      amount: 0,
      currency: 'INR',
      startDate: new Date(),
      expiryDate,
      autoRenew: true,
      verified: true,
      metadata: {
        backfilledAt: new Date(),
        reason: 'legacy plan cache without Subscription doc',
        source: 'backfillSubscription.js',
      },
    };

    if (APPLY) {
      const sub = await Subscription.create(doc);
      await User.updateOne(
        { _id: u._id },
        {
          $set: {
            activeSubscriptionId: sub._id,
            subscriptionExpiresAt: expiryDate,
          },
        }
      );
      console.log(`  ✅ ${u.email || u._id} — created Subscription ${sub._id} (expires ${expiryDate.toISOString()})`);
      created++;
    } else {
      console.log(`  🔎 [dry-run] would create ${planId} for ${u.email || u._id} expiring ${expiryDate.toISOString()}`);
      created++;
    }
  }

  console.log('─'.repeat(60));
  console.log(`Done. ${APPLY ? 'Created' : 'Would create'}: ${created} · Skipped: ${skipped}`);
  if (!APPLY) console.log('Dry-run only. Re-run with --apply to write changes.');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('💥 backfill error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
