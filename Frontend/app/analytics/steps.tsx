/**
 * Steps Analytics Screen
 * ──────────────────────────────────────────────────────────────
 * Premium dark UI inspired by Apple Fitness / Fitbit / WHOOP.
 * Reads real HealthKit history via FitnessHistoryService.
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

/* ---------- Theme ---------- */

const C = {
  bg: '#060D09',
  card: 'rgba(20,22,24,0.92)',
  cardBorder: 'rgba(255,255,255,0.06)',
  accent: '#1FA463',
  accentSoft: 'rgba(31,164,99,0.14)',
  white: '#F0F0F0',
  text: '#F0F0F0',
  subtext: 'rgba(255,255,255,0.65)',
  muted: 'rgba(255,255,255,0.40)',
  label: 'rgba(255,255,255,0.50)',
};

const STEP_GOAL_DEFAULT = 10000;
const SCREEN_W = Dimensions.get('window').width;

/* ---------- Screen ---------- */

export default function StepsAnalyticsScreen() {
  const router = useRouter();
  const fitness = useFitness();
  const [range, setRange] = useState<RangeKey>('W');
  const [series, setSeries] = useState<HistorySeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const loadRange = useCallback(async (r: RangeKey, force = false) => {
    if (force) FitnessHistoryService.invalidate('steps', r);
    setLoading(true);
    try {
      const data = await FitnessHistoryService.getRange('steps', r);
      setSeries(data);
      setSelectedIdx(null);
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

  const stats = useMemo(() => {
    if (!series) {
      return {
        total: 0,
        average: 0,
        best: 0,
        bestLabel: '—',
        distanceKm: 0,
        estCalories: 0,
        goalPercent: 0,
      };
    }

    const total = Math.round(series.total);
    const average = Math.round(series.average);
    const best =
      series.bestIndex >= 0 ? Math.round(series.buckets[series.bestIndex].value) : 0;
    const bestLabel =
      series.bestIndex >= 0 ? series.buckets[series.bestIndex].label : '—';

    // Today's live values for the "Day" mini block
    const todaySteps =
      range === 'D' ? Math.round(fitness.steps) : average; // average is more meaningful for non-day
    const distanceKm = Number((todaySteps * 0.000762).toFixed(2));
    const estCalories = Math.round(todaySteps * 0.045);
    const goalPercent =
      range === 'D'
        ? Math.min(100, Math.round((fitness.steps / STEP_GOAL_DEFAULT) * 100))
        : Math.min(100, Math.round((average / STEP_GOAL_DEFAULT) * 100));

    return { total, average, best, bestLabel, distanceKm, estCalories, goalPercent };
  }, [series, range, fitness.steps]);

  const todayValue = range === 'D' ? Math.round(fitness.steps) : stats.average;
  const headerLabel = range === 'D' ? 'Today' : `Avg / day · ${range}`;

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
        {/* Header */}
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
          <Text style={styles.headerTitle}>Steps</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.accent}
            />
          }
        >
          {/* Hero number */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{headerLabel}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <AnimatedCounter value={todayValue} style={styles.heroValue} />
              <Text style={styles.heroUnit}> steps</Text>
            </View>
            <Text style={styles.sourceLabel}>
              {fitness.isSyncing ? 'Syncing Health Data…' : series?.sourceLabel || ' '}
            </Text>
          </View>

          {/* Range tabs */}
          <View style={{ paddingHorizontal: 20, marginTop: 4 }}>
            <RangeTabs value={range} onChange={setRange} accent={C.accent} />
          </View>

          {/* Chart card */}
          <View style={styles.chartCard}>
            {loading && !series ? (
              <View style={{ height: 220, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: C.muted, fontSize: 13 }}>Loading…</Text>
              </View>
            ) : (
              <AnalyticsChart
                buckets={series?.buckets ?? []}
                mode="bars"
                width={SCREEN_W - 64}
                height={220}
                accent={C.accent}
                accentSoft={C.accentSoft}
                unit="steps"
                formatDate={formatDate}
                onSelect={setSelectedIdx}
              />
            )}
          </View>

          {/* Goal ring + distance */}
          <View style={styles.statsRow}>
            <StatCard
              title="Daily Goal"
              value={`${stats.goalPercent}%`}
              sub={`${STEP_GOAL_DEFAULT.toLocaleString()} steps`}
              accent={C.accent}
              progress={stats.goalPercent / 100}
            />
            <StatCard
              title="Distance"
              value={`${stats.distanceKm.toFixed(2)}`}
              sub="km"
              accent="#60A5FA"
            />
          </View>

          <View style={styles.statsRow}>
            <StatCard
              title="Average"
              value={stats.average.toLocaleString()}
              sub={range === 'D' ? 'per hour' : 'per day'}
              accent={C.accent}
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
              accent={C.accent}
              wide
            />
          </View>

          {/* Insights */}
          <View style={[styles.chartCard, { marginTop: 18 }]}>
            <View style={styles.insightRow}>
              <View style={[styles.insightDot, { backgroundColor: C.accent }]} />
              <Text style={styles.insightTitle}>Walking Estimate</Text>
            </View>
            <Text style={styles.insightBody}>
              {stats.estCalories > 0
                ? `Roughly ${stats.estCalories} kcal burned from movement at this pace.`
                : 'Start moving to see your calorie burn estimate.'}
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
                {Math.round(series.buckets[selectedIdx].value).toLocaleString()} steps
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/* ---------- Inline StatCard ---------- */

interface StatCardProps {
  title: string;
  value: string;
  sub?: string;
  accent: string;
  progress?: number; // 0..1
  wide?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, sub, accent, progress, wide }) => {
  return (
    <View style={[styles.statCard, wide && { flex: 1 }]}>
      <Text style={styles.statTitle}>{title}</Text>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
      {progress !== undefined && (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.min(100, Math.max(0, progress * 100))}%`, backgroundColor: accent },
            ]}
          />
        </View>
      )}
    </View>
  );
};

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: -120,
    right: -120,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(31,164,99,0.05)',
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
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
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
