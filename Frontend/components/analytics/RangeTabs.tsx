/**
 * RangeTabs.tsx
 * ──────────────────────────────────────────────────────────────
 * Apple-style segmented range selector: D · W · M · 6M · Y.
 * Animated indicator slides between segments using reanimated.
 * ──────────────────────────────────────────────────────────────
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { RangeKey } from '../../services/fitness/FitnessHistoryService';

const RANGES: RangeKey[] = ['D', 'W', 'M', '6M', 'Y'];

interface Props {
  value: RangeKey;
  onChange: (next: RangeKey) => void;
  accent?: string;
}

export const RangeTabs: React.FC<Props> = ({ value, onChange, accent = '#1FA463' }) => {
  const [width, setWidth] = useState(0);
  const segmentW = width > 0 ? (width - 8) / RANGES.length : 0;
  const idx = RANGES.indexOf(value);
  const tx = useSharedValue(idx * segmentW);

  useEffect(() => {
    tx.value = withTiming(idx * segmentW, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [idx, segmentW, tx]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
    width: segmentW,
  }));

  return (
    <View
      style={styles.container}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          styles.indicator,
          { backgroundColor: `${accent}26`, borderColor: `${accent}66` },
          indicatorStyle,
        ]}
      />
      {RANGES.map((r) => {
        const active = r === value;
        return (
          <Pressable
            key={r}
            style={styles.segment}
            onPress={() => {
              if (r !== value) {
                Haptics.selectionAsync().catch(() => {});
                onChange(r);
              }
            }}
            hitSlop={6}
          >
            <Text
              style={[
                styles.label,
                { color: active ? '#fff' : 'rgba(255,255,255,0.55)' },
              ]}
            >
              {r}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    position: 'relative',
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    zIndex: 2,
  },
  indicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: 10,
    borderWidth: 1,
    zIndex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});
