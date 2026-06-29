import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, Image, Alert, InteractionManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { getUserProfile, getCaloriesToday, getFeatures, setAuthToken, getUnreadNotificationCount, updateStreak, getMonthlyStreak } from '../../services/api';
import { useFitness } from '../../hooks/useFitness';
import { HomeSkeleton } from '../../components/SkeletonScreens';
import NutritionStreak from '../../components/NutritionStreak';
import { TAB_BAR_HEIGHT } from '../../components/GlassTabBar';

const C = {
  bg: '#060D09', card: 'rgba(25,25,25,1)', cardBorder: 'rgba(29,36,31,0.18)', accent: '#1FA463',
  accentGlow: 'rgba(31,164,99,0.06)', gold: '#C8A84E', purple: '#6A0DAD',
  white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)', burn: '#FF6B6B',
};

// VIBGYOR gradient colors for pro_plus avatar
const VIBGYOR: [string, string, ...string[]] = ['#8B00FF', '#4B0082', '#0000FF', '#00FF00', '#FFFF00', '#FF7F00', '#FF0000'];

function getAvatarBorderStyle(plan: string) {
  if (plan === 'pro') return { borderColor: '#6A0DAD', shadowColor: '#6A0DAD', shadowOpacity: 0.4, shadowRadius: 12 };
  if (plan === 'pro_plus') return { borderColor: '#FF0000', shadowColor: '#FFD700', shadowOpacity: 0.5, shadowRadius: 14 };
  return { borderColor: 'rgba(180,180,180,0.3)', shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0 };
}

const TOOLS = [
  { key: 'BMI', label: 'BMI Calc', image: require('../../assets/icons/profile/bmi.png'), color: '#f20622ff', route: '/bmi-calculator' },
  { key: 'CALORIES', label: 'Calories Calc', image: require('../../assets/icons/calories/food.png'), color: '#00E676', route: '/calories-calculator' },
  { key: 'BMB', label: 'BMB', image: require('../../assets/icons/calories/foodcircle.png'), color: '#60A5FA', route: '/bmb-calculator' },
  { key: 'AI_DIET', label: 'AI Diet', image: require('../../assets/icons/profile/AiDiet.png'), color: 'rgb(56, 61, 63)', route: '/ai-diet' },
  { key: 'WWP', label: 'Workout', icon: 'barbell-outline' as const, color: '#e80cbfff', route: '/workout-plan' },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── ACHIEVEMENT / AWARD DEFINITIONS (Apple Fitness-style) ───
// Each badge unlocks when `progress(stats) >= target`. Progress is shown
// on locked badges so users see how close they are.
type BadgeStats = {
  steps: number;
  distanceKm: number;
  caloriesBurned: number;
  consumed: number;
  currentStreak: number;
  longestStreak: number;
};

type Badge = {
  key: string;
  label: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  colors: [string, string];
  target: number;
  value: (s: BadgeStats) => number;
  unit?: string;
};

const BADGES: Badge[] = [
  { key: 'first_steps', label: 'First Steps', desc: 'Walk 1,000 steps', icon: 'walk', colors: ['#34D399', '#1FA463'], target: 1000, value: (s) => s.steps, unit: 'steps' },
  { key: 'step_master', label: 'Step Master', desc: 'Hit 10,000 steps', icon: 'footsteps', colors: ['#60A5FA', '#2563EB'], target: 10000, value: (s) => s.steps, unit: 'steps' },
  { key: 'calorie_burner', label: 'Calorie Burn', desc: 'Burn 500 kcal', icon: 'flame', colors: ['#FF8A65', '#FF5252'], target: 500, value: (s) => s.caloriesBurned, unit: 'kcal' },
  { key: 'distance_5k', label: '5K Club', desc: 'Cover 5 km', icon: 'trail-sign', colors: ['#A78BFA', '#7C3AED'], target: 5, value: (s) => s.distanceKm, unit: 'km' },
  { key: 'streak_3', label: 'On a Roll', desc: '3-day streak', icon: 'bonfire', colors: ['#FBBF24', '#F59E0B'], target: 3, value: (s) => s.currentStreak, unit: 'days' },
  { key: 'streak_7', label: 'Week Warrior', desc: '7-day streak', icon: 'ribbon', colors: ['#F472B6', '#DB2777'], target: 7, value: (s) => s.longestStreak, unit: 'days' },
  { key: 'streak_30', label: 'Unstoppable', desc: '30-day streak', icon: 'trophy', colors: ['#FFD700', '#C8A84E'], target: 30, value: (s) => s.longestStreak, unit: 'days' },
];

function AwardBadge({ badge, stats }: { badge: Badge; stats: BadgeStats }) {
  const current = badge.value(stats);
  const unlocked = current >= badge.target;
  const pct = Math.min((current / badge.target) * 100, 100);

  return (
    <View style={{ alignItems: 'center', width: 92, marginRight: 12 }}>
      <View style={{ width: 76, height: 76, borderRadius: 38, justifyContent: 'center', alignItems: 'center' }}>
        {unlocked ? (
          <LinearGradient colors={badge.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ width: 76, height: 76, borderRadius: 38, justifyContent: 'center', alignItems: 'center', shadowColor: badge.colors[0], shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 }}>
            <Ionicons name={badge.icon} size={32} color="#fff" />
          </LinearGradient>
        ) : (
          <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name={badge.icon} size={30} color="rgba(255,255,255,0.22)" />
            {/* progress ring text */}
            <View style={{ position: 'absolute', bottom: -2, right: -2, backgroundColor: '#0E140F', borderRadius: 9, paddingHorizontal: 5, paddingVertical: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 8, fontWeight: '800' }}>{Math.floor(pct)}%</Text>
            </View>
          </View>
        )}
      </View>
      <Text style={{ color: unlocked ? '#F0F0F0' : 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '700', marginTop: 8, textAlign: 'center' }} numberOfLines={1}>{badge.label}</Text>
      <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, marginTop: 1, textAlign: 'center' }} numberOfLines={1}>
        {unlocked ? 'Earned' : `${Math.round(current).toLocaleString()}/${badge.target.toLocaleString()}`}
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [daily, setDaily] = useState<any>(null);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [subPlan, setSubPlan] = useState('free');
  const [unread, setUnread] = useState(0);
  const [streak, setStreak] = useState({ current: 0, longest: 0 });

  // ── HealthKit-backed fitness data (steps + burn) ──
  const fitness = useFitness();

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true); else setRefreshing(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) { router.replace('/auth' as any); return; }
      setAuthToken(token);
      const [p, t, f, n] = await Promise.all([
        getUserProfile().catch(() => ({ data: null })),
        getCaloriesToday().catch(() => ({ data: null })),
        getFeatures().catch(() => ({ data: { subscriptionPlan: 'free', allowedFeatures: ['BMI', 'CALORIES', 'WWP'] } })),
        getUnreadNotificationCount().catch(() => ({ data: { count: 0 } })),
      ]);
      setUser(p.data);
      setDaily(t.data);
      setAllowed(f.data?.allowedFeatures || ['BMI', 'CALORIES', 'WWP']);
      setSubPlan(f.data?.subscriptionPlan || 'free');
      setUnread(Number(n.data?.count || 0));
      // Also trigger a fitness refresh so steps/burn stay in sync
      fitness.refresh();
      // Sync today's streak so the heatmap shows fresh calorie/protein data
      const waterKey = `water_${new Date().toISOString().slice(0, 10)}`;
      const currentWater = await AsyncStorage.getItem(waterKey);
      updateStreak({ water: Number(currentWater || 0) }).catch(() => {});
      // Fetch streak stats for the Awards section
      const month = new Date().toISOString().slice(0, 7);
      getMonthlyStreak(month)
        .then((s) => setStreak({ current: Number(s.data?.currentStreak || 0), longest: Number(s.data?.longestStreak || 0) }))
        .catch(() => {});
    } catch (e) { console.warn('Home error', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  // Load data once on mount — no auto-refresh, no polling
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      load(false);
    });
    return () => task.cancel();
  }, []);

  if (loading) return <HomeSkeleton />;

  const consumed = Number(daily?.consumedCalories || 0);
  const target = Number(user?.goalCalories || user?.maintenanceCalories || daily?.targetCalories || 2000);
  const userName = user?.name || 'User';
  const badgeStats: BadgeStats = {
    steps: Number(fitness.steps || 0),
    distanceKm: Number(fitness.distanceKm || 0),
    caloriesBurned: Number(fitness.caloriesBurned || 0),
    consumed,
    currentStreak: streak.current,
    longestStreak: streak.longest,
  };
  const earnedCount = BADGES.filter((b) => b.value(badgeStats) >= b.target).length;
  const fl = userName.charAt(0).toUpperCase();
  const isFree = subPlan === 'free';

  const handleTool = (t: typeof TOOLS[0]) => {
    if (!allowed.includes(t.key)) {
      Alert.alert('Upgrade Required', `"${t.label}" requires Pro. Upgrade to unlock!`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Upgrade', onPress: () => router.push('/upgrade' as any) },
      ]);
      return;
    }
    router.push(t.route as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ position: 'absolute', top: -80, right: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: C.accentGlow }} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 20 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.card} />}>

          {/* ═══ HEADER ═══ */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 16 }}>
            {/* Avatar with subscription-based border */}
            {user?.subscriptionPlan === 'pro_plus' ? (
              <TouchableOpacity onPress={() => router.push('/(tabs)/profile' as any)} activeOpacity={0.7}>
                <LinearGradient
                  colors={VIBGYOR}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
                    {user?.avatar ? <Image source={{ uri: user.avatar }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                      : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: C.accent }}>{fl}</Text></View>}
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => router.push('/(tabs)/profile' as any)} activeOpacity={0.7}
                style={{ width: 46, height: 46, borderRadius: 23, borderWidth: 2, ...getAvatarBorderStyle(user?.subscriptionPlan || 'free'), justifyContent: 'center', alignItems: 'center', shadowOffset: { width: 0, height: 0 }, elevation: 3 }}>
                {user?.avatar ? <Image source={{ uri: user.avatar }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                  : <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: 18, fontWeight: '700', color: C.accent }}>{fl}</Text></View>}
              </TouchableOpacity>
            )}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontSize: 12, color: C.label }}>{getGreeting()}</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', color: C.white, letterSpacing: -0.3 }}>{userName}</Text>
            </View>
            {/* Search icon → navigates to SearchScreen */}
            <TouchableOpacity onPress={() => router.push('/search' as any)} activeOpacity={0.7}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
              <Ionicons name="search-outline" size={18} color={C.white} />
            </TouchableOpacity>
            {/* Notification icon */}
            <TouchableOpacity activeOpacity={0.7}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="notifications-outline" size={18} color={C.white} />
              {unread > 0 && (
                <View style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#FF4D4D', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{unread > 9 ? '9+' : unread}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {/* ═══ UPGRADE BANNER — only for FREE ═══ */}
          {isFree && (
            <TouchableOpacity activeOpacity={0.8} onPress={() => router.push('/upgrade' as any)} style={{ borderRadius: 18, overflow: 'hidden', marginBottom: 20 }}>
              <LinearGradient colors={['rgba(106,13,173,0.18)', 'rgba(200,168,78,0.12)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ padding: 18, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(106,13,173,0.2)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(106,13,173,0.15)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                    <Ionicons name="sparkles" size={20} color={C.purple} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: C.white }}>Unlock AI Power</Text>
                    <Text style={{ fontSize: 11, color: C.label, marginTop: 2 }}>Get personalized diet & workout plans</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.muted} />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* ═══ TOOLS ═══ */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }}>Tools</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 22 }}>
            {TOOLS.map((tool) => {
              const locked = !allowed.includes(tool.key);
              return (
                <TouchableOpacity key={tool.key} activeOpacity={0.7} onPress={() => handleTool(tool)}
                  style={{ alignItems: 'center', opacity: locked ? 0.4 : 1, width: 72 }}>
                  <View style={{ width: 60, height: 60, borderRadius: 999, backgroundColor: C.card, borderWidth: 1.5, borderColor: locked ? C.cardBorder : `${tool.color}40`, justifyContent: 'center', alignItems: 'center' }}>
                    {tool.image ? (
                      <Image source={tool.image} style={{ width: 40, height: 40 }} resizeMode="contain" />
                    ) : (
                      <Ionicons name={tool.icon} size={30} color={locked ? C.muted : tool.color} />
                    )}
                    {locked && <View style={{ position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center' }}>
                      <Ionicons name="lock-closed" size={10} color={C.muted} /></View>}
                  </View>
                  <Text style={{ color: locked ? C.muted : C.white, fontSize: 11, fontWeight: '600', marginTop: 8, textAlign: 'center' }}>{tool.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ═══ TODAY'S SUMMARY ═══ */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>Today's Summary</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
            {[{ label: 'Consumed', value: `${Math.round(consumed)}`, sub: 'kcal', image: require('../../assets/icons/calories/food.png'), color: C.accent, route: null as string | null },
            { label: 'Burned', value: `${Math.round(fitness.caloriesBurned)}`, sub: 'kcal', image: require('../../assets/icons/calories/burn.png'), color: C.burn, route: '/analytics/calories' as string },
            { label: 'Steps', value: `${Math.round(fitness.steps).toLocaleString()}`, sub: `${fitness.distanceKm.toFixed(1)} km`, image: require('../../assets/icons/calories/steps.png'), color: '#60A5FA', route: '/analytics/steps' as string },
            ].map((item) => {
              const cardContent = (
                <>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: `${item.color}15`, justifyContent: 'center', alignItems: 'center', marginBottom: 10 }}>
                    <Image source={item.image} style={{ width: 40, height: 40 }} resizeMode="contain" />
                  </View>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: C.white }}>{item.value}</Text>
                  <Text style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{item.sub}</Text>
                  <Text style={{ fontSize: 9, color: C.label, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{item.label}</Text>
                </>
              );
              const cardStyle = { flex: 1, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 14, alignItems: 'center' as const };
              if (item.route) {
                return (
                  <TouchableOpacity key={item.label} activeOpacity={0.75} onPress={() => router.push(item.route as any)} style={cardStyle}>
                    {cardContent}
                  </TouchableOpacity>
                );
              }
              return (
                <View key={item.label} style={cardStyle}>
                  {cardContent}
                </View>
              );
            })}
          </View>

          {/* ═══ AWARDS — Apple Fitness-style achievement badges ═══ */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1, textTransform: 'uppercase' }}>Awards</Text>
            <Text style={{ fontSize: 11, color: C.accent, fontWeight: '700' }}>{earnedCount}/{BADGES.length} earned</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 22 }} contentContainerStyle={{ paddingRight: 8 }}>
            {BADGES.map((b) => (
              <AwardBadge key={b.key} badge={b} stats={badgeStats} />
            ))}
          </ScrollView>

          {/* ═══ MONTHLY NUTRITION STREAK ═══ */}
          <NutritionStreak />


          {/* ═══ QUICK ACTIONS ═══ */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>Quick Actions</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            {[{ label: 'Add Food', icon: 'add-circle-outline' as const, color: C.accent, onPress: () => router.push('/(tabs)/calories' as any) },
            { label: 'Scan', icon: 'scan-outline' as const, color: '#60A5FA', onPress: () => router.push('/scan' as any) },
            { label: 'Log Workout', icon: 'fitness-outline' as const, color: C.burn, onPress: () => router.push('/home-workout' as any) },
            ].map((a) => (
              <TouchableOpacity key={a.label} activeOpacity={0.7} onPress={a.onPress}
                style={{ flex: 1, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, paddingVertical: 18, alignItems: 'center' }}>
                <View style={{ width: 44, height: 44, borderRadius: 999, backgroundColor: `${a.color}15`, justifyContent: 'center', alignItems: 'center', marginBottom: 10 }}>
                  <Ionicons name={a.icon} size={22} color={a.color} /></View>
                <Text style={{ color: C.white, fontSize: 11, fontWeight: '600' }}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
