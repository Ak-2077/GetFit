import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// ─── Shared shimmer hook ─────────────────────────────────
const useShimmer = (duration = 1200) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return anim;
};

// ─── Base shimmer wrapper ────────────────────────────────
interface ShimmerProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: ViewStyle | ViewStyle[];
}

function Shimmer({ width, height, borderRadius = 8, style }: ShimmerProps) {
  const anim = useShimmer();
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 200],
  });

  return (
    <View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View
        style={{
          ...StyleSheet.absoluteFillObject,
          transform: [{ translateX }],
        }}
      >
        <LinearGradient
          colors={[
            'rgba(255,255,255,0)',
            'rgba(255,255,255,0.08)',
            'rgba(255,255,255,0)',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1, width: 200 }}
        />
      </Animated.View>
    </View>
  );
}

// ─── Public primitives ───────────────────────────────────

/** Rectangular skeleton placeholder */
export function SkeletonBox({
  width = '100%',
  height = 20,
  borderRadius = 10,
  style,
}: {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  return <Shimmer width={width} height={height} borderRadius={borderRadius} style={style} />;
}

/** Circular skeleton placeholder (avatars, icons) */
export function SkeletonCircle({
  size = 44,
  style,
}: {
  size?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  return <Shimmer width={size} height={size} borderRadius={size / 2} style={style} />;
}

/** Text line placeholder — thin line with optional width */
export function SkeletonText({
  width = '60%',
  height = 12,
  style,
}: {
  width?: number | string;
  height?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  return <Shimmer width={width} height={height} borderRadius={6} style={style} />;
}

/** Card skeleton — a card-shaped container with shimmer */
export function SkeletonCard({
  height = 80,
  borderRadius = 18,
  style,
}: {
  height?: number;
  borderRadius?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  return <Shimmer width="100%" height={height} borderRadius={borderRadius} style={style} />;
}

export default { SkeletonBox, SkeletonCircle, SkeletonText, SkeletonCard };
