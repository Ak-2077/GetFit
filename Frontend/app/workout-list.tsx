import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Animated,
  Easing, Dimensions, RefreshControl, Image,
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
  bg: '#050505',
  card: '#121212',
  cardBorder: 'rgba(255,255,255,0.06)',
  accent: '#0d0e0dff',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.50)',
  muted: 'rgba(255,255,255,0.30)',
  purple: '#6A0DAD',
};

const TABS = [
  { key: 'basic', label: 'Basic', planRequired: 'free' },
  { key: 'pro', label: 'Pro', planRequired: 'pro' },
  { key: 'pro_plus', label: 'Pro Plus', planRequired: 'pro_plus' },
];

const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, pro_plus: 2 };

const DIFFICULTY_COLORS: Record<string, { bg: string; text: string }> = {
  easy: { bg: 'rgba(34,197,94,0.12)', text: '#22C55E' },
  medium: { bg: 'rgba(251,191,36,0.12)', text: '#FBBF24' },
  hard: { bg: 'rgba(239,68,68,0.12)', text: '#EF4444' },
};

const TYPE_TITLES: Record<string, string> = {
  home: 'Home Workouts',
  gym: 'Gym Workouts',
  ai: 'AI Trainer',
};

// Body part image map for workout card thumbnails
const BODY_PART_IMAGES: Record<string, any> = {
  chest: require('../assets/icons/Homeworkout/chest.png'),
  legs: require('../assets/icons/Homeworkout/Legs.png'),
  shoulders: require('../assets/icons/Homeworkout/Shoulder.png'),
  arms: require('../assets/icons/Homeworkout/Arms.png'),
  back: require('../assets/icons/Homeworkout/back.png'),
  abs: require('../assets/icons/Homeworkout/abs.png'),
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

  // Get the image for the current body part
  const getWorkoutImage = (workout: any) => {
    const bp = selectedBodyPart ? String(selectedBodyPart).toLowerCase() : mapWorkoutToBodyPart(workout);
    return BODY_PART_IMAGES[bp] || BODY_PART_IMAGES.chest;
  };

  const renderWorkoutCard = (workout: any, index: number, locked = false) => {
    const diff = DIFFICULTY_COLORS[workout.difficulty] || DIFFICULTY_COLORS.medium;
    const workoutImage = getWorkoutImage(workout);

    if (locked) {
      return (
        <PressableScale
          key={`locked-${index}`}
          onPress={() => router.push('/upgrade' as any)}
          style={{ marginBottom: 12 }}
        >
          <View
            style={{
              borderRadius: 20,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.06)',
              overflow: 'hidden',
            }}
          >
            {/* Blurred card content */}
            <View style={{ padding: 18, backgroundColor: C.card, opacity: 0.3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    justifyContent: 'center',
                    alignItems: 'center',
                    marginRight: 14,
                  }}
                >
                  <Ionicons name="barbell-outline" size={22} color={C.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: C.muted }}>{workout.name}</Text>
                  <Text style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{workout.duration}</Text>
                </View>
              </View>
            </View>

            {/* Lock overlay */}
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'rgba(6,13,9,0.6)',
                borderRadius: 20,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <Ionicons name="lock-closed" size={18} color={C.muted} />
              </View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: C.label, textAlign: 'center' }}>
                Upgrade to access
              </Text>
            </View>
          </View>
        </PressableScale>
      );
    }

    return (
      <PressableScale key={workout._id || index} style={{ marginBottom: 10 }}>
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: C.cardBorder,
            backgroundColor: C.card,
            padding: 12,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          {/* Workout thumbnail */}
          <View style={{ width: 64, height: 64, borderRadius: 14, overflow: 'hidden', marginRight: 12 }}>
            <Image
              source={workoutImage}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          </View>

          {/* Details */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: C.white }} numberOfLines={1}>
              {workout.name}
            </Text>

            {/* Duration + difficulty */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
              <Ionicons name="time-outline" size={12} color={C.label} />
              <Text style={{ fontSize: 11, color: C.label, marginLeft: 3, marginRight: 8 }}>{workout.duration}</Text>
              <View
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 5,
                  backgroundColor: diff.bg,
                }}
              >
                <Text style={{ fontSize: 9, fontWeight: '800', color: diff.text, textTransform: 'uppercase' }}>
                  {workout.difficulty}
                </Text>
              </View>
            </View>
          </View>

          {/* Start button */}
          <TouchableOpacity
            activeOpacity={0.8}
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
            style={{ borderRadius: 10, overflow: 'hidden', marginLeft: 8 }}
          >
            <LinearGradient
              colors={[C.accent, '#178A52']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                paddingHorizontal: 18,
                paddingVertical: 8,
                borderRadius: 10,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>Start</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </PressableScale>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Ambient glow */}
      <View
        style={{
          position: 'absolute',
          top: -80,
          right: -80,
          width: 260,
          height: 260,
          borderRadius: 130,
          backgroundColor: 'rgba(31,164,99,0.04)',
        }}
      />

      <SafeAreaView style={{ flex: 1 }}>
        {/* ═══ HEADER ═══ */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.cardBorder,
              justifyContent: 'center',
              alignItems: 'center',
              marginRight: 14,
            }}
          >
            <Ionicons name="chevron-back" size={20} color={C.white} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: C.white }}>
              {selectedBodyPart ? `${bodyPartDisplay} Workouts` : (TYPE_TITLES[workoutType] || 'Workouts')}
            </Text>
            <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>
              {allWorkouts.length} of {totalAvailable} workouts available
            </Text>
          </View>
          {/* Filter icon */}
          <TouchableOpacity
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.cardBorder,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Ionicons name="options-outline" size={20} color={C.white} />
          </TouchableOpacity>
        </View>

        {/* ═══ TABS ═══ */}
        <View
          style={{
            flexDirection: 'row',
            marginHorizontal: 20,
            marginBottom: 20,
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderRadius: 16,
            padding: 4,
          }}
        >
          {/* Animated indicator */}
          <Animated.View
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              width: tabWidth,
              height: 40,
              borderRadius: 12,
              backgroundColor: C.accent,
              transform: [
                {
                  translateX: tabIndicator.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: [0, tabWidth, tabWidth * 2],
                  }),
                },
              ],
            }}
          />

          {TABS.map((tab) => {
            const locked = isTabLocked(tab.key);
            const isActive = activeTab === tab.key;

            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.8}
                onPress={() => {
                  if (!locked) setActiveTab(tab.key);
                }}
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: 12,
                  justifyContent: 'center',
                  alignItems: 'center',
                  flexDirection: 'row',
                  gap: 4,
                }}
              >
                {locked && <Ionicons name="lock-closed" size={11} color={C.muted} />}
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: isActive ? '700' : '500',
                    color: locked ? C.muted : isActive ? '#fff' : C.label,
                  }}
                >
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
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={C.accent}
              colors={[C.accent]}
              progressBackgroundColor={C.card}
            />
          }
        >

          {isTabLocked(activeTab) ? (
            // ── LOCKED STATE ──
            <View>
              {/* Upgrade banner */}
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => router.push('/upgrade' as any)}
                style={{ marginBottom: 20, borderRadius: 18, overflow: 'hidden' }}
              >
                <LinearGradient
                  colors={['rgba(106,13,173,0.18)', 'rgba(200,168,78,0.12)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    padding: 18,
                    borderRadius: 18,
                    borderWidth: 1,
                    borderColor: 'rgba(106,13,173,0.2)',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        backgroundColor: 'rgba(106,13,173,0.15)',
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginRight: 14,
                      }}
                    >
                      <Ionicons name="sparkles" size={20} color={C.purple} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: C.white }}>
                        Upgrade to Unlock
                      </Text>
                      <Text style={{ fontSize: 11, color: C.label, marginTop: 2 }}>
                        Upgrade to access this workout tier
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={C.muted} />
                  </View>
                </LinearGradient>
              </TouchableOpacity>

              {/* Locked placeholder cards */}
              {LOCKED_PLACEHOLDERS.map((w, i) => renderWorkoutCard(w, i, true))}
            </View>
          ) : activeBodyFiltered.length === 0 ? (
            // ── EMPTY STATE ──
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: 'rgba(31,164,99,0.08)',
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: 16,
                }}
              >
                <Ionicons name="fitness-outline" size={32} color={C.accent} />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.white, marginBottom: 6 }}>
                No workouts yet
              </Text>
              <Text style={{ fontSize: 13, color: C.label, textAlign: 'center' }}>
                Workouts for this selection are coming soon.
              </Text>
            </View>
          ) : (
            // ── WORKOUT LIST ──
            <View>
              {activeBodyFiltered.map((w: any, i: number) => renderWorkoutCard(w, i, false))}

              {/* ═══ UNLOCK PRO FOOTER (for free users) ═══ */}
              {currentPlan === 'free' && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: C.card,
                    borderRadius: 16,
                    padding: 16,
                    marginTop: 8,
                    borderWidth: 1,
                    borderColor: C.cardBorder,
                  }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                    <Ionicons name="lock-closed" size={16} color={C.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: C.white }}>Unlock Pro Workouts</Text>
                    <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Access advanced workouts & training plans.</Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => router.push('/upgrade' as any)}
                    style={{
                      borderRadius: 12,
                      borderWidth: 1.5,
                      borderColor: C.accent,
                      paddingHorizontal: 16,
                      paddingVertical: 8,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: C.accent }}>Upgrade</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
