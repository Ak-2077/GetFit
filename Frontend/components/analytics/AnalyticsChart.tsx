/**
 * AnalyticsChart.tsx
 * ──────────────────────────────────────────────────────────────
 * Reusable, animated SVG chart for the Steps / Calories analytics
 * screens. Two render modes:
 *   • "bars"  — rounded vertical bars with sequential reveal
 *   • "area"  — smooth area + line with animated draw-in
 *
 * • Touch / drag selects a bucket, reveals a tooltip, and emits
 *   onSelect(index). Releases stay sticky until next touch.
 * • Pure SVG — works with the existing react-native-svg setup.
 * ──────────────────────────────────────────────────────────────
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, GestureResponderEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  withDelay,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  Rect,
  Line,
  Text as SvgText,
  Circle,
} from 'react-native-svg';

import type { HistoryBucket } from '../../services/fitness/FitnessHistoryService';

const ARect = Animated.createAnimatedComponent(Rect);
const APath = Animated.createAnimatedComponent(Path);

/* ---------- Types ---------- */

export interface AnalyticsChartProps {
  buckets: HistoryBucket[];
  mode?: 'bars' | 'area';
  height?: number;
  width: number;
  /** Tailwind-ish accent colors */
  accent: string;
  accentSoft: string;
  /** Y-axis label formatter */
  formatValue?: (v: number) => string;
  /** Tooltip header text (e.g. "Steps", "kcal") */
  unit?: string;
  /** Date format used in tooltips */
  formatDate?: (d: Date) => string;
  onSelect?: (index: number) => void;
}

/* ---------- Constants ---------- */

const PAD_TOP = 24;
const PAD_BOTTOM = 24;
const PAD_LEFT = 0;
const PAD_RIGHT = 0;

/* ---------- Path helpers ---------- */

const buildLinePath = (points: { x: number; y: number }[]): string => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const cx = (prev.x + cur.x) / 2;
    d += ` Q ${cx} ${prev.y} ${cx} ${(prev.y + cur.y) / 2}`;
    d += ` Q ${cx} ${cur.y} ${cur.x} ${cur.y}`;
  }
  return d;
};

/* ---------- Component ---------- */

export const AnalyticsChart: React.FC<AnalyticsChartProps> = ({
  buckets,
  mode = 'bars',
  height = 220,
  width,
  accent,
  accentSoft,
  formatValue,
  unit = '',
  formatDate,
  onSelect,
}) => {
  const [selected, setSelected] = useState<number | null>(null);
  const animProgress = useSharedValue(0);

  // Re-trigger reveal animation when the dataset changes.
  useEffect(() => {
    animProgress.value = 0;
    animProgress.value = withDelay(
      80,
      withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) })
    );
    setSelected(null);
  }, [buckets, animProgress]);

  const drawWidth = width - PAD_LEFT - PAD_RIGHT;
  const drawHeight = height - PAD_TOP - PAD_BOTTOM;

  const maxValue = useMemo(() => {
    const m = Math.max(1, ...buckets.map((b) => b.value));
    return m;
  }, [buckets]);

  // Pre-compute X positions and heights
  const points = useMemo(
    () =>
      buckets.map((b, i) => {
        const x =
          buckets.length === 1
            ? drawWidth / 2 + PAD_LEFT
            : PAD_LEFT + (i / (buckets.length - 1)) * drawWidth;
        const ratio = b.value / maxValue;
        const h = Math.max(0, ratio * drawHeight);
        const y = PAD_TOP + drawHeight - h;
        return { x, y, h, value: b.value, label: b.label, date: b.date };
      }),
    [buckets, drawWidth, drawHeight, maxValue]
  );

  // Y-axis ticks
  const yTicks = useMemo(() => {
    return [0, maxValue / 2, maxValue].map((v) => ({
      value: v,
      y: PAD_TOP + drawHeight - (v / maxValue) * drawHeight,
    }));
  }, [maxValue, drawHeight]);

  /* ── Touch handling ───────────────────────────────────────── */

  const handleTouch = (e: GestureResponderEvent) => {
    if (buckets.length === 0) return;
    const { locationX } = e.nativeEvent;
    const idx = Math.max(
      0,
      Math.min(
        buckets.length - 1,
        Math.round(((locationX - PAD_LEFT) / drawWidth) * (buckets.length - 1))
      )
    );
    if (idx !== selected) {
      setSelected(idx);
      onSelect?.(idx);
      Haptics.selectionAsync().catch(() => {});
    }
  };

  /* ── Render ───────────────────────────────────────────────── */

  if (buckets.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>No data yet</Text>
      </View>
    );
  }

  return (
    <View style={{ width, height: height + 16 }}>
      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleTouch}
        onResponderMove={handleTouch}
      >
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="ac-bar" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={accent} stopOpacity="1" />
              <Stop offset="100%" stopColor={accent} stopOpacity="0.55" />
            </LinearGradient>
            <LinearGradient id="ac-area" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={accent} stopOpacity="0.45" />
              <Stop offset="100%" stopColor={accent} stopOpacity="0.02" />
            </LinearGradient>
          </Defs>

          {/* Y-axis grid */}
          {yTicks.map((t, i) => (
            <Line
              key={`grid-${i}`}
              x1={PAD_LEFT}
              y1={t.y}
              x2={width - PAD_RIGHT}
              y2={t.y}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={1}
            />
          ))}

          {/* Mode: bars */}
          {mode === 'bars' &&
            points.map((p, i) => {
              const barW = Math.max(
                3,
                Math.min(22, drawWidth / Math.max(1, points.length) - 6)
              );
              return (
                <AnimatedBar
                  key={`bar-${i}`}
                  index={i}
                  total={points.length}
                  x={p.x - barW / 2}
                  y={p.y}
                  width={barW}
                  height={p.h}
                  fill="url(#ac-bar)"
                  selected={selected === i}
                  accentSoft={accentSoft}
                  progress={animProgress}
                  baseY={PAD_TOP + drawHeight}
                />
              );
            })}

          {/* Mode: area — static paths; reveal handled by wrapper opacity */}
          {mode === 'area' && (
            <AreaPath
              points={points}
              accent={accent}
              padTop={PAD_TOP}
              drawHeight={drawHeight}
            />
          )}

          {/* Selected indicator */}
          {selected !== null && points[selected] && (
            <>
              <Line
                x1={points[selected].x}
                y1={PAD_TOP}
                x2={points[selected].x}
                y2={PAD_TOP + drawHeight}
                stroke={accent}
                strokeWidth={1}
                strokeDasharray="3,3"
                opacity={0.6}
              />
              <Circle
                cx={points[selected].x}
                cy={points[selected].y}
                r={5}
                fill={accent}
                stroke="#0B0B0B"
                strokeWidth={2}
              />
            </>
          )}

          {/* X-axis labels (sample evenly to avoid crowding) */}
          {points.map((p, i) => {
            const total = points.length;
            const stride = Math.max(1, Math.ceil(total / 7));
            if (i % stride !== 0 && i !== total - 1) return null;
            return (
              <SvgText
                key={`xlabel-${i}`}
                x={p.x}
                y={height - 4}
                fill="rgba(255,255,255,0.45)"
                fontSize="10"
                textAnchor="middle"
                fontWeight="500"
              >
                {p.label}
              </SvgText>
            );
          })}
        </Svg>

        {/* Tooltip */}
        {selected !== null && points[selected] && (
          <View
            style={[
              styles.tooltip,
              {
                left: Math.min(
                  Math.max(points[selected].x - 60, 4),
                  width - 124
                ),
                top: Math.max(points[selected].y - 56, 0),
                borderColor: accent,
              },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.tooltipValue}>
              {formatValue
                ? formatValue(points[selected].value)
                : Math.round(points[selected].value).toLocaleString()}
              {unit ? ` ${unit}` : ''}
            </Text>
            <Text style={styles.tooltipDate}>
              {formatDate
                ? formatDate(points[selected].date)
                : points[selected].label}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

/* ---------- Animated bar ---------- */

interface AnimatedBarProps {
  index: number;
  total: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  selected: boolean;
  accentSoft: string;
  progress: SharedValue<number>;
  baseY: number;
}

const AnimatedBar: React.FC<AnimatedBarProps> = ({
  index,
  total,
  x,
  y,
  width,
  height,
  fill,
  selected,
  accentSoft,
  progress,
  baseY,
}) => {
  const animatedProps = useAnimatedProps(() => {
    // Sequential reveal: each bar starts a tiny bit later.
    const delay = (index / Math.max(1, total)) * 0.5;
    const t = Math.max(0, Math.min(1, (progress.value - delay) / (1 - delay)));
    const animH = height * t;
    return {
      y: baseY - animH,
      height: animH,
    } as any;
  }, [progress, height, baseY, index, total]);

  return (
    <>
      {/* halo when selected */}
      {selected && (
        <Rect
          x={x - 3}
          y={baseY - height - 3}
          width={width + 6}
          height={height + 6}
          rx={(width + 6) / 2}
          fill={accentSoft}
        />
      )}
      <ARect
        animatedProps={animatedProps}
        x={x}
        width={width}
        rx={width / 2}
        fill={fill}
      />
    </>
  );
};

/* ---------- Area path (static — reveal handled by wrapper) ---------- */

interface AreaPathProps {
  points: { x: number; y: number }[];
  accent: string;
  padTop: number;
  drawHeight: number;
}

const AreaPath: React.FC<AreaPathProps> = ({ points, accent, padTop, drawHeight }) => {
  if (points.length === 0) return null;
  const baseY = padTop + drawHeight;
  const line = buildLinePath(points);
  if (!line) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${line} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`;

  return (
    <>
      <Path d={area} fill="url(#ac-area)" />
      <Path
        d={line}
        stroke={accent}
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
};

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
  },
  tooltip: {
    position: 'absolute',
    minWidth: 120,
    backgroundColor: 'rgba(10,10,10,0.92)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  tooltipValue: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  tooltipDate: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    marginTop: 2,
  },
});
