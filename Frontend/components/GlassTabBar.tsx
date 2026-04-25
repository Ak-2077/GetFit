import React from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// ─── TAB CONFIG ─────────────────────────────────────────
// Maps route names to their display labels and FontAwesome icons
const TAB_CONFIG: Record<string, { label: string; icon: string }> = {
  index: { label: 'Home', icon: 'home' },
  workout: { label: 'Workout', icon: 'male' },
  'ai-trainer': { label: 'AI Trainer', icon: 'reddit-alien' },
  calories: { label: 'Calories', icon: 'fire' },
  profile: { label: 'Profile', icon: 'user-circle' },
};

// ─── COMPONENT ──────────────────────────────────────────
export default function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const centerIndex = Math.floor(state.routes.length / 2); // AI Trainer position

  return (
    <View style={{
      position: 'absolute',
      bottom: 20,
      left: 15,
      right: 15,
    }}>
      {/* Outer wrapper with shadow (shadow doesn't work on BlurView directly) */}
      <View style={{
        borderRadius: 35,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 24,
        elevation: 12,
      }}>
        {/* Blur background */}
        <BlurView
          intensity={60}
          tint="light"
          style={{
            borderRadius: 35,
            overflow: 'hidden',
          }}
        >
          {/* Semi-transparent overlay on top of blur */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-around',
            paddingVertical: 10,
            paddingHorizontal: 6,
            backgroundColor: 'rgba(255,255,255,0.55)',
          }}>
            {state.routes.map((route, index) => {
              const isFocused = state.index === index;
              const isCenter = index === centerIndex;
              const config = TAB_CONFIG[route.name] || { label: route.name, icon: 'circle' };

              const onPress = () => {
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
              };

              const onLongPress = () => {
                navigation.emit({
                  type: 'tabLongPress',
                  target: route.key,
                });
              };

              // ─── CENTER BUTTON (AI Trainer) ───
              if (isCenter) {
                return (
                  <View key={route.key} style={{ alignItems: 'center', width: 72 }}>
                    {/* Glow underneath */}
                    <View style={{
                      position: 'absolute',
                      top: -18,
                      width: 55,
                      height: 30,
                      borderRadius: 25,
                      backgroundColor: 'rgba(34,197,94,0.18)',
                    }} />

                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityState={isFocused ? { selected: true } : {}}
                      onPress={onPress}
                      onLongPress={onLongPress}
                      activeOpacity={0.8}
                      style={{
                        width: 65,
                        height: 65,
                        borderRadius: 50,
                        marginTop: -30,
                        justifyContent: 'center',
                        alignItems: 'center',
                        shadowColor: '#22c55e',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.25,
                        shadowRadius: 12,
                        elevation: 8,
                      }}
                    >
                      <LinearGradient
                        colors={
                          isFocused
                            ? ['rgba(255,255,255,0.95)', 'rgba(220,252,231,0.9)']
                            : ['rgba(255,255,255,0.85)', 'rgba(240,240,240,0.8)']
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{
                          width: 65,
                          height: 65,
                          borderRadius: 50,
                          justifyContent: 'center',
                          alignItems: 'center',
                          borderWidth: 1.5,
                          borderColor: isFocused
                            ? 'rgba(34,197,94,0.3)'
                            : 'rgba(255,255,255,0.6)',
                        }}
                      >
                        <FontAwesome
                          name={config.icon as any}
                          size={24}
                          color={isFocused ? '#111111' : '#999999'}
                        />
                      </LinearGradient>
                    </TouchableOpacity>

                    <Text style={{
                      fontSize: 10,
                      fontWeight: isFocused ? '700' : '500',
                      color: isFocused ? '#111111' : '#999999',
                      marginTop: 4,
                    }}>
                      {config.label}
                    </Text>
                  </View>
                );
              }

              // ─── REGULAR TAB ───
              return (
                <TouchableOpacity
                  key={route.key}
                  accessibilityRole="button"
                  accessibilityState={isFocused ? { selected: true } : {}}
                  onPress={onPress}
                  onLongPress={onLongPress}
                  activeOpacity={0.7}
                  style={{
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: 6,
                    paddingHorizontal: 14,
                    borderRadius: 22,
                    backgroundColor: isFocused
                      ? 'rgba(255,255,255,0.9)'
                      : 'transparent',
                    shadowColor: isFocused ? '#000' : 'transparent',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: isFocused ? 0.06 : 0,
                    shadowRadius: 6,
                    elevation: isFocused ? 3 : 0,
                    minWidth: 58,
                  }}
                >
                  <FontAwesome
                    name={config.icon as any}
                    size={22}
                    color={isFocused ? '#111111' : '#aaaaaa'}
                  />
                  <Text style={{
                    fontSize: 10,
                    fontWeight: isFocused ? '700' : '500',
                    color: isFocused ? '#111111' : '#aaaaaa',
                    marginTop: 4,
                  }}>
                    {config.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </BlurView>
      </View>
    </View>
  );
}
