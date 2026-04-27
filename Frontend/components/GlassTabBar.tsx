import React from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// ─── CONSTANTS ──────────────────────────────────────────
const NOTCH_SIZE = 80;
const CENTER_BTN_SIZE = 68;
const BAR_RADIUS = 35;
const CENTER_LIFT = 32;

const TC = {
  barBg: 'rgba(22,33,25,0.78)',
  active: '#1FA463',
  activeGlow: '#A6F7C2',
  inactive: 'rgba(255,255,255,0.30)',
  screenBg: '#050505',
};

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

  const leftRoutes = state.routes.slice(0, centerIndex);
  const centerRoute = state.routes[centerIndex];
  const rightRoutes = state.routes.slice(centerIndex + 1);
  const centerConfig = TAB_CONFIG[centerRoute?.name] || { label: 'AI', icon: 'circle' };
  const isCenterFocused = state.index === centerIndex;
  const centerHandlers = centerRoute ? getHandlers(centerRoute, isCenterFocused) : { onPress: () => {}, onLongPress: () => {} };

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
          marginHorizontal: 2,
        }}
      >
        <View style={{
          shadowColor: isFocused ? TC.activeGlow : 'transparent',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: isFocused ? 0.5 : 0,
          shadowRadius: 8,
          elevation: isFocused ? 4 : 0,
        }}>
          <FontAwesome
            name={config.icon as any}
            size={21}
            color={isFocused ? TC.active : TC.inactive}
          />
        </View>
        <Text style={{
          fontSize: 10,
          fontWeight: isFocused ? '700' : '500',
          color: isFocused ? TC.active : TC.inactive,
          marginTop: 3,
        }}>
          {config.label}
        </Text>
        {/* Active dot */}
        {isFocused && (
          <View style={{
            width: 4, height: 4, borderRadius: 2,
            backgroundColor: TC.active, marginTop: 3,
          }} />
        )}
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
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -CENTER_LIFT,
          left: 0, right: 0,
          alignItems: 'center',
          zIndex: 2,
        }}
      >
        <View style={{
          width: NOTCH_SIZE,
          height: NOTCH_SIZE,
          borderRadius: NOTCH_SIZE / 2,
          backgroundColor: TC.screenBg,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.04,
          shadowRadius: 4,
          elevation: 1,
        }} />
      </View>

      {/* ═══ CENTER FLOATING ORB ═══ */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: -(CENTER_LIFT + (CENTER_BTN_SIZE - NOTCH_SIZE) / 2),
          left: 0, right: 0,
          alignItems: 'center',
          zIndex: 3,
        }}
      >
        {/* Glow behind */}
        <View style={{
          position: 'absolute',
          top: CENTER_BTN_SIZE / 2 + 4,
          width: 50, height: 24, borderRadius: 12,
          backgroundColor: 'rgba(31,164,99,0.15)',
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
            shadowColor: isCenterFocused ? TC.activeGlow : TC.active,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: isCenterFocused ? 0.45 : 0.15,
            shadowRadius: 16,
            elevation: 10,
          }}
        >
          <LinearGradient
            colors={
              isCenterFocused
                ? ['rgba(31,164,99,0.9)', 'rgba(15,40,25,0.95)']
                : ['rgba(30,50,38,0.9)', 'rgba(22,33,25,0.95)']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: CENTER_BTN_SIZE,
              height: CENTER_BTN_SIZE,
              borderRadius: CENTER_BTN_SIZE / 2,
              justifyContent: 'center',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: isCenterFocused
                ? 'rgba(166,247,194,0.25)'
                : 'rgba(70,130,90,0.2)',
            }}
          >
            <FontAwesome
              name={centerConfig.icon as any}
              size={25}
              color={isCenterFocused ? TC.activeGlow : TC.inactive}
            />
          </LinearGradient>
        </TouchableOpacity>

        <Text style={{
          fontSize: 10,
          fontWeight: isCenterFocused ? '700' : '500',
          color: isCenterFocused ? TC.active : TC.inactive,
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
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 10,
      }}>
        <View style={{ borderRadius: BAR_RADIUS, overflow: 'hidden' }}>
          <BlurView
            intensity={50}
            tint="dark"
            style={{ borderRadius: BAR_RADIUS }}
          >
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 10,
              paddingHorizontal: 8,
              backgroundColor: TC.barBg,
              borderWidth: 1,
              borderColor: 'rgba(70,130,90,0.12)',
              borderRadius: BAR_RADIUS,
            }}>
              {leftRoutes.map(renderTab)}
              <View style={{ width: NOTCH_SIZE + 8 }} />
              {rightRoutes.map(renderTab)}
            </View>
          </BlurView>
        </View>
      </View>
    </View>
  );
}
