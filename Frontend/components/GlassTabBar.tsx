import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Pressable, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// ─── SAFE LIQUID GLASS IMPORT ───────────────────────────
let LiquidGlassViewComponent: React.ComponentType<any> = View;
let _isLiquidGlassSupported = false;

try {
  const lg = require('@callstack/liquid-glass');
  if (lg.isLiquidGlassSupported) {
    LiquidGlassViewComponent = lg.LiquidGlassView;
    _isLiquidGlassSupported = true;
  }
} catch {
  // Native module not available — fallback tab bar will render
}

// ═══════════════════════════════════════════════════════════
// TAB CONFIG
// ═══════════════════════════════════════════════════════════
// Approx height of the floating bar (content + vertical padding).
// Screens add this + safe-area + 20 as bottom padding so the last
// item is never hidden behind the floating bar.
export const TAB_BAR_HEIGHT = 64;

const TAB_CONFIG: Record<string, { label: string; icon: string }> = {
  index: { label: 'Home', icon: 'home' },
  workout: { label: 'Workout', icon: 'male' },
  'ai-trainer': { label: 'Kyro', icon: 'reddit-alien' },
  calories: { label: 'Calories', icon: 'fire' },
  profile: { label: 'Profile', icon: 'user-circle' },
};

// ─── iOS 26 — CRITICALLY DAMPED SPRING ──────────────────
const APPLE_SPRING = {
  damping: 24,
  stiffness: 260,
  mass: 0.8,
  overshootClamping: true,
};

const TAP_SPRING = { damping: 22, stiffness: 400 };

// ─── iOS 26 COLORS ──────────────────────────────────────
const LG = {
  active: '#1FA463',
  inactive: 'rgba(255,255,255,0.55)',
  capsule: 'rgba(255,255,255,0.06)',
  capsuleBorder: 'rgba(255,255,255,0.04)',
};

// ═══════════════════════════════════════════════════════════
// TAB ITEM (iOS 26) — subtle press response
// ═══════════════════════════════════════════════════════════
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function TabItem({
  route,
  isFocused,
  onPress,
  onLongPress,
}: {
  route: any;
  isFocused: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const config = TAB_CONFIG[route.name] || { label: route.name, icon: 'circle' };
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      onPressIn={() => {
        scale.value = withSpring(0.96, TAP_SPRING);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, TAP_SPRING);
      }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        {
          flex: 1,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          paddingVertical: 7,
        },
        animStyle,
      ]}
    >
      <FontAwesome
        name={config.icon as any}
        size={22}
        color={isFocused ? LG.active : LG.inactive}
      />
      <Text
        style={{
          fontSize: 10,
          fontWeight: isFocused ? '600' : '400',
          color: isFocused ? LG.active : LG.inactive,
          marginTop: 3,
          letterSpacing: -0.1,
        }}
      >
        {config.label}
      </Text>
    </AnimatedPressable>
  );
}

// ═══════════════════════════════════════════════════════════
// iOS 26 LIQUID GLASS DOCK — TAP-BASED, RESTRAINED
// Uses @callstack/liquid-glass native view for real glass material
// ═══════════════════════════════════════════════════════════
function LiquidGlassDock({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);
  const numTabs = state.routes.length;
  const tabWidth = numTabs > 0 ? barWidth / numTabs : 0;

  const capsuleX = useSharedValue(0);

  useEffect(() => {
    if (barWidth > 0) {
      capsuleX.value = withSpring(state.index * tabWidth, APPLE_SPRING);
    }
  }, [state.index, barWidth, tabWidth]);

  const capsuleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: capsuleX.value }],
  }));

  const handlePress = useCallback(
    (route: any, index: number) => {
      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (state.index !== index && !event.defaultPrevented) {
        navigation.navigate(route.name);
      }
    },
    [navigation, state.index],
  );

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: Math.max(insets.bottom, 8) + 4,
        left: 16,
        right: 16,
      }}
    >
      <LiquidGlassViewComponent
        effect="regular"
        colorScheme="dark"
        style={{
          borderRadius: 36,
          overflow: 'hidden' as const,
        }}
      >
        <View
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 4,
            paddingHorizontal: 4,
          }}
        >
          {barWidth > 0 && (
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  top: 3,
                  bottom: 3,
                  left: 4,
                  width: tabWidth - 8,
                  borderRadius: 30,
                  backgroundColor: LG.capsule,
                  borderWidth: 0.5,
                  borderColor: LG.capsuleBorder,
                },
                capsuleStyle,
              ]}
            />
          )}

          {state.routes.map((route, index) => (
            <TabItem
              key={route.key}
              route={route}
              isFocused={state.index === index}
              onPress={() => handlePress(route, index)}
              onLongPress={() =>
                navigation.emit({ type: 'tabLongPress', target: route.key })
              }
            />
          ))}
        </View>
      </LiquidGlassViewComponent>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════
// FALLBACK TAB BAR — floating glassmorphism capsule (WhatsApp iOS style)
// For Android + iOS < 26 + unsupported devices.
// Content scrolls BEHIND this bar; the blur reveals it faintly.
// ═══════════════════════════════════════════════════════════
const BAR_RADIUS = 36;

const TC = {
  active: '#1FA463',
  activeGlow: '#A6F7C2',
  inactive: 'rgba(255,255,255,0.45)',
  // Low-opacity tint so the blur can reveal content behind the bar.
  tint: Platform.OS === 'android' ? 'rgba(16,22,18,0.82)' : 'rgba(16,22,18,0.35)',
  capsule: 'rgba(31,164,99,0.16)',
  capsuleBorder: 'rgba(31,164,99,0.30)',
  border: 'rgba(255,255,255,0.10)',
};

function FallbackTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);
  const numTabs = state.routes.length;
  const tabWidth = numTabs > 0 ? barWidth / numTabs : 0;
  const capsuleX = useSharedValue(0);

  useEffect(() => {
    if (barWidth > 0) {
      capsuleX.value = withSpring(state.index * tabWidth, APPLE_SPRING);
    }
  }, [state.index, barWidth, tabWidth]);

  const capsuleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: capsuleX.value }],
  }));

  const handlePress = (route: any, index: number) => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (state.index !== index && !event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: Math.max(insets.bottom, 12) + 6,
        left: 16,
        right: 16,
      }}
    >
      <View
        style={{
          borderRadius: BAR_RADIUS,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.30,
          shadowRadius: 20,
          elevation: 12,
        }}
      >
        <View style={{ borderRadius: BAR_RADIUS, overflow: 'hidden' }}>
          <BlurView intensity={40} tint="dark" style={{ borderRadius: BAR_RADIUS }}>
            <View
              onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 6,
                paddingHorizontal: 6,
                backgroundColor: TC.tint,
                borderWidth: 1,
                borderColor: TC.border,
                borderRadius: BAR_RADIUS,
              }}
            >
              {/* Sliding active capsule */}
              {barWidth > 0 && (
                <Animated.View
                  style={[
                    {
                      position: 'absolute',
                      top: 5,
                      bottom: 5,
                      left: 6,
                      width: tabWidth - 8,
                      borderRadius: 28,
                      backgroundColor: TC.capsule,
                      borderWidth: 1,
                      borderColor: TC.capsuleBorder,
                    },
                    capsuleStyle,
                  ]}
                />
              )}

              {state.routes.map((route, index) => {
                const isFocused = state.index === index;
                const config = TAB_CONFIG[route.name] || { label: route.name, icon: 'circle' };
                return (
                  <TouchableOpacity
                    key={route.key}
                    accessibilityRole="button"
                    accessibilityState={isFocused ? { selected: true } : {}}
                    onPress={() => handlePress(route, index)}
                    onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                    activeOpacity={0.7}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 12,
                    }}
                  >
                    <FontAwesome
                      name={config.icon as any}
                      size={21}
                      color={isFocused ? TC.active : TC.inactive}
                    />
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: isFocused ? '700' : '500',
                        color: isFocused ? TC.active : TC.inactive,
                        marginTop: 3,
                      }}
                    >
                      {config.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </BlurView>
        </View>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════
// SMART GATE — LiquidGlassDock on iOS 26, fallback elsewhere
// ═══════════════════════════════════════════════════════════
export default function GlassTabBar(props: BottomTabBarProps) {
  if (_isLiquidGlassSupported) {
    return <LiquidGlassDock {...props} />;
  }
  return <FallbackTabBar {...props} />;
}
