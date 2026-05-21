import React, { useCallback } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.2;
const VELOCITY_THRESHOLD = 500;

const TAB_ROUTES = ['/', '/workout', '/ai-trainer', '/calories', '/profile'] as const;

interface SwipeableTabViewProps {
  children: React.ReactNode;
}

export default function SwipeableTabView({ children }: SwipeableTabViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const translateX = useSharedValue(0);

  const currentIndex = TAB_ROUTES.indexOf(pathname as any);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;

  const navigateToTab = useCallback((index: number) => {
    const route = TAB_ROUTES[index];
    if (route) {
      router.navigate(route as any);
    }
  }, [router]);

  const pan = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      // Elastic resistance at edges
      const isAtStart = safeIndex === 0 && e.translationX > 0;
      const isAtEnd = safeIndex === TAB_ROUTES.length - 1 && e.translationX < 0;

      if (isAtStart || isAtEnd) {
        // Rubber-band effect at edges
        translateX.value = e.translationX * 0.25;
      } else {
        translateX.value = e.translationX;
      }
    })
    .onEnd((e) => {
      const shouldSwipe =
        Math.abs(e.translationX) > SWIPE_THRESHOLD ||
        Math.abs(e.velocityX) > VELOCITY_THRESHOLD;

      if (shouldSwipe) {
        const direction = e.translationX > 0 ? -1 : 1;
        const targetIndex = safeIndex + direction;

        if (targetIndex >= 0 && targetIndex < TAB_ROUTES.length) {
          // Animate out, then navigate
          translateX.value = withSpring(0, {
            damping: 28,
            stiffness: 350,
            mass: 0.8,
            velocity: e.velocityX,
          });
          runOnJS(navigateToTab)(targetIndex);
        } else {
          // Snap back at edges
          translateX.value = withSpring(0, {
            damping: 30,
            stiffness: 400,
          });
        }
      } else {
        // Snap back - not enough swipe
        translateX.value = withSpring(0, {
          damping: 30,
          stiffness: 400,
        });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.container, animatedStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
