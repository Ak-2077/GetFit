import React from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// ─── CONSTANTS ──────────────────────────────────────────
const SCREEN_BG = '#f1f0ec';
const NOTCH_SIZE = 80;
const CENTER_BTN_SIZE = 68;
const BAR_RADIUS = 35;
const CENTER_LIFT = 32; // how far above bar the button sits

// ─── TAB CONFIG ─────────────────────────────────────────
const TAB_CONFIG: Record<string, { label: string; icon: string }> = {
  index: { label: 'Home', icon: 'home' },
  workout: { label: 'Workout', icon: 'male' },
  'ai-trainer': { label: 'AI Trainer', icon: 'reddit-alien' },
  calories: { label: 'Calories', icon: 'fire' },
  profile: { label: 'Profile', icon: 'user-circle' },
};

// ─── COMPONENT ──────────────────────────────────────────
export default function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const centerIndex = Math.floor(state.routes.length / 2);

  // Build press handlers
  const getHandlers = (route: any, isFocused: boolean) => ({
    onPress: () => {
      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name);
      }
    },
    onLongPress: () => {
      navigation.emit({ type: 'tabLongPress', target: route.key });
    },
  });

  // Split routes into left / center / right
  const leftRoutes = state.routes.slice(0, centerIndex);
  const centerRoute = state.routes[centerIndex];
  const rightRoutes = state.routes.slice(centerIndex + 1);
  const centerConfig = TAB_CONFIG[centerRoute?.name] || { label: 'AI', icon: 'circle' };
  const isCenterFocused = state.index === centerIndex;
  const centerHandlers = centerRoute ? getHandlers(centerRoute, isCenterFocused) : { onPress: () => {}, onLongPress: () => {} };

  // Render a regular tab item
  const renderTab = (route: any, index: number) => {
    const actualIndex = state.routes.indexOf(route);
    const isFocused = state.index === actualIndex;
    const config = TAB_CONFIG[route.name] || { label: route.name, icon: 'circle' };
    const handlers = getHandlers(route, isFocused);

    return (
      <TouchableOpacity
        key={route.key}
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        onPress={handlers.onPress}
        onLongPress={handlers.onLongPress}
        activeOpacity={0.7}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 8,
          paddingHorizontal: 4,
          borderRadius: 22,
          backgroundColor: isFocused ? 'rgba(255,255,255,0.92)' : 'transparent',
          shadowColor: isFocused ? '#000' : 'transparent',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isFocused ? 0.08 : 0,
          shadowRadius: 8,
          elevation: isFocused ? 4 : 0,
          marginHorizontal: 2,
        }}
      >
        <FontAwesome
          name={config.icon as any}
          size={21}
          color={isFocused ? '#111111' : '#aaaaaa'}
        />
        <Text style={{
          fontSize: 10,
          fontWeight: isFocused ? '700' : '500',
          color: isFocused ? '#111111' : '#aaaaaa',
          marginTop: 3,
        }}>
          {config.label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: 20,
        left: 15,
        right: 15,
      }}
    >

      {/* ═══ NOTCH CUTOUT ═══ */}
      {/* Circle matching screen background to carve out the notch illusion */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -CENTER_LIFT,
          left: 0,
          right: 0,
          alignItems: 'center',
          zIndex: 2,
        }}
      >
        <View style={{
          width: NOTCH_SIZE,
          height: NOTCH_SIZE,
          borderRadius: NOTCH_SIZE / 2,
          backgroundColor: SCREEN_BG,
          // Subtle inner shadow for depth
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.04,
          shadowRadius: 4,
          elevation: 1,
        }} />
      </View>

      {/* ═══ CENTER FLOATING BUTTON ═══ */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: -(CENTER_LIFT + (CENTER_BTN_SIZE - NOTCH_SIZE) / 2),
          left: 0,
          right: 0,
          alignItems: 'center',
          zIndex: 3,
        }}
      >
        {/* Green glow behind button */}
        <View style={{
          position: 'absolute',
          top: CENTER_BTN_SIZE / 2 + 4,
          width: 50,
          height: 24,
          borderRadius: 12,
          backgroundColor: 'rgba(34,197,94,0.2)',
        }} />

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={isCenterFocused ? { selected: true } : {}}
          onPress={centerHandlers.onPress}
          onLongPress={centerHandlers.onLongPress}
          activeOpacity={0.8}
          style={{
            width: CENTER_BTN_SIZE,
            height: CENTER_BTN_SIZE,
            borderRadius: CENTER_BTN_SIZE / 2,
            shadowColor: isCenterFocused ? '#22c55e' : '#000',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: isCenterFocused ? 0.3 : 0.15,
            shadowRadius: 14,
            elevation: 10,
          }}
        >
          <LinearGradient
            colors={
              isCenterFocused
                ? ['rgba(255,255,255,0.98)', 'rgba(220,252,231,0.95)']
                : ['rgba(255,255,255,0.92)', 'rgba(245,245,245,0.88)']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: CENTER_BTN_SIZE,
              height: CENTER_BTN_SIZE,
              borderRadius: CENTER_BTN_SIZE / 2,
              justifyContent: 'center',
              alignItems: 'center',
              borderWidth: 1.5,
              borderColor: isCenterFocused
                ? 'rgba(34,197,94,0.25)'
                : 'rgba(255,255,255,0.6)',
            }}
          >
            <FontAwesome
              name={centerConfig.icon as any}
              size={25}
              color={isCenterFocused ? '#111111' : '#888888'}
            />
          </LinearGradient>
        </TouchableOpacity>

        <Text style={{
          fontSize: 10,
          fontWeight: isCenterFocused ? '700' : '500',
          color: isCenterFocused ? '#111111' : '#999999',
          marginTop: 5,
        }}>
          {centerConfig.label}
        </Text>
      </View>

      {/* ═══ TAB BAR ═══ */}
      <View style={{
        borderRadius: BAR_RADIUS,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 10,
      }}>
        <View style={{
          borderRadius: BAR_RADIUS,
          overflow: 'hidden',
        }}>
          <BlurView
            intensity={60}
            tint="light"
            style={{ borderRadius: BAR_RADIUS }}
          >
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 10,
              paddingHorizontal: 8,
              backgroundColor: 'rgba(255,255,255,0.55)',
            }}>
              {/* Left tabs */}
              {leftRoutes.map(renderTab)}

              {/* Center spacer — reserves room for the floating button */}
              <View style={{ width: NOTCH_SIZE + 8 }} />

              {/* Right tabs */}
              {rightRoutes.map(renderTab)}
            </View>
          </BlurView>
        </View>
      </View>
    </View>
  );
}
