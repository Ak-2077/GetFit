import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, RefreshControl,
  Image, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { getUserProfile, setAuthToken } from '../../services/api';
import { WorkoutSkeleton } from '../../components/SkeletonScreens';
import SwipeableTabView from '../../components/SwipeableTabView';


// ── Design tokens ──
const C = {
  bg: '#060D09',
  card: 'rgba(25,25,25,1)',
  cardBorder: 'rgba(255,255,255,0.08)',
  accent: '#1FA463',
  accentGlow: 'rgba(31,164,99,0.06)',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.50)',
  muted: 'rgba(255,255,255,0.30)',
 purple: '#6A0DAD',
  grey: 'rgba(180,180,180,0.3)',
};


// ── Card data ──
const GRID_CARDS = [
  {
    key: 'home',
    title: 'Home Workout',
    subtitle: 'Train anywhere,\nno equipment needed',
    icon: require('../../assets/icons/Home.png'),
    iconSize: 44,
    difficulty: 'Beginner – Advanced',
    accentColor: C.accent,
    accentBg: 'rgba(31,164,99,0.14)',
  },
  {
    key: 'gym',
    title: 'Gym Training',
    subtitle: 'Full equipment\nworkouts & routines',
    icon: require('../../assets/icons/Gym.png'),
    iconSize: 44,
    difficulty: 'Intermediate – Pro',
    accentColor: C.purple,
    accentBg: 'rgba(106,13,173,0.14)',
  },
];

const AI_CARD = {
  key: 'ai',
  title: 'Kyro',
  subtitle: 'Your personal AI trainer',
  icon: require('../../assets/icons/ai.png'),
  iconSize: 28,
  count: '30+',
  countLabel: 'programs',
  accentColor: '#64e7f1',
  accentBg: 'rgba(100,231,241,0.12)',
};

// ── Animated press wrapper ──
function PressableCard({ children, onPress, style }: any) {
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const onPressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
}


export default function WorkoutScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userPlan, setUserPlan] = useState('free');

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true); else setRefreshing(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) { router.replace('/auth' as any); return; }
      setAuthToken(token);
      const res = await getUserProfile();
      setUserPlan(res.data?.subscriptionPlan || 'free');
    } catch (e) {
      console.warn('WorkoutScreen load error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load data once on mount — no auto-refresh
  useEffect(() => { load(false); }, []);

  if (loading) return <WorkoutSkeleton />;

  // ── AI lock status ──
  const isAILocked = userPlan === 'free';

  const handleCardPress = (cardKey: string) => {
    if (cardKey === 'ai' && isAILocked) {
      router.push('/upgrade' as any);
      return;
    }
    router.push(`/workout-bodyparts?workoutType=${cardKey}&userPlan=${userPlan}` as any);
  };

  const renderGridCard = (card: typeof GRID_CARDS[0]) => (
    <PressableCard key={card.key} onPress={() => handleCardPress(card.key)} style={{ flex: 1 }}>
      <View style={{
        borderRadius: 22, borderWidth: 1, borderColor: C.cardBorder,
        backgroundColor: C.card, padding: 18, minHeight: 200,
        justifyContent: 'space-between', overflow: 'hidden',
      }}>
        {/* Subtle corner glow */}
        <View style={{ position: 'absolute', top: -24, right: -24, width: 72, height: 72, borderRadius: 36, backgroundColor: card.accentBg }} />

        {/* Icon */}
        <View style={{
          width: 48, height: 48, borderRadius: 14, backgroundColor: card.accentBg,
          justifyContent: 'center', alignItems: 'center',
        }}>
          <Image source={card.icon} style={{ width: card.iconSize, height: card.iconSize }} resizeMode="contain" />
        </View>

        {/* Content */}
        <View style={{ marginTop: 20 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: C.white, letterSpacing: -0.2 }}>{card.title}</Text>
          <Text style={{ fontSize: 11, color: C.label, marginTop: 4, lineHeight: 15 }}>{card.subtitle}</Text>
        </View>

        {/* Bottom */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
          backgroundColor: card.accentBg, borderRadius: 10,
          paddingHorizontal: 10, paddingVertical: 5, marginTop: 16,
        }}>
          <Text style={{ fontSize: 10, color: card.accentColor, fontWeight: '600' }}>{card.difficulty}</Text>
          <Ionicons name="chevron-forward" size={10} color={card.accentColor} style={{ marginLeft: 5 }} />
        </View>
      </View>
    </PressableCard>
  );

  const renderAICard = () => {
    const card = AI_CARD;
    return (
      <PressableCard key={card.key} onPress={() => handleCardPress(card.key)} style={{ marginTop: 14 }}>
        <LinearGradient
          colors={['rgba(100,231,241,0.18)', 'rgba(106,13,173,0.18)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 23, padding: 1 }}
        >
          <View style={{
            borderRadius: 22, backgroundColor: C.card, padding: 20,
            flexDirection: 'row', alignItems: 'center',
          }}>
            {/* Icon */}
            <View style={{
              width: 52, height: 52, borderRadius: 14, backgroundColor: card.accentBg,
              justifyContent: 'center', alignItems: 'center', marginRight: 16,
            }}>
              <Image source={card.icon} style={{ width: card.iconSize, height: card.iconSize, tintColor: '#fff' }} resizeMode="contain" />
            </View>

            {/* Text */}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: C.white }}>{card.title}</Text>
                <Ionicons name="sparkles" size={14} color="#FFD700" style={{ marginLeft: 6 }} />
              </View>
              <Text style={{ fontSize: 12, color: C.label, marginTop: 3 }}>{card.subtitle}</Text>

              {/* Status badge */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: isAILocked ? 'rgba(255,107,107,0.12)' : 'rgba(255,215,0,0.12)',
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
                }}>
                  <Ionicons name={isAILocked ? 'lock-closed' : 'shield-checkmark'} size={10} color={isAILocked ? '#FF6B6B' : '#FFD700'} />
                  <Text style={{ fontSize: 10, fontWeight: '700', color: isAILocked ? '#FF6B6B' : '#FFD700', marginLeft: 4 }}>
                    {isAILocked ? 'PRO REQUIRED' : 'UNLOCKED'}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>{card.count} {card.countLabel}</Text>
              </View>
            </View>

            {/* Arrow */}
            <View style={{
              width: 36, height: 36, borderRadius: 18, backgroundColor: card.accentBg,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Ionicons name="arrow-forward" size={16} color={card.accentColor} />
            </View>
          </View>
        </LinearGradient>
      </PressableCard>
    );
  };

  return (
    <SwipeableTabView>
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Ambient glow */}
      <View
        style={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: 300,
          height: 300,
          borderRadius: 150,
          backgroundColor: C.accentGlow,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: -60,
          left: -60,
          width: 200,
          height: 200,
          borderRadius: 100,
          backgroundColor: 'rgba(106,13,173,0.03)',
        }}
      />

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={C.accent}
              colors={[C.accent]}
              progressBackgroundColor={C.card}
            />
          }
        >
          {/* ═══ HEADER ═══ */}
          <View style={{ paddingTop: 8, paddingBottom: 8 }}>
            <Text style={{ fontSize: 28, fontWeight: '800', color: C.white, letterSpacing: -0.5 }}>
              Workout
            </Text>
            <Text style={{ fontSize: 14, color: C.label, marginTop: 4 }}>
              Choose your training mode
            </Text>
          </View>

          {/* ═══ SUBSCRIPTION BADGE ═══ */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 24 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 20,
                backgroundColor:
                  userPlan === 'pro_plus'
                    ? 'rgba(255,127,0,0.12)'
                    : userPlan === 'pro'
                    ? 'rgba(106,13,173,0.12)'
                    : 'rgba(255,255,255,0.06)',
              }}
            >
              <Ionicons
                name={userPlan === 'free' ? 'shield-outline' : 'shield-checkmark'}
                size={14}
                color={
                  userPlan === 'pro_plus'
                    ? '#FF7F00'
                    : userPlan === 'pro'
                    ? C.purple
                    : C.muted
                }
              />
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  color:
                    userPlan === 'pro_plus'
                      ? '#FF7F00'
                      : userPlan === 'pro'
                      ? C.purple
                      : C.muted,
                  marginLeft: 6,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                }}
              >
                {userPlan === 'pro_plus' ? 'Pro Plus' : userPlan === 'pro' ? 'Pro' : 'Free Plan'}
              </Text>
            </View>

            {userPlan === 'free' && (
              <TouchableOpacity
                onPress={() => router.push('/upgrade' as any)}
                activeOpacity={0.7}
                style={{ marginLeft: 10 }}
              >
                <LinearGradient
                  colors={[C.purple, '#9B59B6']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                    borderRadius: 20,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>
                    Upgrade
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>

          {/* ═══ HERO MOTIVATION ═══ */}
          <LinearGradient
            colors={['rgba(31,164,99,0.14)', 'rgba(31,164,99,0.02)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 18, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(31,164,99,0.10)' }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: 'rgba(31,164,99,0.18)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                <Ionicons name="flame" size={22} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: C.white }}>Ready to train?</Text>
                <Text style={{ fontSize: 11, color: C.label, marginTop: 2, lineHeight: 16 }}>Consistency beats intensity. Pick a workout and show up.</Text>
              </View>
            </View>
          </LinearGradient>

          {/* ═══ QUICK STATS ═══ */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
            {[
              { icon: 'barbell-outline', value: '60+', label: 'Exercises', color: C.accent },
              { icon: 'layers-outline', value: '3', label: 'Modes', color: C.purple },
              { icon: 'trending-up-outline', value: 'All', label: 'Levels', color: '#FFB74D' },
            ].map((s) => (
              <View key={s.label} style={{
                flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder,
                paddingVertical: 12, alignItems: 'center',
              }}>
                <Ionicons name={s.icon as any} size={16} color={s.color} />
                <Text style={{ fontSize: 16, fontWeight: '800', color: C.white, marginTop: 4 }}>{s.value}</Text>
                <Text style={{ fontSize: 9, color: C.muted, marginTop: 1, fontWeight: '500' }}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* ═══ GRID CARDS ═══ */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {GRID_CARDS.map((card) => renderGridCard(card))}
          </View>

          {/* ═══ AI CARD ═══ */}
          {renderAICard()}

          {/* ═══ FEATURES ═══ */}
          <View style={{ marginTop: 18 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.muted, marginBottom: 10, letterSpacing: 0.8 }}>WHAT YOU GET</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                { icon: 'videocam-outline', label: 'Video Guides', color: '#42A5F5' },
                { icon: 'timer-outline', label: 'Rest Timer', color: '#FFB74D' },
              ].map((f) => (
                <View key={f.label} style={{
                  flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder,
                  padding: 14, flexDirection: 'row', alignItems: 'center',
                }}>
                  <Ionicons name={f.icon as any} size={18} color={f.color} />
                  <Text style={{ fontSize: 12, color: C.white, fontWeight: '600', marginLeft: 8 }}>{f.label}</Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              {[
                { icon: 'analytics-outline', label: 'Track Progress', color: C.accent },
                { icon: 'body-outline', label: 'All Muscles', color: '#EC407A' },
              ].map((f) => (
                <View key={f.label} style={{
                  flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder,
                  padding: 14, flexDirection: 'row', alignItems: 'center',
                }}>
                  <Ionicons name={f.icon as any} size={18} color={f.color} />
                  <Text style={{ fontSize: 12, color: C.white, fontWeight: '600', marginLeft: 8 }}>{f.label}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ═══ BOTTOM TIP ═══ */}
          {userPlan === 'free' && (
            <TouchableOpacity onPress={() => router.push('/upgrade' as any)} activeOpacity={0.7} style={{ marginTop: 14 }}>
              <LinearGradient
                colors={['rgba(106,13,173,0.12)', 'rgba(155,89,182,0.06)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(106,13,173,0.15)', flexDirection: 'row', alignItems: 'center' }}
              >
                <Ionicons name="diamond-outline" size={16} color={C.purple} />
                <Text style={{ fontSize: 12, color: C.label, marginLeft: 10, flex: 1 }}>Unlock premium workouts & AI training</Text>
                <Ionicons name="chevron-forward" size={14} color={C.muted} />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
    </SwipeableTabView>
  );
}
