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
const CARDS = [
  {
    key: 'home',
    title: 'Home Workout',
    subtitle: 'Train anywhere, anytime',
    icon: require('../../assets/icons/Home.png'),
    iconSize: 72,
    count: '30 workouts available',
    badgeColor: C.accent,
  },
  {
    key: 'gym',
    title: 'Gym',
    subtitle: 'Full equipment training',
    icon: require('../../assets/icons/Gym.png'),
    iconSize: 72,
    count: '30 workouts available',
    badgeColor: C.purple,
  },
  {
    key: 'ai',
    title: 'AI Trainer',
    subtitle: 'Personalized AI guidance',
    icon: require('../../assets/icons/ai.png'),
    iconTint: '#fff',
    iconSize: 44,
    count: '30 AI-powered programs',
    badgeColor: '#64e7f1',
    isAI: true,
  },
];

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

  const renderCard = (card: typeof CARDS[0], index: number) => {
    const isLocked = card.isAI && isAILocked;

    return (
      <PressableCard key={card.key} onPress={() => handleCardPress(card.key)} style={{ marginBottom: 16 }}>
        <View
          style={{
            borderRadius: 22,
            borderWidth: 1,
            borderColor: C.cardBorder,
            backgroundColor: C.card,
            flexDirection: 'row',
            alignItems: 'center',
            padding: 20,
          }}
        >
          {/* Icon */}
          <Image
            source={card.icon}
            style={[
              { width: card.iconSize ?? 44, height: card.iconSize ?? 44, marginRight: 16 },
              card.iconTint ? { tintColor: card.iconTint } : null,
            ]}
            resizeMode={card.iconSize && card.iconSize >= 60 ? 'cover' : 'contain'}
          />

          {/* Text content */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.white, marginBottom: 4 }}>
              {card.title}
            </Text>
            <Text style={{ fontSize: 13, color: C.label, marginBottom: 4 }}>{card.subtitle}</Text>
            <Text style={{ fontSize: 11, color: C.muted }}>{card.count}</Text>

            {/* AI status */}
            {card.isAI && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                <Ionicons
                  name={isLocked ? 'lock-closed' : 'sparkles'}
                  size={12}
                  color={isLocked ? '#FF6B6B' : '#FFD700'}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '700',
                    color: isLocked ? '#FF6B6B' : '#FFD700',
                    marginLeft: 4,
                  }}
                >
                  {isLocked ? 'Locked' : 'Unlocked'}
                </Text>
              </View>
            )}
          </View>

          {/* Chevron */}
          <Ionicons name="chevron-forward" size={20} color={C.muted} />
        </View>
      </PressableCard>
    );
  };

  return (
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

          {/* ═══ CARDS ═══ */}
          {CARDS.map((card, i) => renderCard(card, i))}

          {/* ═══ BOTTOM TIP ═══ */}
          <View
            style={{
              marginTop: 8,
              padding: 16,
              borderRadius: 16,
              backgroundColor: 'rgba(31,164,99,0.06)',
              borderWidth: 1,
              borderColor: 'rgba(31,164,99,0.08)',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="information-circle-outline" size={16} color={C.accent} />
              <Text style={{ fontSize: 12, color: C.label, marginLeft: 8, flex: 1 }}>
                Upgrade your plan to unlock premium workouts and AI-powered training programs.
              </Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
