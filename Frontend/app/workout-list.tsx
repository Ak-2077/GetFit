import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Animated,
  Dimensions, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWorkoutsByType, setAuthToken } from '../services/api';
import { WorkoutListSkeleton } from '../components/SkeletonScreens';

const { width } = Dimensions.get('window');

// ── Design tokens (matching app-wide theme) ──
const C = {
  bg: '#060D09',
  card: 'rgba(20,22,24,0.92)',
  cardBorder: 'rgba(255,255,255,0.06)',
  accent: '#1FA463',
  accentSoft: 'rgba(31,164,99,0.08)',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.55)',
  muted: 'rgba(255,255,255,0.30)',
  purple: '#6A0DAD',
  gold: '#F59E0B',
  divider: 'rgba(255,255,255,0.04)',
};

const TABS = [
  { key: 'basic', label: 'Basic', planRequired: 'free' },
  { key: 'pro', label: 'Pro', planRequired: 'pro' },
  { key: 'pro_plus', label: 'Pro+', planRequired: 'pro_plus' },
];

const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, pro_plus: 2 };

const DIFFICULTY_META: Record<string, { color: string; label: string }> = {
  easy: { color: '#22C55E', label: 'Easy' },
  medium: { color: '#FBBF24', label: 'Med' },
  hard: { color: '#EF4444', label: 'Hard' },
};

const TYPE_TITLES: Record<string, string> = {
  home: 'Home Workouts',
  gym: 'Gym Workouts',
  ai: 'Kyro',
};

const BODY_PART_ICON: Record<string, string> = {
  abs: 'body-outline', chest: 'fitness-outline', legs: 'walk-outline',
  shoulders: 'accessibility-outline', arms: 'barbell-outline', back: 'body-outline',
  biceps: 'barbell-outline', triceps: 'barbell-outline', forearms: 'hand-left-outline',
  obliques: 'body-outline', quads: 'walk-outline', adductors: 'walk-outline',
  calves: 'walk-outline', lats: 'body-outline', traps: 'body-outline',
  glutes: 'walk-outline', hamstrings: 'walk-outline',
};

// ── Animated press wrapper ──
function PressableScale({ children, onPress, style, disabled }: any) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => {
    if (disabled) return;
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
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

  const tabIndicator = useRef(new Animated.Value(0)).current;

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true); else setRefreshing(true);
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);
      const bodyPartParam = typeof selectedBodyPart === 'string' && selectedBodyPart ? selectedBodyPart : undefined;
      const res = await (getWorkoutsByType as any)(String(workoutType), bodyPartParam);
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
  }, [workoutType, paramPlan, selectedBodyPart]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    const tabIndex = TABS.findIndex(t => t.key === activeTab);
    Animated.spring(tabIndicator, {
      toValue: tabIndex,
      useNativeDriver: true,
      speed: 14,
      bounciness: 2,
    }).start();
  }, [activeTab]);

  const diffBreakdown = useMemo(() => {
    const counts = { easy: 0, medium: 0, hard: 0 };
    allWorkouts.forEach((w: any) => { if (w.difficulty in counts) counts[w.difficulty as keyof typeof counts]++; });
    return counts;
  }, [allWorkouts]);

  if (loading) return <WorkoutListSkeleton />;
         
  const planRank = PLAN_RANK[currentPlan] ?? 0;
  const isTabLocked = (tabKey: string) => (PLAN_RANK[tabKey] ?? 0) > planRank;
  const isWorkoutLocked = (workout: any) => (PLAN_RANK[String(workout?.level || 'basic')] ?? 0) > planRank;

  const filteredWorkouts = allWorkouts.filter(w => w.level === activeTab);

  const normalizeBodyPart = (bp: string) => {
    const lower = bp.toLowerCase();
    if (lower === 'core') return 'abs';
    return lower;
  };

  const mapWorkoutToBodyPart = (w: any) => {
    if (!w) return '';
    if (w.bodyPart) return normalizeBodyPart(String(w.bodyPart));
    const name = String(w.name || '').toLowerCase();
    const biceps = ['preacher curl', 'bayesian curl', 'spider curl', 'drag curl', 'concentration curl', 'cross body hammer', 'reverse ez bar', 'machine preacher', 'bicep', 'biceps', 'dumbbell curl', 'ez bar curl', 'incline dumbbell curl', 'cable curl', 'hammer curl'];
    const triceps = ['skull crusher', 'tate press', 'jm press', 'ring tricep', 'tricep extension', 'tricep pushdown', 'close grip bench', 'weighted dips', 'single arm reverse pushdown', 'cable kickback', 'tricep', 'triceps', 'diamond push'];
    const forearms = ['wrist curl', 'wrist roller', 'plate pinch', 'dead hang', 'towel pull', 'lever bar', 'fat grip', 'forearm', 'farmer carry', 'farmer walk'];
    const obliques = ['oblique', 'landmine rotation', 'windshield wiper', 'wood chopper', 'side bend', 'russian twist', 'side plank hip', 'medicine ball twist', 'hanging oblique'];
    const quads = ['hack squat', 'sissy squat', 'front squat', 'pause front squat', 'smith machine squat', 'jump squat', 'goblet squat', 'wall sit', 'leg extension', 'pistol squat', 'quad', 'walking barbell lunge', 'deficit bulgarian'];
    const adductors = ['adductor', 'adduction', 'sumo', 'cossack', 'copenhagen', 'wide stance leg press', 'lateral lunge', 'sliding side lunge'];
    const calves = ['calf raise', 'calf burn', 'donkey calf', 'tibialis', 'calf hop', 'stair calf', 'jump rope calf', 'single leg box jump', 'calf'];
    const lats = ['lat pulldown', 'lat pull', 'pull-up', 'pull up', 'pullup', 'pulldown', 'muscle-up', 'archer pull', 'neutral grip pull', 'one arm lat', 'straight arm cable', 'close grip pull', 'resistance band pull', 'lat '];
    const traps = ['shrug', 'snatch grip', 'power shrug', 'rack pull shrug', 'incline shrug', 'trap bar', 'upright row', 'farmer'];
    const glutes = ['hip thrust', 'glute bridge', 'donkey kick', 'frog pump', 'curtsy lunge', 'deficit reverse lunge', 'glute', 'cable kickback'];
    const hamstrings = ['leg curl', 'nordic ham', 'glute ham raise', 'stiff leg', 'good morning', 'kettlebell swing', 'deficit romanian', 'hamstring', 'stability ball leg'];
    const abs = ['plank', 'crunch', 'situp', 'sit-up', 'sit up', 'leg raise', 'dragon flag', 'l-sit', 'core', 'mountain climber', 'abs', 'v-up', 'flutter', 'ab wheel', 'toes to bar', 'decline sit'];
    const shoulders = ['shoulder', 'overhead press', 'military press', 'viking', 'arnold', 'lateral raise', 'front raise', 'face pull'];
    const chest = ['bench', 'push-up', 'push up', 'pushup', 'fly', 'chest', 'incline press', 'decline press', 'dumbbell press', 'pec deck'];
    const back = ['row', 'pendlay', 'barbell row', 'cable row', 'seal row', 'meadows row', 'back ', 't-bar', 'rack pull', 'machine high row'];
    const arms = ['dip'];
    const legs = ['squat', 'lunge', 'leg press', 'deadlift', 'romanian deadlift'];
    const match = (keywords: string[]) => keywords.some(k => name.includes(k));
    if (match(biceps)) return 'biceps';
    if (match(triceps)) return 'triceps';
    if (match(forearms)) return 'forearms';
    if (match(obliques)) return 'obliques';
    if (match(calves)) return 'calves';
    if (match(adductors)) return 'adductors';
    if (match(glutes)) return 'glutes';
    if (match(hamstrings)) return 'hamstrings';
    if (match(quads)) return 'quads';
    if (match(lats)) return 'lats';
    if (match(traps)) return 'traps';
    if (match(abs)) return 'abs';
    if (match(shoulders)) return 'shoulders';
    if (match(chest)) return 'chest';
    if (match(back)) return 'back';
    if (match(arms)) return 'arms';
    if (match(legs)) return 'legs';
    return 'other';
  };

  const activeBodyFiltered = selectedBodyPart
    ? filteredWorkouts.filter((w) => mapWorkoutToBodyPart(w) === String(selectedBodyPart).toLowerCase())
    : filteredWorkouts;

  const tabWidth = (width - 52) / 3;
  const bodyPartDisplay = selectedBodyPart
    ? `${String(selectedBodyPart).charAt(0).toUpperCase()}${String(selectedBodyPart).slice(1)}`
    : 'Body';

  const availableCount = allWorkouts.filter((w) => !isWorkoutLocked(w)).length;
  const showLockedEmpty = isTabLocked(activeTab) && activeBodyFiltered.length === 0;

  // ── Exercise Card ──
  const renderExerciseCard = (workout: any, index: number, locked = false) => {
    const diff = DIFFICULTY_META[workout.difficulty] || DIFFICULTY_META.medium;

    return (
      <PressableScale
        key={locked ? `locked-${index}` : (workout._id || index)}
        disabled={false}
        onPress={() => {
          if (locked) { router.push('/upgrade' as any); return; }
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
        style={{ marginBottom: 8 }}
      >
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingVertical: 14, paddingLeft: 14, paddingRight: 16,
          backgroundColor: locked ? 'rgba(255,255,255,0.02)' : C.card,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: locked ? 'rgba(255,255,255,0.03)' : C.cardBorder,
          opacity: locked ? 0.45 : 1,
        }}>
          {/* Step number */}
          <View style={{
            width: 30, height: 30, borderRadius: 8,
            backgroundColor: locked ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.05)',
            justifyContent: 'center', alignItems: 'center', marginRight: 12,
          }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: locked ? C.muted : C.label }}>
              {index + 1}
            </Text>
          </View>

          {/* Info */}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: locked ? C.muted : C.white }} numberOfLines={1}>
              {workout.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="time-outline" size={11} color={C.muted} />
                <Text style={{ fontSize: 11, color: C.muted, marginLeft: 3 }}>{workout.duration}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: diff.color, marginRight: 4 }} />
                <Text style={{ fontSize: 10, fontWeight: '700', color: diff.color }}>{diff.label}</Text>
              </View>
            </View>
          </View>

          {/* Right icon */}
          {locked ? (
            <Ionicons name="lock-closed" size={14} color={C.purple} />
          ) : (
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.15)" />
          )}
        </View>
      </PressableScale>
    );
  };

  // ── Section header for subcategory ──
  const renderSectionHeader = (title: string) => (
    <View key={`section-${title}`} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 10 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, textTransform: 'uppercase', letterSpacing: 0.8 }}>
        {title}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.divider, marginLeft: 10 }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ═══ HEADER ═══ */}
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}
            >
              <Ionicons name="chevron-back" size={18} color={C.white} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white, letterSpacing: -0.5 }}>
                {selectedBodyPart ? bodyPartDisplay : (TYPE_TITLES[workoutType] || 'Workouts')}
              </Text>
              <Text style={{ fontSize: 11, color: C.label, marginTop: 2 }}>
                {availableCount} of {totalAvailable} unlocked
              </Text>
            </View>
            {/* Exercise count badge */}
            {selectedBodyPart && activeBodyFiltered.length > 0 && (
              <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.cardBorder }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: C.white }}>{activeBodyFiltered.length}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ═══ TIER TABS ═══ */}
        <View style={{ flexDirection: 'row', marginHorizontal: 20, marginBottom: 16, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 3, borderWidth: 1, borderColor: C.cardBorder }}>
          <Animated.View
            style={{
              position: 'absolute', top: 3, left: 3,
              width: tabWidth, height: 38, borderRadius: 11,
              backgroundColor: C.accent,
              transform: [{
                translateX: tabIndicator.interpolate({
                  inputRange: [0, 1, 2],
                  outputRange: [0, tabWidth, tabWidth * 2],
                }),
              }],
            }}
          />
          {TABS.map((tab) => {
            const locked = isTabLocked(tab.key);
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.8}
                onPress={() => setActiveTab(tab.key)}
                style={{ flex: 1, height: 38, borderRadius: 11, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 4 }}
              >
                {locked && <Ionicons name="lock-closed" size={9} color={isActive ? 'rgba(255,255,255,0.7)' : C.muted} />}
                <Text style={{ fontSize: 12, fontWeight: isActive ? '700' : '500', color: isActive ? '#fff' : locked ? C.muted : C.label }}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ═══ CONTENT ═══ */}
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 50 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.card} />
          }
        >
          {showLockedEmpty ? (
            // ── LOCKED EMPTY STATE ──
            <View style={{ alignItems: 'center', paddingTop: 70 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <Ionicons name="lock-closed" size={26} color={C.accent} />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.white, marginBottom: 4 }}>
                Subscribe to access
              </Text>
              <Text style={{ fontSize: 12, color: C.label, marginBottom: 18, textAlign: 'center', paddingHorizontal: 40 }}>
                Upgrade your plan to unlock {activeTab === 'pro' ? 'Pro' : 'Pro+'} exercises
              </Text>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => router.push('/upgrade' as any)}
                style={{ borderRadius: 10, backgroundColor: C.accent, paddingHorizontal: 22, paddingVertical: 10 }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Upgrade Plan</Text>
              </TouchableOpacity>
            </View>
          ) : activeBodyFiltered.length === 0 ? (
            // ── EMPTY STATE ──
            <View style={{ alignItems: 'center', paddingTop: 70 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                <Ionicons name="fitness-outline" size={28} color={C.accent} />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.white, marginBottom: 4 }}>No Exercises Yet</Text>
              <Text style={{ fontSize: 12, color: C.label, textAlign: 'center', paddingHorizontal: 40 }}>
                {selectedBodyPart ? `${bodyPartDisplay} exercises for this tier coming soon.` : 'Workouts for this selection coming soon.'}
              </Text>
            </View>
          ) : (
            // ── TIMELINE WORKOUT LIST ──
            <View>
              {/* Upgrade banner for locked tabs with content */}
              {isTabLocked(activeTab) && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => router.push('/upgrade' as any)}
                  style={{ marginBottom: 16, borderRadius: 14, overflow: 'hidden' }}
                >
                  <LinearGradient
                    colors={['rgba(106,13,173,0.12)', 'rgba(31,164,99,0.06)']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(106,13,173,0.15)', flexDirection: 'row', alignItems: 'center' }}
                  >
                    <Ionicons name="sparkles" size={16} color={C.purple} style={{ marginRight: 10 }} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: C.white, flex: 1 }}>
                      Upgrade to unlock this tier
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color={C.muted} />
                  </LinearGradient>
                </TouchableOpacity>
              )}

              {/* Exercise list */}
              {(() => {
                const grouped = activeBodyFiltered.reduce((acc: any, w: any) => {
                  const cat = w.subCategory || 'Other';
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push(w);
                  return acc;
                }, {});

                if (Object.keys(grouped).length === 0) return null;

                // If only "Other" group, render flat list
                if (Object.keys(grouped).length === 1 && grouped['Other']) {
                  return activeBodyFiltered.map((w: any, i: number) =>
                    renderExerciseCard(w, i, isWorkoutLocked(w))
                  );
                }

                // Sorted subcategory groups
                const ORDER = [
                  'Upper Chest', 'Middle Chest', 'Lower Chest', 'Isolation Exercises',
                  'Front Delts', 'Side Delts', 'Rear Delts',
                  'Long Head', 'Short Head', 'Brachialis',
                  'Lateral Head', 'Medial Head',
                  'Biceps', 'Triceps', 'Forearms',
                  'Upper Abs', 'Middle Abs', 'Lower Abs', 'Abs', 'Obliques',
                  'Quads', 'Adductors', 'Calves',
                  'Back', 'Lats', 'Traps',
                  'Glutes', 'Hamstrings',
                  'Other',
                ];
                const sortedKeys = Object.keys(grouped).sort((a, b) => {
                  let ai = ORDER.indexOf(a);
                  let bi = ORDER.indexOf(b);
                  if (ai === -1) ai = 99;
                  if (bi === -1) bi = 99;
                  return ai - bi;
                });

                return sortedKeys.map((cat) => {
                  const items = grouped[cat];
                  return (
                    <View key={cat}>
                      {cat !== 'Other' && renderSectionHeader(cat)}
                      {items.map((w: any, i: number) =>
                        renderExerciseCard(w, i, isWorkoutLocked(w))
                      )}
                    </View>
                  );
                });
              })()}

              {/* Unlock footer for free users */}
              {currentPlan === 'free' && !isTabLocked(activeTab) && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => router.push('/upgrade' as any)}
                  style={{ marginTop: 16 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: 'rgba(106,13,173,0.06)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(106,13,173,0.10)' }}>
                    <Ionicons name="diamond" size={16} color={C.purple} style={{ marginRight: 10 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: C.white }}>Unlock Pro & Pro+</Text>
                      <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>More exercises & deeper subcategories</Text>
                    </View>
                    <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: C.purple }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>Go</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}