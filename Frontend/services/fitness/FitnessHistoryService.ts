/**
 * FitnessHistoryService.ts
 * ──────────────────────────────────────────────────────────────
 * Fetches historical step + calorie data for analytics screens.
 *
 * Ranges:
 *   D  = 24 hourly buckets (last 24 h)
 *   W  =  7 daily buckets
 *   M  = 30 daily buckets
 *   6M = 26 weekly buckets (∼6 months)
 *   Y  = 12 monthly buckets
 *
 * • Prefers HealthKit (collection queries) on iOS — exact, fast.
 * • Falls back to Pedometer for steps when HK is unavailable.
 * • In-memory TTL cache (60 s) per (metric × range) tuple.
 * ──────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';
import { HealthKitService } from './HealthKitService';
import { HealthConnectService } from './HealthConnectService';
import { PedometerService } from './PedometerService';

/* ---------- Types ---------- */

export type RangeKey = 'D' | 'W' | 'M' | '6M' | 'Y';
export type MetricKey = 'steps' | 'activeCalories';

export interface HistoryBucket {
  /** Start of the bucket (local time). */
  date: Date;
  /** Aggregated value for the bucket (steps or kcal). */
  value: number;
  /** Short label for the X-axis ("9 AM", "Mon", "12", "Jan"). */
  label: string;
}

export interface HistorySeries {
  range: RangeKey;
  metric: MetricKey;
  buckets: HistoryBucket[];
  total: number;
  average: number;
  /** Index of the bucket with the maximum value (-1 if all zero). */
  bestIndex: number;
  /** Source of the underlying data. */
  source: 'healthkit' | 'health_connect' | 'pedometer' | 'mixed' | 'none';
  /** Caption for the UI (e.g. "Tracked by Apple Health"). */
  sourceLabel: string;
}

/* ---------- Cache ---------- */

interface CacheEntry {
  series: HistorySeries;
  expires: number;
}

const TTL_MS = 60_000; // 60 s
const cache = new Map<string, CacheEntry>();

const cacheKey = (metric: MetricKey, range: RangeKey) => `${metric}:${range}`;

/* ---------- Helpers ---------- */

const startOfLocalDay = (d: Date = new Date()): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);

const startOfWeek = (d: Date): Date => {
  const day = startOfLocalDay(d);
  const dow = day.getDay(); // 0 = Sun
  const diff = (dow + 6) % 7; // make Mon the start of week
  return new Date(day.getTime() - diff * 24 * 60 * 60 * 1000);
};

const startOfMonth = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);

const dayShortName = (d: Date): string =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];

const monthShortName = (d: Date): string =>
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getMonth()
  ];

const hourLabel = (d: Date): string => {
  const h = d.getHours();
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
};

/* ---------- Aggregation ---------- */

const aggregateByWeek = (
  daily: Array<{ date: Date; value: number }>,
  weeks: number
): HistoryBucket[] => {
  const out: HistoryBucket[] = [];
  // Walk from end backwards, grouping into ISO weeks.
  if (daily.length === 0) return out;

  const end = startOfWeek(daily[daily.length - 1].date);
  for (let w = weeks - 1; w >= 0; w--) {
    const wStart = new Date(end.getTime() - w * 7 * 24 * 60 * 60 * 1000);
    const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    let sum = 0;
    for (const d of daily) {
      if (d.date >= wStart && d.date < wEnd) sum += d.value;
    }
    const label = `${wStart.getDate()}/${wStart.getMonth() + 1}`;
    out.push({ date: wStart, value: sum, label });
  }
  return out;
};

const aggregateByMonth = (
  daily: Array<{ date: Date; value: number }>,
  months: number
): HistoryBucket[] => {
  if (daily.length === 0) return [];
  const today = startOfLocalDay();
  const out: HistoryBucket[] = [];
  for (let m = months - 1; m >= 0; m--) {
    const monthStart = new Date(today.getFullYear(), today.getMonth() - m, 1);
    const nextStart = new Date(today.getFullYear(), today.getMonth() - m + 1, 1);
    let sum = 0;
    for (const d of daily) {
      if (d.date >= monthStart && d.date < nextStart) sum += d.value;
    }
    out.push({ date: monthStart, value: sum, label: monthShortName(monthStart) });
  }
  return out;
};

/* ---------- Stats ---------- */

const computeStats = (
  series: Omit<HistorySeries, 'total' | 'average' | 'bestIndex'>
): HistorySeries => {
  const total = series.buckets.reduce((s, b) => s + b.value, 0);
  const nonEmpty = series.buckets.filter((b) => b.value > 0).length;
  const average = nonEmpty > 0 ? total / nonEmpty : 0;
  let bestIndex = -1;
  let bestVal = 0;
  series.buckets.forEach((b, i) => {
    if (b.value > bestVal) {
      bestVal = b.value;
      bestIndex = i;
    }
  });
  return { ...series, total, average, bestIndex };
};

/* ---------- HK identifier mapping ---------- */

const hkIdentifier = (metric: MetricKey) =>
  metric === 'steps'
    ? ('HKQuantityTypeIdentifierStepCount' as const)
    : ('HKQuantityTypeIdentifierActiveEnergyBurned' as const);

const sourceLabelFor = (
  source: HistorySeries['source'],
  range: RangeKey
): string => {
  if (source === 'healthkit')
    return range === 'D'
      ? 'Tracked by Apple Health'
      : 'Synced from Apple Health';
  if (source === 'health_connect')
    return range === 'D'
      ? 'Tracked by Health Connect'
      : 'Synced from Health Connect';
  if (source === 'pedometer') return 'Motion tracking active';
  if (source === 'mixed') return 'Estimated from activity';
  return 'No data';
};

/* ---------- Service ---------- */

class _FitnessHistoryService {
  /**
   * Fetch a range. Cached for 60 s per (metric × range).
   */
  async getRange(metric: MetricKey, range: RangeKey): Promise<HistorySeries> {
    const key = cacheKey(metric, range);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      return hit.series;
    }

    const series = await this._fetch(metric, range);
    cache.set(key, { series, expires: Date.now() + TTL_MS });
    return series;
  }

  /** Force a re-fetch (clears cache for that tuple). */
  invalidate(metric?: MetricKey, range?: RangeKey): void {
    if (!metric && !range) {
      cache.clear();
      return;
    }
    if (metric && range) {
      cache.delete(cacheKey(metric, range));
      return;
    }
    // Partial invalidation
    for (const k of Array.from(cache.keys())) {
      if (metric && k.startsWith(`${metric}:`)) cache.delete(k);
      if (range && k.endsWith(`:${range}`)) cache.delete(k);
    }
  }

  /* ── Internal ── */

  private async _fetch(metric: MetricKey, range: RangeKey): Promise<HistorySeries> {
    const identifier = hkIdentifier(metric);

    // ── DAY (hourly buckets) ──────────────────────────────────
    if (range === 'D') {
      const hk = await HealthKitService.getHourlyBuckets(identifier, 24);
      if (hk && hk.length) {
        const buckets: HistoryBucket[] = hk.map((p) => ({
          date: p.date,
          value: p.value,
          label: hourLabel(p.date),
        }));
        return computeStats({
          range,
          metric,
          buckets,
          source: 'healthkit',
          sourceLabel: sourceLabelFor('healthkit', range),
        });
      }

      // Fallback: pedometer total (no hourly resolution) → single bar.
      if (metric === 'steps') {
        const pedo = await PedometerService.getStepsToday();
        const buckets: HistoryBucket[] = [
          {
            date: new Date(),
            value: pedo?.steps ?? 0,
            label: hourLabel(new Date()),
          },
        ];
        return computeStats({
          range,
          metric,
          buckets,
          source: pedo ? 'pedometer' : 'none',
          sourceLabel: sourceLabelFor(pedo ? 'pedometer' : 'none', range),
        });
      }

      return computeStats({
        range,
        metric,
        buckets: [],
        source: 'none',
        sourceLabel: sourceLabelFor('none', range),
      });
    }

    // ── W / M / 6M / Y ────────────────────────────────────────
    const days = range === 'W' ? 7 : range === 'M' ? 30 : range === '6M' ? 26 * 7 : 365;
    const hkDaily = await HealthKitService.getDailyBuckets(identifier, days);

    let daily: Array<{ date: Date; value: number }> | null = hkDaily;
    let source: HistorySeries['source'] = hkDaily ? 'healthkit' : 'none';

    // Android: try Health Connect for historical data if HK is not available
    if (!daily && Platform.OS === 'android' && HealthConnectService.initialized && HealthConnectService.authorized) {
      const hcMetric = metric === 'steps' ? 'steps' as const : 'activeCalories' as const;
      const hcDaily = await HealthConnectService.getDailyBuckets(hcMetric, days);
      if (hcDaily && hcDaily.length > 0) {
        daily = hcDaily;
        source = 'health_connect';
      }
    }

    // Steps fallback to per-day pedometer queries if HK absent (iOS only).
    if (!daily && metric === 'steps' && Platform.OS === 'ios') {
      const total = await PedometerService.getStepsTrailingDays(days);
      if (total !== null) {
        // We only have an aggregate; build a single trailing bucket so the
        // UI still renders a meaningful summary.
        daily = [{ date: new Date(), value: total }];
        source = 'pedometer';
      }
    }

    if (!daily || daily.length === 0) {
      return computeStats({
        range,
        metric,
        buckets: [],
        source: 'none',
        sourceLabel: sourceLabelFor('none', range),
      });
    }

    let buckets: HistoryBucket[];
    if (range === 'W') {
      buckets = daily.map((p) => ({
        date: p.date,
        value: p.value,
        label: dayShortName(p.date),
      }));
    } else if (range === 'M') {
      buckets = daily.map((p) => ({
        date: p.date,
        value: p.value,
        label: String(p.date.getDate()),
      }));
    } else if (range === '6M') {
      buckets = aggregateByWeek(daily, 26);
    } else {
      buckets = aggregateByMonth(daily, 12);
    }

    return computeStats({
      range,
      metric,
      buckets,
      source,
      sourceLabel: sourceLabelFor(source, range),
    });
  }
}

/** Singleton */
export const FitnessHistoryService = new _FitnessHistoryService();
