import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Animated,
  Easing, Dimensions, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWorkoutsByType, setAuthToken } from '../services/api';
import { WorkoutListSkeleton } from '../components/SkeletonScreens';

const { width } = Dimensions.get('window');

// ── Design tokens ──
const C = {
  bg: '#000000',
  card: '#111111',
  cardAlt: '#161616',
  cardBorder: 'rgba(255,255,255,0.06)',
  accent: '#1FA463',
  accentDim: 'rgba(31,164,99,0.12)',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.50)',
  muted: 'rgba(255,255,255,0.30)',
  purple: '#8B5CF6',
  gold: '#F59E0B',
};

const TABS = [
  { key: 'basic', label: 'Basic', planRequired: 'free' },
  { key: 'pro', label: 'Pro', planRequired: 'pro' },
  { key: 'pro_plus', label: 'Pro+', planRequired: 'pro_plus' },
];

const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, pro_plus: 2 };

const DIFFICULTY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  easy: { bg: 'rgba(34,197,94,0.12)', text: '#22C55E', icon: 'flash' },
  medium: { bg: 'rgba(251,191,36,0.12)', text: '#FBBF24', icon: 'flame' },
  hard: { bg: 'rgba(239,68,68,0.12)', text: '#EF4444', icon: 'skull' },
};

const TYPE_TITLES: Record<string, string> = {
  home: 'Home Workouts',
  gym: 'Gym Workouts',
  ai: 'AI Trainer',
};

const BODY_PART_ICON: Record<string, string> = {
  abs: 'body-outline', chest: 'fitness-outline', legs: 'walk-outline',
  shoulders: 'accessibility-outline', arms: 'barbell-outline', back: 'body-outline',
};

const EXERCISE_ICONS: Record<string, string> = {
  plank: 'timer-outline', crunch: 'body-outline', 'sit-up': 'body-outline',
  situp: 'body-outline', 'sit up': 'body-outline', 'mountain climber': 'trending-up-outline',
  'superman': 'airplane-outline', squat: 'arrow-down-outline', lunge: 'walk-outline',
  'push-up': 'chevron-up-outline', pushup: 'chevron-up-outline',
  curl: 'barbell-outline', row: 'swap-horizontal-outline',
  'pull-up': 'arrow-up-outline', pullup: 'arrow-up-outline',
  deadlift: 'trending-up-outline', press: 'chevron-up-outline',
  dip: 'arrow-down-outline', fly: 'expand-outline',
};

// ── Animated press wrapper ──
function PressableScale({ children, onPress, style, disabled }: any) {
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    if (disabled) return;
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  };
  const onPressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  };

  return (
    <TouchableOpacity activeOpacity={1} onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} disabled={disabled}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

export default function WorkoutListScreen() {
  const router = useRouter();
  const { workoutType = 'home', userPlan: paramPlan = 'free', bodyPart: selectedBodyPart = '' } = useLocalSearchParams<{
    workoutType: string;
    userPlan: string;
    bodyPart?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [allWorkouts, setAllWorkouts] = useState<any[]>([]);
  const [currentPlan, setCurrentPlan] = useState(paramPlan);
  const [totalAvailable, setTotalAvailable] = useState(0);

  // Tab indicator animation
  const tabIndicator = useRef(new Animated.Value(0)).current;

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true); else setRefreshing(true);
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);

      const res = await getWorkoutsByType(workoutType);
      const data = res.data;
      setAllWorkouts(data?.workouts || []);
      setCurrentPlan(data?.userPlan || paramPlan);
      setTotalAvailable(data?.totalAvailable || 0);
    } catch (e) {
      console.warn('WorkoutList load error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workoutType, paramPlan]);

  useEffect(() => { load(false); }, [load]);

  // Animate tab indicator
  useEffect(() => {
    const tabIndex = TABS.findIndex(t => t.key === activeTab);
    Animated.spring(tabIndicator, {
      toValue: tabIndex,
      useNativeDriver: true,
      speed: 14,
      bounciness: 2,
    }).start();
  }, [activeTab]);

  // ── Stats for the hero section (must be before early return) ──
  const diffBreakdown = useMemo(() => {
    const counts = { easy: 0, medium: 0, hard: 0 };
    allWorkouts.forEach((w: any) => { if (w.difficulty in counts) counts[w.difficulty as keyof typeof counts]++; });
    return counts;
  }, [allWorkouts]);

  if (loading) return <WorkoutListSkeleton />;

  const planRank = PLAN_RANK[currentPlan] ?? 0;

  // Check if tab is accessible for current plan
  const isTabLocked = (tabKey: string) => {
    const required = PLAN_RANK[tabKey] ?? 0;
    return required > planRank;
  };


  // Get workouts for active tab
  const filteredWorkouts = allWorkouts.filter(w => w.level === activeTab);

  // Normalize body-part values so backend 'core' matches frontend 'abs'
  const normalizeBodyPart = (bp: string) => {
    const lower = bp.toLowerCase();
    if (lower === 'core') return 'abs';
    return lower;
  };

  // Map workout item to a canonical body part using name heuristics.
  const mapWorkoutToBodyPart = (w: any) => {
    if (!w) return '';
    // Prefer explicit field if present (normalize core→abs)
    if (w.bodyPart) return normalizeBodyPart(String(w.bodyPart));
    const name = String(w.name || '').toLowerCase();

    // NOTE: Order matters! More specific matches first to avoid overlaps.
    // e.g. 'leg raise' is abs, not legs; 'overhead press' is shoulders, not legs.
    const abs = ['plank', 'crunch', 'situp', 'sit-up', 'sit up', 'leg raise', 'dragon', 'l-sit', 'core', 'mountain climber', 'abs', 'v-up', 'flutter', 'russian twist'];
    const shoulders = ['shoulder', 'overhead press', 'military press', 'viking', 'arnold', 'lateral raise', 'front raise', 'face pull', 'shrug'];
    const chest = ['bench', 'push-up', 'push up', 'pushup', 'fly', 'chest', 'incline press', 'decline press', 'dumbbell press'];
    const back = ['row', 'pull-up', 'pullup', 'pull up', 'lat pulldown', 'pulldown', 'lat ', 'pendlay', 'barbell row', 'cable row', 'back '];
    const arms = ['curl', 'tricep', 'triceps', 'bicep', 'biceps', 'dip', 'dips', 'skull', 'hammer', 'preacher', 'concentration'];
    const legs = ['squat', 'lunge', 'leg press', 'leg extension', 'leg curl', 'deadlift', 'pistol', 'hack squat', 'calf', 'glute', 'hip thrust'];

    const match = (keywords: string[]) => keywords.some(k => name.includes(k));
    if (match(abs)) return 'abs';
    if (match(shoulders)) return 'shoulders';
    if (match(chest)) return 'chest';
    if (match(back)) return 'back';
    if (match(arms)) return 'arms';
    if (match(legs)) return 'legs';
    return 'other';
  };

  // If a bodyPart was selected upstream, filter client-side by heuristics or explicit field
  const activeBodyFiltered = selectedBodyPart
    ? filteredWorkouts.filter((w) => mapWorkoutToBodyPart(w) === String(selectedBodyPart).toLowerCase())
    : filteredWorkouts;

  // Placeholder data for locked tabs
  const LOCKED_PLACEHOLDERS = [
    { name: 'Premium Exercise 1', duration: '15 min', difficulty: 'medium' },
    { name: 'Premium Exercise 2', duration: '20 min', difficulty: 'hard' },
    { name: 'Premium Exercise 3', duration: '12 min', difficulty: 'medium' },
  ];

  const tabWidth = (width - 52) / 3;

  const bodyPartDisplay = selectedBodyPart
    ? `${String(selectedBodyPart).charAt(0).toUpperCase()}${String(selectedBodyPart).slice(1)}`
    : 'Body';

  // Get icon for a specific exercise by name matching
  const getExerciseIcon = (name: string) => {
    const lower = name.toLowerCase();
    for (const [key, icon] of Object.entries(EXERCISE_ICONS)) {
      if (lower.includes(key)) return icon;
    }
    return BODY_PART_ICON[String(selectedBodyPart).toLowerCase()] || 'barbell-outline';
  };

  const renderWorkoutCard = (workout: any, index: number, locked = false) => {
    const diff = DIFFICULTY_COLORS[workout.difficulty] || DIFFICULTY_COLORS.medium;
    const exIcon = getExerciseIcon(workout.name || '');

    if (locked) {
      return (
        <PressableScale key={`locked-${index}`} onPress={() => router.push('/upgrade' as any)} style={{ marginBottom: 10 }}>
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
            <View style={{ padding: 16, backgroundColor: C.card, opacity: 0.25, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                <Ionicons name="barbell-outline" size={20} color={C.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: C.muted }}>{workout.name}</Text>
                <Text style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{workout.duration}</Text>
              </View>
            </View>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 16 }}>
              <Ionicons name="lock-closed" size={20} color={C.purple} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: C.purple, marginTop: 4 }}>Upgrade to unlock</Text>
            </View>
          </View>
        </PressableScale>
      );
    }

    return (
      <PressableScale
        key={workout._id || index}
        style={{ marginBottom: 10 }}
        onPress={() => {
          router.push({
            pathname: '/workout-player',
            params: {
              workoutName: workout.name,
              workoutType: workoutType,
              workoutDuration: workout.duration,
              workoutDifficulty: workout.difficulty || 'medium',
              workoutId: workout._id || '',
              bodyPart: selectedBodyPart || undefined,
            },
          } as any);
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder }}>
          {/* Exercise icon with number */}
          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
            <Ionicons name={exIcon as any} size={22} color={C.accent} />
            <Text style={{ fontSize: 8, fontWeight: '800', color: C.muted, marginTop: 2 }}>#{index + 1}</Text>
          </View>

          {/* Details */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: C.white, letterSpacing: -0.2 }} numberOfLines={1}>
              {workout.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="time-outline" size={11} color={C.muted} />
                <Text style={{ fontSize: 11, color: C.muted, marginLeft: 3 }}>{workout.duration}</Text>
              </View>
              <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.15)' }} />
              <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: diff.bg }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: diff.text, textTransform: 'uppercase' }}>{workout.difficulty}</Text>
              </View>
            </View>
            {workout.description ? (
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }} numberOfLines={1}>{workout.description}</Text>
            ) : null}
          </View>

          {/* Chevron */}
          <Ionicons name="chevron-forward" size={18} color={C.muted} style={{ marginLeft: 8 }} />
        </View>
      </PressableScale>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ═══ HEADER ═══ */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}
          >
            <Ionicons name="chevron-back" size={20} color={C.white} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: C.white, letterSpacing: -0.3 }}>
              {selectedBodyPart ? `${bodyPartDisplay} Workouts` : (TYPE_TITLES[workoutType] || 'Workouts')}
            </Text>
            <Text style={{ fontSize: 11, color: C.label, marginTop: 2 }}>
              {activeBodyFiltered.length} exercises available
            </Text>
          </View>
        </View>

        {/* ═══ STATS HERO (when body part selected) ═══ */}
        {selectedBodyPart && activeBodyFiltered.length > 0 && (
          <View style={{ marginHorizontal: 20, marginBottom: 14, flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 12, alignItems: 'center' }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.accent }}>{activeBodyFiltered.length}</Text>
              <Text style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Exercises</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 12, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {diffBreakdown.easy > 0 && <Text style={{ fontSize: 12, fontWeight: '800', color: '#22C55E' }}>{diffBreakdown.easy}</Text>}
                {diffBreakdown.medium > 0 && <Text style={{ fontSize: 12, fontWeight: '800', color: '#FBBF24' }}>{diffBreakdown.medium}</Text>}
                {diffBreakdown.hard > 0 && <Text style={{ fontSize: 12, fontWeight: '800', color: '#EF4444' }}>{diffBreakdown.hard}</Text>}
              </View>
              <Text style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>By Difficulty</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 12, alignItems: 'center' }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.gold }}>{totalAvailable}</Text>
              <Text style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Total</Text>
            </View>
          </View>
        )}

        {/* ═══ TABS ═══ */}
        <View style={{ flexDirection: 'row', marginHorizontal: 20, marginBottom: 16, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 3 }}>
          <Animated.View
            style={{
              position: 'absolute', top: 3, left: 3, width: tabWidth, height: 38, borderRadius: 11, backgroundColor: C.accent,
              transform: [{ translateX: tabIndicator.interpolate({ inputRange: [0, 1, 2], outputRange: [0, tabWidth, tabWidth * 2] }) }],
            }}
          />
          {TABS.map((tab) => {
            const locked = isTabLocked(tab.key);
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key} activeOpacity={0.8}
                onPress={() => { if (!locked) setActiveTab(tab.key); }}
                style={{ flex: 1, height: 38, borderRadius: 11, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 4 }}
              >
                {locked && <Ionicons name="lock-closed" size={10} color={C.muted} />}
                <Text style={{ fontSize: 13, fontWeight: isActive ? '700' : '500', color: locked ? C.muted : isActive ? '#fff' : C.label }}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ═══ CONTENT ═══ */}
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.card} />
          }
        >

          {isTabLocked(activeTab) ? (
            // ── LOCKED STATE ──
            <View>
              <TouchableOpacity activeOpacity={0.8} onPress={() => router.push('/upgrade' as any)} style={{ marginBottom: 20, borderRadius: 18, overflow: 'hidden' }}>
                <LinearGradient
                  colors={['rgba(139,92,246,0.15)', 'rgba(245,158,11,0.08)']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ padding: 18, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(139,92,246,0.2)' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(139,92,246,0.15)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                      <Ionicons name="sparkles" size={20} color={C.purple} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: C.white }}>Upgrade to Unlock</Text>
                      <Text style={{ fontSize: 11, color: C.label, marginTop: 2 }}>Access {activeTab === 'pro' ? 'Pro' : 'Pro+'} tier workouts</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={C.purple} />
                  </View>
                </LinearGradient>
              </TouchableOpacity>
              {LOCKED_PLACEHOLDERS.map((w, i) => renderWorkoutCard(w, i, true))}
            </View>
          ) : activeBodyFiltered.length === 0 ? (
            // ── EMPTY STATE ──
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.accentDim, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <Ionicons name="fitness-outline" size={36} color={C.accent} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '800', color: C.white, marginBottom: 6 }}>No Exercises Yet</Text>
              <Text style={{ fontSize: 13, color: C.label, textAlign: 'center', paddingHorizontal: 40 }}>
                {selectedBodyPart ? `${bodyPartDisplay} exercises for this tier are coming soon.` : 'Workouts for this selection are coming soon.'}
              </Text>
            </View>
          ) : (
            // ── WORKOUT LIST ──
            <View>
              {activeBodyFiltered.map((w: any, i: number) => renderWorkoutCard(w, i, false))}

              {/* ═══ UNLOCK PRO FOOTER (for free users) ═══ */}
              {currentPlan === 'free' && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => router.push('/upgrade' as any)}
                  style={{ marginTop: 8 }}
                >
                  <LinearGradient
                    colors={['rgba(139,92,246,0.10)', 'rgba(31,164,99,0.08)']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={{ borderRadius: 18, padding: 16, borderWidth: 1, borderColor: 'rgba(139,92,246,0.15)', flexDirection: 'row', alignItems: 'center' }}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(139,92,246,0.12)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                      <Ionicons name="diamond" size={18} color={C.purple} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: C.white }}>Unlock Pro Workouts</Text>
                      <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Get advanced exercises & training plans</Text>
                    </View>
                    <View style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: C.purple }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>Upgrade</Text>
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
