import mongoose from 'mongoose';

/**
 * UserUsage — per-user, per-day usage counters.
 * ──────────────────────────────────────────────────────────────
 * One document per (userId, date) where `date` is a local YYYY-MM-DD
 * string. The unique compound index guarantees we never create two
 * documents for the same user/day, even under concurrent requests.
 *
 * Daily reset is LAZY (no cron): when a request arrives and the stored
 * date != today, the atomic upsert in `consume()` writes today's date
 * with the counter at 1 — effectively resetting yesterday's count.
 *
 * Security model: this collection is the single source of truth for
 * usage limits. It is keyed by userId (from a verified JWT), so logging
 * out, reinstalling, or switching devices cannot reset a user's count.
 * ──────────────────────────────────────────────────────────────
 */

const userUsageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true }, // local YYYY-MM-DD
    foodScans: { type: Number, default: 0 },
    barcodeScans: { type: Number, default: 0 },
    aiCoachChats: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One document per user per day. Prevents duplicate-day documents and
// powers fast lookups.
userUsageSchema.index({ userId: 1, date: 1 }, { unique: true });

/**
 * Local server-time YYYY-MM-DD. Matches the convention used by the
 * streak controller so all "today" buckets line up.
 */
export function todayStr(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Atomically consume one unit of `field` for today, enforcing `limit`.
 *
 * This is the core anti-abuse primitive. It uses a SINGLE atomic
 * findOneAndUpdate with a conditional filter so two simultaneous
 * requests can never both pass when only one unit remains:
 *
 *   - Filter matches the user's TODAY doc only when the counter is
 *     below `limit`. The atomic $inc then bumps it by 1.
 *   - If the filter doesn't match (already at limit), Mongo returns
 *     null → caller treats it as "limit reached".
 *
 * The daily reset is folded in: we always scope the filter to
 * `date: today`. If today's doc doesn't exist yet (new day / new user),
 * `upsert` creates it with the counter at 1.
 *
 * @returns {Promise<{ allowed: boolean, used: number, doc: object|null }>}
 */
userUsageSchema.statics.consume = async function (userId, field, limit) {
  const date = todayStr();

  // 1) Ensure today's document exists (lazy reset). Upsert is safe under
  //    concurrency thanks to the unique (userId, date) index — a racing
  //    duplicate insert throws E11000, which we swallow and retry the read.
  try {
    await this.updateOne(
      { userId, date },
      { $setOnInsert: { userId, date, foodScans: 0, barcodeScans: 0, aiCoachChats: 0 } },
      { upsert: true }
    );
  } catch (e) {
    if (e.code !== 11000) throw e; // 11000 = another request created it first; fine.
  }

  // 2) Atomic conditional increment. Only matches when below the limit.
  const updated = await this.findOneAndUpdate(
    { userId, date, [field]: { $lt: limit } },
    { $inc: { [field]: 1 } },
    { new: true }
  );

  if (updated) {
    return { allowed: true, used: updated[field], doc: updated };
  }

  // 3) Filter didn't match → at (or over) the limit. Read current count.
  const current = await this.findOne({ userId, date }).lean();
  return { allowed: false, used: current ? current[field] : limit, doc: current };
};

/**
 * Read today's usage without consuming (for status endpoints / response
 * enrichment). Returns zeros if no document exists yet.
 */
userUsageSchema.statics.getToday = async function (userId) {
  const date = todayStr();
  const doc = await this.findOne({ userId, date }).lean();
  return doc || { userId, date, foodScans: 0, barcodeScans: 0, aiCoachChats: 0 };
};

const UserUsage = mongoose.model('UserUsage', userUsageSchema);
export default UserUsage;
