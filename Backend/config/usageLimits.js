/**
 * Usage Limits Config
 * ──────────────────────────────────────────────────────────────
 * Daily free-tier limits, read from environment variables so they
 * can be tuned per-deployment without a code change. Premium tiers
 * (pro / pro_plus) are unlimited and bypass these entirely.
 *
 *   FREE_DAILY_FOOD_SCANS   (default 10)
 *   FREE_DAILY_AI_CHAT      (default 20)
 *   FREE_DAILY_BARCODE      (default 50)
 *
 * Extensible: add a new key here + a `field` on UserUsage to gate a
 * new feature (Workout AI, etc.) without touching the middleware.
 * ──────────────────────────────────────────────────────────────
 */

const toInt = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const USAGE_LIMITS = {
  // field on UserUsage → daily free limit
  foodScans: toInt(process.env.FREE_DAILY_FOOD_SCANS, 10),
  aiCoachChats: toInt(process.env.FREE_DAILY_AI_CHAT, 20),
  barcodeScans: toInt(process.env.FREE_DAILY_BARCODE, 50),
};

/** Tiers that are exempt from daily usage limits. */
export const UNLIMITED_TIERS = ['pro', 'pro_plus'];

/** Next local midnight as an ISO string — used in 429 responses. */
export function nextMidnightISO() {
  const d = new Date();
  d.setHours(24, 0, 0, 0); // rolls to 00:00 tomorrow, local time
  return d.toISOString();
}
