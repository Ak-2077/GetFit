/**
 * Subscription Sweeper
 * ──────────────────────────────────────────────────────────────
 * Periodic background task that:
 *   1. Marks expired subscriptions (status='active' && expiryDate ≤ now → 'expired')
 *   2. Resets the User.subscriptionPlan cache to 'free' for any user
 *      whose only active sub just expired.
 *
 * This is a *defensive* second layer. The primary expiry path is
 * lazy: `resolveActivePlan()` already runs `_expireStale()` on every
 * status read. The sweeper exists so users who *don't* open the app
 * still have their entitlement and User.subscriptionPlan cache flipped
 * promptly — important for analytics, push targeting, and any
 * server-initiated work that joins on subscriptionPlan.
 *
 * Why no node-cron?
 *   • Avoids an extra dependency.
 *   • A simple setInterval with leader-elect-by-env is portable
 *     across PM2 / Docker / single-node deployments.
 *   • Catch-up on boot covers the case where the process was offline
 *     across an expiry boundary.
 *
 * To run on only ONE worker in a clustered deployment, set
 *   SUBSCRIPTION_SWEEPER_ENABLED=true
 * on exactly one process.
 * ──────────────────────────────────────────────────────────────
 */

import Subscription from '../models/subscription.js';
import User from '../models/user.js';

/* ---------- Constants ---------- */

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // every 1 hour (covers timezone edges)
const STARTUP_DELAY_MS = 30 * 1000; // 30s after boot — let DB warm up

let _timer = null;
let _running = false;
let _lastRunAt = null;
let _lastResult = null;

/* ---------- Core sweep ---------- */

/**
 * Run a single sweep pass. Returns counts so callers (tests, admin
 * endpoints) can see what happened. Idempotent — safe to call any time.
 */
export const runSweepOnce = async () => {
  if (_running) {
    console.log('[SubscriptionSweeper] sweep already in progress — skipping');
    return _lastResult || { skipped: true };
  }
  _running = true;
  const t0 = Date.now();

  try {
    const now = new Date();

    // ── 1. Flip newly-expired active subs to 'expired' ────────
    const expiredRes = await Subscription.updateMany(
      {
        status: 'active',
        expiryDate: { $lte: now },
      },
      { $set: { status: 'expired' } }
    );
    const expiredCount = expiredRes.modifiedCount || 0;

    // ── 2. Find affected users and recompute their cache ──────
    let downgradedCount = 0;
    if (expiredCount > 0) {
      // Find users whose newest sub is now non-active.
      // Conservative approach: for any user with subscriptionPlan != 'free'
      // who has NO active+verified sub anymore, reset to 'free'.
      const stalePremiumUsers = await User.find({
        subscriptionPlan: { $in: ['pro', 'pro_plus'] },
      })
        .select('_id')
        .lean();

      for (const u of stalePremiumUsers) {
        const stillActive = await Subscription.findActiveForUser(u._id);
        if (!stillActive) {
          await User.updateOne(
            { _id: u._id },
            {
              $set: {
                subscriptionPlan: 'free',
                subscriptionExpiresAt: null,
                activeSubscriptionId: null,
              },
            }
          );
          downgradedCount += 1;
        }
      }
    }

    const elapsed = Date.now() - t0;
    _lastRunAt = new Date();
    _lastResult = {
      ranAt: _lastRunAt.toISOString(),
      expiredCount,
      downgradedCount,
      elapsedMs: elapsed,
    };

    if (expiredCount || downgradedCount) {
      console.log(
        `[SubscriptionSweeper] swept: ${expiredCount} expired, ${downgradedCount} users downgraded → free | ${elapsed}ms`
      );
    } else {
      console.log(`[SubscriptionSweeper] sweep clean (no changes) | ${elapsed}ms`);
    }
    return _lastResult;
  } catch (e) {
    console.error('[SubscriptionSweeper] sweep error:', e);
    _lastResult = { error: e.message, ranAt: new Date().toISOString() };
    return _lastResult;
  } finally {
    _running = false;
  }
};

/**
 * Boot the sweeper. Safe to call multiple times — only the first call
 * actually starts the timer.
 *
 * Honors the `SUBSCRIPTION_SWEEPER_ENABLED` env var:
 *   - undefined / 'true' / '1' → run
 *   - 'false' / '0'             → skip
 */
export const startSubscriptionSweeper = () => {
  if (_timer) {
    console.log('[SubscriptionSweeper] already running');
    return;
  }

  const flag = process.env.SUBSCRIPTION_SWEEPER_ENABLED;
  if (flag === 'false' || flag === '0') {
    console.log('[SubscriptionSweeper] disabled via SUBSCRIPTION_SWEEPER_ENABLED=false');
    return;
  }

  console.log(
    `[SubscriptionSweeper] starting | interval=${SWEEP_INTERVAL_MS}ms | first run in ${STARTUP_DELAY_MS}ms`
  );

  // First run shortly after boot so the server catches up on any
  // expiries that happened while it was offline.
  setTimeout(() => {
    runSweepOnce().catch((e) =>
      console.error('[SubscriptionSweeper] startup sweep failed:', e)
    );
  }, STARTUP_DELAY_MS);

  _timer = setInterval(() => {
    runSweepOnce().catch((e) =>
      console.error('[SubscriptionSweeper] periodic sweep failed:', e)
    );
  }, SWEEP_INTERVAL_MS);

  // Don't keep the event loop alive for the timer alone (relevant for tests).
  if (_timer.unref) _timer.unref();
};

/** Stop the periodic timer. Useful for graceful shutdown / tests. */
export const stopSubscriptionSweeper = () => {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log('[SubscriptionSweeper] stopped');
  }
};

/** Diagnostics endpoint helper. */
export const getSweeperStatus = () => ({
  running: !!_timer,
  inFlight: _running,
  lastRunAt: _lastRunAt,
  lastResult: _lastResult,
});
