/**
 * Calories Analytics Screen
 * ──────────────────────────────────────────────────────────────
 * Premium dark UI inspired by Apple Fitness / WHOOP.
 * Shows active vs resting calorie burn, weekly trends, and
 * workout contribution. Uses real HealthKit history.
 * ──────────────────────────────────────────────────────────────
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useFitness } from '../../hooks/useFitness';
import {
  FitnessHistoryService,
  type HistorySeries,
  type RangeKey,
} from '../../services/fitness/FitnessHistoryService';
import { AnalyticsChart } from '../../components/analytics/AnalyticsChart';
import { RangeTabs } from '../../components/analytics/RangeTabs';
import { AnimatedCounter } from '../../components/analytics/AnimatedCounter';
import { calculateBMR } from '../../services/fitness/CalorieEstimator';

/* ---------- Theme ---------- */

const C = {
  bg: '#060D09',
  card: 'rgba(20,22,24,0.92)',
  cardBorder: 'rgba(255,255,255,0.06)',
  burn: '#FF6B6B',
  burnSoft: 'rgba(255,107,107,0.14)',
  accent: '#1FA463',
  white: '#F0F0F0',
  text: '#F0F0F0',
  subtext: 'rgba(255,255,255,0.65)',
  muted: 'rgba(255,255,255,0.40)',
  label: 'rgba(255,255,255,0.50)',
};

const SCREEN_W = Dimensions.get('window').width;

/* ---------- Screen ---------- */

export default function CaloriesAnalyticsScreen() {
  const router = useRouter();
  const fitness = useFitness();
  const [range, setRange] = useState<RangeKey>('W');
  const [series, setSeries] = useState<HistorySeries | null>(null);
  const [prevSeries, setPrevSeries] = useState<HistorySeries | null>(null); // for vs-prev compare
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const loadRange = useCallback(async (r: RangeKey, force = false) => {
    if (force) FitnessHistoryService.invalidate('activeCalories', r);
    setLoading(true);
    try {
      const data = await FitnessHistoryService.getRange('activeCalories', r);
      setSeries(data);
      setSelectedIdx(null);

      // Light-weight "previous period" comparison: trailing window already
      // gives us the data we need — split current series in half to compare.
      if (data.buckets.length >= 4) {
        const half = Math.floor(data.buckets.length / 2);
        const prev = data.buckets.slice(0, half);
        const prevTotal = prev.reduce((s, b) => s + b.value, 0);
        setPrevSeries({
          ...data,
          buckets: prev,
          total: prevTotal,
          average: prev.length > 0 ? prevTotal / prev.length : 0,
        });
      } else {
        setPrevSeries(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRange(range);
  }, [range, loadRange]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRange(range, true);
    setRefreshing(false);
  }, [range, loadRange]);

  /* ── Stats ──────────────────────────────────────────────── */

  const bmr = useMemo(() => Math.round(calculateBMR({
    weightKg: 70, heightCm: 170, ageYears: 30, gender: 'male',
  })), []);

  const stats = useMemo(() => {
    if (!series) {
      return { total: 0, average: 0, best: 0, bestLabel: '—', vsPrevPct: 0, workout: 0 };
    }
    const total = Math.round(series.total);
    const average = Math.round(series.average);
    const best =
      series.bestIndex >= 0 ? Math.round(series.buckets[series.bestIndex].value) : 0;
    const bestLabel =
      series.bestIndex >= 0 ? series.buckets[series.bestIndex].label : '—';

    // % vs previous half-window
    let vsPrevPct = 0;
    if (prevSeries && prevSeries.average > 0) {
      const curHalf = series.buckets.slice(Math.floor(series.buckets.length / 2));
      const curHalfAvg =
        curHalf.reduce((s, b) => s + b.value, 0) / Math.max(1, curHalf.length);
      vsPrevPct = Math.round(((curHalfAvg - prevSeries.average) / prevSeries.average) * 100);
    }

    const workout = Math.round(fitness.manualCalories || 0);
    return { total, average, best, bestLabel, vsPrevPct, workout };
  }, [series, prevSeries, fitness.manualCalories]);

  const todayValue =
    range === 'D' ? Math.round(fitness.caloriesBurned) : stats.average;
  const headerLabel = range === 'D' ? 'Today' : `Avg / day · ${range}`;

  // Resting calories proportional to elapsed day fraction (live)
  const restingToday = useMemo(() => {
    const now = new Date();
    const elapsed =
      (now.getHours() * 60 + now.getMinutes()) / (24 * 60); // 0..1
    return Math.round(bmr * elapsed);
  }, [bmr]);

  const totalDayBurn = restingToday + Math.round(fitness.caloriesBurned);

  const formatDate = (d: Date) => {
    if (range === 'D') {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  };

  /* ── Render ─────────────────────────────────────────────── */

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={styles.glow} />

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              router.back();
            }}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={22} color={C.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Calories</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.burn}
            />
          }
        >
          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{headerLabel}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <AnimatedCounter value={todayValue} style={styles.heroValue} />
              <Text style={styles.heroUnit}> kcal</Text>
            </View>
            <Text style={styles.sourceLabel}>
              {fitness.isSyncing ? 'Syncing Health Data…' : series?.sourceLabel || ' '}
            </Text>
          </View>

          {/* Range tabs */}
          <View style={{ paddingHorizontal: 20, marginTop: 4 }}>
            <RangeTabs value={range} onChange={setRange} accent={C.burn} />
          </View>

          {/* Chart */}
          <View style={styles.chartCard}>
            {loading && !series ? (
              <View style={{ height: 220, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: C.muted, fontSize: 13 }}>Loading…</Text>
              </View>
            ) : (
              <AnalyticsChart
                buckets={series?.buckets ?? []}
                mode="area"
                width={SCREEN_W - 64}
                height={220}
                accent={C.burn}
                accentSoft={C.burnSoft}
                unit="kcal"
                formatDate={formatDate}
                onSelect={setSelectedIdx}
              />
            )}
          </View>

          {/* Active vs Resting vs Workout (today's split) */}
          <View style={styles.splitCard}>
            <Text style={styles.cardTitle}>Today's Burn</Text>
            <View style={{ marginTop: 12 }}>
              <SplitRow
                color={C.burn}
                label="Active"
                value={Math.round(fitness.caloriesBurned)}
                pct={pctOf(fitness.caloriesBurned, totalDayBurn)}
              />
              <SplitRow
                color="#FFA500"
                label="Workout"
                value={stats.workout}
                pct={pctOf(stats.workout, totalDayBurn)}
              />
              <SplitRow
                color="#60A5FA"
                label="Resting"
                value={restingToday}
                pct={pctOf(restingToday, totalDayBurn)}
              />
            </View>
            <View style={styles.divider} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{totalDayBurn.toLocaleString()} kcal</Text>
            </View>
          </View>

          {/* Stat grid */}
          <View style={styles.statsRow}>
            <StatCard
              title="Average"
              value={stats.average.toLocaleString()}
              sub={range === 'D' ? 'per hour' : 'per day'}
              accent={C.burn}
            />
            <StatCard
              title="Best"
              value={stats.best.toLocaleString()}
              sub={stats.bestLabel}
              accent="#FFA500"
            />
          </View>

          <View style={styles.statsRow}>
            <StatCard
              title="Total"
              value={stats.total.toLocaleString()}
              sub={`This ${range === 'D' ? 'day' : range === 'W' ? 'week' : range === 'M' ? 'month' : range === '6M' ? '6 months' : 'year'}`}
              accent={C.burn}
            />
            <StatCard
              title="vs Previous"
              value={`${stats.vsPrevPct > 0 ? '+' : ''}${stats.vsPrevPct}%`}
              sub={stats.vsPrevPct >= 0 ? 'Trending up' : 'Trending down'}
              accent={stats.vsPrevPct >= 0 ? C.accent : C.burn}
            />
          </View>

          {/* Insight */}
          <View style={[styles.chartCard, { marginTop: 18 }]}>
            <View style={styles.insightRow}>
              <View style={[styles.insightDot, { backgroundColor: C.burn }]} />
              <Text style={styles.insightTitle}>Burn Insight</Text>
            </View>
            <Text style={styles.insightBody}>
              {stats.average > 0
                ? `You burn an average of ${stats.average.toLocaleString()} active kcal ${range === 'D' ? 'per hour' : 'per day'} on this range. ${stats.vsPrevPct >= 0 ? 'You\'re trending higher than the previous period.' : 'You\'re trending lower than the previous period — try a longer walk today.'}`
                : 'Move around to start tracking your active calorie burn.'}
            </Text>
          </View>

          {selectedIdx !== null && series?.buckets[selectedIdx] && (
            <View style={[styles.chartCard, { marginTop: 12 }]}>
              <View style={styles.insightRow}>
                <View style={[styles.insightDot, { backgroundColor: '#FFA500' }]} />
                <Text style={styles.insightTitle}>
                  {formatDate(series.buckets[selectedIdx].date)}
                </Text>
              </View>
              <Text style={styles.insightBody}>
                {Math.round(series.buckets[selectedIdx].value).toLocaleString()} kcal
                burned
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/* ---------- Helpers ---------- */

const pctOf = (part: number, total: number) =>
  total > 0 ? Math.round((part / total) * 100) : 0;

/* ---------- Inline components ---------- */

interface SplitRowProps {
  color: string;
  label: string;
  value: number;
  pct: number;
}

const SplitRow: React.FC<SplitRowProps> = ({ color, label, value, pct }) => (
  <View style={{ marginBottom: 12 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Text style={{ color: C.subtext, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      </View>
      <Text style={{ color: C.white, fontSize: 13, fontWeight: '700' }}>
        {value.toLocaleString()} kcal
      </Text>
    </View>
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          { width: `${Math.min(100, pct)}%`, backgroundColor: color },
        ]}
      />
    </View>
  </View>
);

interface StatCardProps {
  title: string;
  value: string;
  sub?: string;
  accent: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, sub, accent }) => (
  <View style={styles.statCard}>
    <Text style={styles.statTitle}>{title}</Text>
    <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
    {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
  </View>
);

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: -120,
    right: -120,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(255,107,107,0.05)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: C.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  hero: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 18,
  },
  heroLabel: {
    color: C.label,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  heroValue: {
    color: C.white,
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1.5,
    marginTop: 4,
  },
  heroUnit: {
    color: C.subtext,
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 6,
  },
  sourceLabel: {
    color: C.muted,
    fontSize: 12,
    marginTop: 6,
    fontWeight: '500',
  },
  chartCard: {
    marginHorizontal: 20,
    marginTop: 18,
    padding: 16,
    borderRadius: 22,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  splitCard: {
    marginHorizontal: 20,
    marginTop: 18,
    padding: 18,
    borderRadius: 22,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  cardTitle: {
    color: C.label,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 12,
  },
  totalLabel: {
    color: C.subtext,
    fontSize: 13,
    fontWeight: '600',
  },
  totalValue: {
    color: C.white,
    fontSize: 16,
    fontWeight: '800',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    marginTop: 12,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 18,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  statTitle: {
    color: C.label,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 8,
  },
  statSub: {
    color: C.muted,
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  insightDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  insightTitle: {
    color: C.white,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  insightBody: {
    color: C.subtext,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
});
