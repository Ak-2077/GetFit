import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Modal,
  Alert,
  ImageSourcePropType,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop, Circle, Text as SvgText, Line } from 'react-native-svg';
import { getUserProfile, getWeeklyCalories, setAuthToken, updateUserProfile } from '../../services/api';

import { ProfileSkeleton } from '../../components/SkeletonScreens';

// ─── THEME ──────────────────────────────────────────────
const C = {
  bg: '#050505',
  card: 'rgba(25,25,25,1)',
  cardBorder: 'rgba(29, 36, 31, 0.18)',
  accent: '#1FA463',
  accentSoft: 'rgba(31,164,99,0.15)',
  gold: '#C8A84E',
  glow: '#A6F7C2',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.50)',
  muted: 'rgba(255,255,255,0.30)',
};

const SW = Dimensions.get('window').width;

// ─── HELPERS (PRESERVED) ────────────────────────────────
function getBmiCategory(bmi: number) {
  if (bmi < 18.5) return { label: 'Underweight', range: '< 18.5', color: '#60A5FA' };
  if (bmi < 25) return { label: 'Normal', range: '18.5 – 24.9', color: '#1FA463' };
  if (bmi < 30) return { label: 'Overweight', range: '25 – 29.9', color: '#f59e0b' };
  return { label: 'Obese', range: '≥ 30', color: '#ef4444' };
}

function formatSubscription(plan: string) {
  if (plan === 'pro') return 'AI Trainer Pro';
  if (plan === 'pro_plus') return 'AI Trainer Pro Plus';
  return 'Free Plan';
}

function getAvatarBorderStyle(plan: string) {
  if (plan === 'pro') return { borderColor: '#6A0DAD', shadowColor: '#6A0DAD', shadowOpacity: 0.4, shadowRadius: 12 };
  if (plan === 'pro_plus') return { borderColor: '#FF0000', shadowColor: '#FFD700', shadowOpacity: 0.5, shadowRadius: 14 };
  return { borderColor: 'rgba(180,180,180,0.3)', shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0 };
}

function getMemberBadge(plan: string): { label: string; colors: string[] } | null {
  if (plan === 'pro') return { label: 'Pro Member', colors: ['#6A0DAD', '#9B59B6'] };
  if (plan === 'pro_plus') return { label: 'Pro+ Elite', colors: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#8B00FF'] };
  return null;
}

// VIBGYOR gradient colors for pro_plus avatar
const VIBGYOR: [string, string, ...string[]] = ['#8B00FF', '#4B0082', '#0000FF', '#00FF00', '#FFFF00', '#FF7F00', '#FF0000'];

// ─── DARK CARD ──────────────────────────────────────────
function DarkCard({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <View style={{
      backgroundColor: C.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: C.cardBorder,
      ...style,
    }}>
      {children}
    </View>
  );
}

// ─── UNIFORM METRIC CARD (all 6 cards same size) ─────────────────
function UniformCard({ icon, iconSource, label, value, badge, badgeColor, onPress }: {
  icon?: string; iconSource?: ImageSourcePropType; label: string; value: string;
  badge?: string; badgeColor?: string; onPress?: () => void;
}) {
  const content = (
    <DarkCard style={{ flex: 1, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
      <View style={{
        width: 50, height: 50, borderRadius: 14,
        backgroundColor: 'transparent',
        justifyContent: 'center', alignItems: 'center',
      }}>
        {iconSource ? (
          <Image source={iconSource} style={{ width: 32, height: 32 }} resizeMode="contain" />
        ) : (
          <FontAwesome name={icon as any} size={18} color={C.accent} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 10, color: C.label, marginBottom: 2, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</Text>
        <Text
          style={{ fontSize: 15, fontWeight: '700', color: C.white }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >{value}</Text>
        {badge ? (
          <View style={{ backgroundColor: badgeColor ? `${badgeColor}20` : C.accentSoft, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start', marginTop: 3 }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: badgeColor || C.accent }}>{badge}</Text>
          </View>
        ) : null}
      </View>
      {onPress ? <FontAwesome name="pencil" size={10} color={C.muted} /> : null}
    </DarkCard>
  );
  if (onPress) {
    return <TouchableOpacity style={{ flex: 1 }} onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>;
  }
  return content;
}

// ─── INSIGHT CARD (compact snippet) ─────────────────────
function InsightCard({ goal, diff }: { goal: string; diff: number }) {
  const isGain = goal === 'gain';
  const isLose = goal === 'lose';
  const emoji = isGain ? '' : isLose ? '' : '';
  const insight = isGain
    ? `+${diff} kcal surplus for muscle gain`
    : isLose
    ? `${diff} kcal deficit for fat loss`
    : 'Balanced intake for maintenance';
  // return (
  //   <DarkCard style={{ flex: 1, padding: 14, justifyContent: 'center' }}>
  //     <Text style={{ fontSize: 18, marginBottom: 4 }}>{emoji}</Text>
  //     <Text style={{ fontSize: 11, color: C.label, marginBottom: 2 }}>Goal Insight</Text>
  //     <Text style={{ fontSize: 12, fontWeight: '600', color: C.accent, lineHeight: 16 }}>{insight}</Text>
  //   </DarkCard>
  // );
}

// ─── WEEKLY CHART (PRESERVED + RESTYLED) ────────────────
interface WeeklyDataPoint { day: string; calories: number; }
interface ChartProps { weeklyData: WeeklyDataPoint[]; goalCalories: number; bmi: number | null; loading: boolean; }

function WeeklyChart({ weeklyData, goalCalories, bmi, loading }: ChartProps) {
  const chartWidth = SW - 80;
  const chartHeight = 140;

  if (loading) {
    return (
      <View style={{ height: chartHeight + 50, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="small" color="#1FA463" />
        <Text style={{ fontSize: 12, color: C.label, marginTop: 8 }}>Loading chart…</Text>
      </View>
    );
  }

  const calorieValues = weeklyData.map(d => d.calories);
  const hasData = calorieValues.some(v => v > 0);

  if (!hasData) {
    return (
      <View style={{ height: chartHeight + 50, justifyContent: 'center', alignItems: 'center' }}>
        <FontAwesome name="bar-chart" size={28} color="rgba(255,255,255,0.08)" />
        <Text style={{ fontSize: 13, color: C.label, marginTop: 8 }}>No calorie data this week</Text>
        <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Log food to see your progress</Text>
      </View>
    );
  }

  const maxVal = Math.max(...calorieValues) * 1.15 || 100;
  const minVal = Math.min(...calorieValues.filter(v => v > 0)) * 0.7 || 0;
  const range = maxVal - minVal || 1;

  const points = calorieValues.map((val, i) => {
    const x = (i / (calorieValues.length - 1)) * chartWidth;
    const y = chartHeight - ((val - minVal) / range) * (chartHeight - 20) - 10;
    return { x, y: Math.max(5, Math.min(chartHeight - 5, y)) };
  });

  let linePath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const cp1x = points[i].x + (points[i + 1].x - points[i].x) / 3;
    const cp1y = points[i].y;
    const cp2x = points[i + 1].x - (points[i + 1].x - points[i].x) / 3;
    const cp2y = points[i + 1].y;
    linePath += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${points[i + 1].x} ${points[i + 1].y}`;
  }

  const areaPath = linePath +
    ` L ${points[points.length - 1].x} ${chartHeight} L ${points[0].x} ${chartHeight} Z`;

  const goalY = goalCalories > 0
    ? chartHeight - ((goalCalories - minVal) / range) * (chartHeight - 20) - 10
    : -1;

  return (
    <View>
      <Svg width={chartWidth} height={chartHeight + 30}>
        <Defs>
          <SvgGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#1FA463" stopOpacity="0.30" />
            <Stop offset="100%" stopColor="#1FA463" stopOpacity="0.01" />
          </SvgGradient>
          <SvgGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor="#1FA463" />
            <Stop offset="100%" stopColor="#A6F7C2" />
          </SvgGradient>
        </Defs>
        <Path d={areaPath} fill="url(#areaGrad)" />
        <Path d={linePath} stroke="url(#lineGrad)" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {goalY >= 0 && goalY <= chartHeight && (
          <Line x1={0} y1={goalY} x2={chartWidth} y2={goalY} stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="5,5" />
        )}
        {points.map((p, i) => (
          <React.Fragment key={i}>
            <Circle cx={p.x} cy={p.y} r={5} fill="rgba(31,164,99,0.20)" />
            <Circle cx={p.x} cy={p.y} r={3.5} fill="#191919" stroke="#1FA463" strokeWidth={2} />
          </React.Fragment>
        ))}
        {weeklyData.map((d, i) => {
          const x = (i / (weeklyData.length - 1)) * chartWidth;
          return (
            <SvgText key={d.day + i} x={x} y={chartHeight + 20} fontSize={11} fill="rgba(255,255,255,0.30)" textAnchor="middle" fontWeight="500">
              {d.day}
            </SvgText>
          );
        })}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent }} />
          <Text style={{ fontSize: 12, color: C.label }}>Goal: {goalCalories ? `${goalCalories} kcal` : '—'}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#60A5FA' }} />
          <Text style={{ fontSize: 12, color: C.label }}>BMI: {bmi ? bmi.toFixed(1) : '—'}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── MAIN COMPONENT (ALL BACKEND PRESERVED) ─────────────
export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [weeklyData, setWeeklyData] = useState<WeeklyDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [pickerModal, setPickerModal] = useState<{type:'level'|'diet',current:string}|null>(null);
  const [pickerSaving, setPickerSaving] = useState(false);

  const onPickerSelect = async (value: string) => {
    if (!pickerModal) return;
    setPickerSaving(true);
    try {
      const payload: any = {};
      if (pickerModal.type === 'level') payload.level = value;
      else payload.dietPreference = value;
      const res = await updateUserProfile(payload);
      setUser(res.data?.user || { ...user, ...payload });
      setPickerModal(null);
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.message || 'Failed to update'); }
    finally { setPickerSaving(false); }
  };

  const loadProfile = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) { router.replace('/auth' as any); return; }
      setAuthToken(token);
      const [profileRes, weeklyRes] = await Promise.all([
        getUserProfile(),
        getWeeklyCalories().catch(() => ({ data: { data: [] } })),
      ]);
      setUser(profileRes.data);
      setWeeklyData(weeklyRes.data?.data || []);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        await AsyncStorage.removeItem('token');
        setAuthToken(null);
        router.replace('/auth' as any);
        return;
      }
      console.warn('Failed to load profile', err?.response?.data || err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setChartLoading(false);
    }
  }, []);

  // Load data once on mount — no auto-refresh
  useEffect(() => {
    setLoading(true);
    setChartLoading(true);
    loadProfile(false);
  }, []);

  if (loading) return <ProfileSkeleton />;

  const bmi = user?.bmi || null;
  const bmiInfo = bmi ? getBmiCategory(bmi) : null;
  const mCal = user?.maintenanceCalories || 0;
  const gCal = user?.goalCalories || 0;
  const diff = gCal - mCal;
  const calProgress = mCal > 0 ? Math.min(gCal / Math.max(gCal, mCal), 1) : 0;
  const goalLabel = user?.goal === 'gain' ? 'Gain Weight' : user?.goal === 'lose' ? 'Lose Weight' : 'Maintain';
  const levelLabel = (l: string) => l === 'beginner' ? 'Beginner' : l === 'intermediate' ? 'Intermediate' : l === 'advanced' ? 'Advanced' : '—';
  const dietLabel = (d: string) => d === 'veg' ? 'Vegetarian' : d === 'non_veg' ? 'Non-Veg' : '—';
  const bodyTypeLabel = (b: string) => b === 'ectomorph' ? 'Ectomorph' : b === 'mesomorph' ? 'Mesomorph' : b === 'endomorph' ? 'Endomorph' : '—';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Subtle top-right radial glow */}
      <View style={{
        position: 'absolute', top: -60, right: -60,
        width: 280, height: 280, borderRadius: 140,
        backgroundColor: 'rgba(31,164,99,0.06)',
      }} />
      <View style={{
        position: 'absolute', top: -20, right: -20,
        width: 180, height: 180, borderRadius: 90,
        backgroundColor: 'rgba(31,164,99,0.04)',
      }} />

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadProfile(true)}
              tintColor={C.accent}
              colors={[C.accent]}
              progressBackgroundColor={C.card}
            />
          }
        >

          {/* ═══ HEADER ═══ */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, paddingBottom: 16 }}>
            <Text style={{ fontSize: 30, fontWeight: '800', color: C.white, letterSpacing: -0.5 }}>Profile</Text>
            <TouchableOpacity onPress={() => router.push('/auth/profile-settings' as any)} activeOpacity={0.7}
              style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder,
                justifyContent: 'center', alignItems: 'center',
              }}>
              <FontAwesome name="cog" size={16} color={C.label} />
            </TouchableOpacity>
          </View>

          {/* ═══ PROFILE CARD ═══ */}
          <DarkCard style={{ padding: 18, marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {/* Avatar with subscription-based border */}
              {user?.subscriptionPlan === 'pro_plus' ? (
                <LinearGradient
                  colors={VIBGYOR}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ width: 62, height: 62, borderRadius: 31, justifyContent: 'center', alignItems: 'center' }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' }}>
                    {user?.avatar ? (
                      <Image source={{ uri: user.avatar }} style={{ width: 50, height: 50, borderRadius: 25 }} />
                    ) : (
                      <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                        <Text style={{ fontSize: 22, fontWeight: '700', color: C.accent }}>{(user?.name || '?').charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                  </View>
                </LinearGradient>
              ) : (
                <View style={{
                  width: 58, height: 58, borderRadius: 29,
                  borderWidth: 2.5, ...getAvatarBorderStyle(user?.subscriptionPlan || 'free'),
                  justifyContent: 'center', alignItems: 'center',
                  shadowOffset: { width: 0, height: 0 }, elevation: 4,
                }}>
                  {user?.avatar ? (
                    <Image source={{ uri: user.avatar }} style={{ width: 50, height: 50, borderRadius: 25 }} />
                  ) : (
                    <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ fontSize: 22, fontWeight: '700', color: C.accent }}>{(user?.name || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                </View>
              )}
              {/* Name + badge */}
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ fontSize: 19, fontWeight: '700', color: C.white }}>{user?.name || '—'}</Text>
                <Text style={{ fontSize: 13, color: user?.email ? C.label : C.muted, marginTop: 2 }}>{user?.email || 'Email not set'}</Text>
                {getMemberBadge(user?.subscriptionPlan) && (
                  <LinearGradient
                    colors={getMemberBadge(user?.subscriptionPlan)!.colors.slice(0, 2) as [string, string, ...string[]]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, marginTop: 6 }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff' }}>{getMemberBadge(user?.subscriptionPlan)!.label}</Text>
                  </LinearGradient>
                )}
              </View>
              {/* Initial */}
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: C.muted }}>{(user?.name || '?').charAt(0).toUpperCase()}</Text>
              </View>
            </View>
          </DarkCard>

          {/* ═══ FITNESS OVERVIEW ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.label, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
            Fitness Overview
          </Text>

          {/* ROW 1: Goal + BMI */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <UniformCard iconSource={require('../../assets/icons/profile/Goal.png')} label="Fitness Goal" value={goalLabel} />
            <UniformCard iconSource={require('../../assets/icons/profile/bmi.png')} label="BMI" value={bmi ? bmi.toFixed(1) : '—'} badge={bmiInfo?.label} badgeColor={bmiInfo?.color} />
          </View>

          {/* ROW 2: Body Type + Weight */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <UniformCard iconSource={require('../../assets/icons/profile/bodytype.png')} label="Body Type" value={bodyTypeLabel(user?.bodyType || '')} />
            <UniformCard iconSource={require('../../assets/icons/profile/weight.png')} label="Weight" value={user?.weight ? `${user.weight} kg` : '—'} />
          </View>

          {/* ROW 3: Level + Diet */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            <UniformCard
              iconSource={require('../../assets/icons/profile/level.png')}
              label="Level"
              value={levelLabel(user?.level || '')}
              onPress={() => setPickerModal({ type: 'level', current: user?.level || '' })}
            />
            <UniformCard
              iconSource={require('../../assets/icons/profile/diet.png')}
              label="Diet"
              value={dietLabel(user?.dietPreference || '')}
              onPress={() => setPickerModal({ type: 'diet', current: user?.dietPreference || '' })}
            />
          </View>

          {/* Insight card (full-width) */}
      

          {/* ═══ DAILY CALORIES ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.label, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
            Daily Calories
          </Text>

          <DarkCard style={{ marginBottom: 24, overflow: 'hidden' }}>
            <LinearGradient
              colors={['rgba(57, 61, 59, 0.35)', 'rgba(25,25,25,1)']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ padding: 20, borderRadius: 18 }}
            >
              {/* Maintenance / Goal row */}
              <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ fontSize: 32, fontWeight: '800', color: C.white }}>{mCal || '—'}</Text>
                  <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>Maintenance</Text>
                </View>
                <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 8 }} />
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ fontSize: 32, fontWeight: '800', color: C.accent }}>{gCal || '—'}</Text>
                  <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>Goal ({goalLabel})</Text>
                </View>
              </View>

              {/* Progress bar
              <View style={{ height: 5, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, marginBottom: 12 }}>
                <LinearGradient colors={['#1FA463', '#A6F7C2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ height: 5, borderRadius: 3, width: `${Math.max(calProgress * 100, 5)}%` as any }} />
              </View> */}

              {/* Surplus / deficit */}
              <View style={{ alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: C.accent, fontWeight: '600' }}>
                  {diff > 0 ? `↑ ${diff} kcal surplus` : diff < 0 ? `↓ ${Math.abs(diff)} kcal deficit` : 'Balanced'}
                </Text>
              </View>
            </LinearGradient>
          </DarkCard>

          {/* ═══ WEEKLY ANALYSIS (PRESERVED) ═══ */}
          {/* <Text style={{ fontSize: 13, fontWeight: '700', color: C.label, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
            Weekly Analysis
          </Text>

          <DarkCard style={{ padding: 18, marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: C.white }}>Weekly Calories</Text>
              <View style={{ backgroundColor: C.accentSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: C.accent }}>This Week</Text>
              </View>
            </View>
            <WeeklyChart weeklyData={weeklyData} goalCalories={user?.goalCalories || 0} bmi={bmi} loading={chartLoading} />
          </DarkCard> */}

          {/* ═══ SUBSCRIPTION ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.label, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 12 }}>
            Subscription
          </Text>

          <DarkCard style={{ marginBottom: 14, overflow: 'hidden' }}>
            {user?.subscriptionPlan === 'pro_plus' ? (
              <LinearGradient colors={['rgba(139,0,255,0.12)', 'rgba(255,0,0,0.08)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 18, borderRadius: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <LinearGradient colors={VIBGYOR.slice(0, 3) as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                    <FontAwesome name="diamond" size={16} color="#fff" />
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: C.white }}>{formatSubscription(user?.subscriptionPlan)}</Text>
                    <Text style={{ fontSize: 11, color: C.label, marginTop: 2 }}>All features unlocked • Premium Elite</Text>
                  </View>
                </View>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' }} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#22C55E' }}>Active</Text>
                </View>
              </LinearGradient>
            ) : user?.subscriptionPlan === 'pro' ? (
              <LinearGradient colors={['rgba(106,13,173,0.15)', 'rgba(106,13,173,0.05)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 18, borderRadius: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(106,13,173,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                    <FontAwesome name="star" size={16} color="#9B59B6" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: C.white }}>{formatSubscription(user?.subscriptionPlan)}</Text>
                    <Text style={{ fontSize: 11, color: C.label, marginTop: 2 }}>All features unlocked</Text>
                  </View>
                </View>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' }} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#22C55E' }}>Active</Text>
                </View>
              </LinearGradient>
            ) : (
              <View style={{ padding: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(200,168,78,0.12)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                    <FontAwesome name="star" size={16} color={C.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: C.white }}>{formatSubscription(user?.subscriptionPlan)}</Text>
                    <Text style={{ fontSize: 11, color: C.label, marginTop: 2 }}>Basic features only</Text>
                  </View>
                </View>
              </View>
            )}
          </DarkCard>

          {user?.subscriptionPlan === 'free' && (
            <TouchableOpacity activeOpacity={0.85} onPress={() => router.push('/upgrade' as any)} style={{ marginBottom: 24, borderRadius: 14, overflow: 'hidden' }}>
              <LinearGradient colors={['#6A0DAD', '#9B59B6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{ height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 14 }}>
                <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 }}>🚀 Upgrade to AI Pro</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* ═══ INCOMPLETE PROFILE BANNER ═══ */}
          {user?.onboardingCompleted === false && (
            <TouchableOpacity
              style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: 16,
                padding: 16, marginBottom: 20,
                borderWidth: 1, borderColor: 'rgba(245,158,11,0.15)',
              }}
              onPress={() => router.push('/auth/onboarding' as any)}
              activeOpacity={0.8}
            >
              <View style={{
                width: 38, height: 38, borderRadius: 10,
                backgroundColor: 'rgba(245,158,11,0.12)',
                justifyContent: 'center', alignItems: 'center', marginRight: 14,
              }}>
                <FontAwesome name="exclamation-circle" size={18} color="#f59e0b" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#fbbf24' }}>Complete your profile</Text>
                <Text style={{ fontSize: 12, color: 'rgba(251,191,36,0.6)', marginTop: 2 }}>Tap to set up your fitness data</Text>
              </View>
              <FontAwesome name="chevron-right" size={13} color="#f59e0b" />
            </TouchableOpacity>
          )}

          <View style={{ height: 30 }} />
        </ScrollView>

        {/* FITNESS PICKER MODAL */}
        <Modal visible={!!pickerModal} animationType="slide" transparent onRequestClose={() => setPickerModal(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: 'rgba(25,25,25,1)', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: C.cardBorder }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ color: C.white, fontSize: 20, fontWeight: '700' }}>{pickerModal?.type === 'level' ? 'Training Level' : 'Diet Type'}</Text>
                <TouchableOpacity onPress={() => setPickerModal(null)}><FontAwesome name="times" size={20} color={C.label} /></TouchableOpacity>
              </View>
              {pickerSaving ? (
                <ActivityIndicator size="small" color="#1FA463" />
              ) : (
                (pickerModal?.type === 'level'
                  ? [{ key: 'beginner', label: 'Beginner' }, { key: 'intermediate', label: 'Intermediate' }, { key: 'advanced', label: 'Advanced' }]
                  : [{ key: 'veg', label: 'Vegetarian' }, { key: 'non_veg', label: 'Non-Veg' }]
                ).map((opt) => (
                  <TouchableOpacity key={opt.key} onPress={() => onPickerSelect(opt.key)} activeOpacity={0.7}
                    style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, backgroundColor: pickerModal?.current === opt.key ? 'rgba(31,164,99,0.15)' : 'transparent', marginBottom: 6, borderWidth: 1, borderColor: pickerModal?.current === opt.key ? C.cardBorder : 'transparent' }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: pickerModal?.current === opt.key ? C.accent : C.muted, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                      {pickerModal?.current === opt.key && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent }} />}
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: C.white }}>{opt.label}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </View>
  );
}
