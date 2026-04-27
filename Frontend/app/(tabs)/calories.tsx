import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Dimensions,
  Modal,
  Linking,
  Platform,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Location from 'expo-location';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getCaloriesToday,
  getCaloriesWeekly,
  getCaloriesBurn,
  getStepsToday,
  logCaloriesMeal,
  searchFoodsAutocomplete,
  setAuthToken,
} from '../../services/api';

const C = {
  bg: '#050505',
  card: 'rgba(25,25,25,1)',
  cardBorder: 'rgba(29,36,31,0.18)',
  glass: 'rgba(22,33,25,0.78)',
  accent: '#00E676',
  accentSoft: 'rgba(0,230,118,0.16)',
  text: '#F4F6F5',
  subtext: 'rgba(255,255,255,0.62)',
  muted: 'rgba(255,255,255,0.4)',
  border: 'rgba(0,230,118,0.18)',
  burnColor: '#FF6B6B',
  burnSoft: 'rgba(255,107,107,0.15)',
};

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - 72;
const CHART_HEIGHT = 130;

const mealOrder = ['breakfast', 'lunch', 'dinner', 'snacks'] as const;

type FoodEntry = {
  _id: string;
  foodId?: { _id?: string; name?: string; brand?: string };
  caloriesConsumed?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  mealType?: string;
  meal?: string;
};

type DayPoint = {
  day: string;
  calories: number;
};

const buildLinePath = (points: { x: number; y: number }[]) => {
  if (!points.length) return '';
  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cp1x = p0.x + (p1.x - p0.x) / 3;
    const cp2x = p1.x - (p1.x - p0.x) / 3;
    path += ` C ${cp1x} ${p0.y}, ${cp2x} ${p1.y}, ${p1.x} ${p1.y}`;
  }

  return path;
};

function DualTrendChart({ intakeData, burnData }: { intakeData: DayPoint[]; burnData: DayPoint[] }) {
  const allValues = [...intakeData.map(d => d.calories), ...burnData.map(d => d.calories)];
  const maxValue = Math.max(100, ...allValues);
  const minValue = Math.min(0, ...allValues);
  const range = maxValue - minValue || 1;

  const mapPoints = (data: DayPoint[]) => data.map((item, index) => {
    const x = data.length === 1 ? CHART_WIDTH / 2 : (index / (data.length - 1)) * CHART_WIDTH;
    const y = CHART_HEIGHT - ((item.calories - minValue) / range) * (CHART_HEIGHT - 18) - 9;
    return { x, y: Math.max(6, Math.min(CHART_HEIGHT - 6, y)) };
  });

  const intakePoints = mapPoints(intakeData);
  const burnPoints = mapPoints(burnData);
  const intakeLine = buildLinePath(intakePoints);
  const burnLine = buildLinePath(burnPoints);
  const intakeArea = intakePoints.length > 0 ? `${intakeLine} L ${intakePoints[intakePoints.length - 1].x} ${CHART_HEIGHT} L ${intakePoints[0].x} ${CHART_HEIGHT} Z` : '';
  const burnArea = burnPoints.length > 0 ? `${burnLine} L ${burnPoints[burnPoints.length - 1].x} ${CHART_HEIGHT} L ${burnPoints[0].x} ${CHART_HEIGHT} Z` : '';
  const days = intakeData.length > 0 ? intakeData : burnData;

  return (
    <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 16, marginTop: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>Weekly Analytics</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent }} />
            <Text style={{ color: C.muted, fontSize: 10 }}>Intake</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.burnColor }} />
            <Text style={{ color: C.muted, fontSize: 10 }}>Burn</Text>
          </View>
        </View>
      </View>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT + 24}>
        <Defs>
          <SvgGradient id="intake-area" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={C.accent} stopOpacity="0.22" />
            <Stop offset="100%" stopColor={C.accent} stopOpacity="0.02" />
          </SvgGradient>
          <SvgGradient id="burn-area" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={C.burnColor} stopOpacity="0.18" />
            <Stop offset="100%" stopColor={C.burnColor} stopOpacity="0.02" />
          </SvgGradient>
          <SvgGradient id="intake-line" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor="#00E676" />
            <Stop offset="100%" stopColor="#6CFFB0" />
          </SvgGradient>
          <SvgGradient id="burn-line" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor="#FF6B6B" />
            <Stop offset="100%" stopColor="#FFB088" />
          </SvgGradient>
        </Defs>
        {intakeArea ? <Path d={intakeArea} fill="url(#intake-area)" /> : null}
        {burnArea ? <Path d={burnArea} fill="url(#burn-area)" /> : null}
        {intakeLine ? <Path d={intakeLine} stroke="url(#intake-line)" strokeWidth={2.5} fill="none" strokeLinecap="round" /> : null}
        {burnLine ? <Path d={burnLine} stroke="url(#burn-line)" strokeWidth={2.5} fill="none" strokeLinecap="round" /> : null}
        {intakePoints.map((p, i) => (
          <React.Fragment key={`ip-${i}`}>
            <Circle cx={p.x} cy={p.y} r={4.5} fill="rgba(0,230,118,0.2)" />
            <Circle cx={p.x} cy={p.y} r={3} fill={C.card} stroke={C.accent} strokeWidth={1.8} />
          </React.Fragment>
        ))}
        {burnPoints.map((p, i) => (
          <React.Fragment key={`bp-${i}`}>
            <Circle cx={p.x} cy={p.y} r={4.5} fill="rgba(255,107,107,0.2)" />
            <Circle cx={p.x} cy={p.y} r={3} fill={C.card} stroke={C.burnColor} strokeWidth={1.8} />
          </React.Fragment>
        ))}
        {days.map((entry, idx) => {
          const x = days.length === 1 ? CHART_WIDTH / 2 : (idx / (days.length - 1)) * CHART_WIDTH;
          return (
            <SvgText key={`dl-${idx}`} x={x} y={CHART_HEIGHT + 16} fill={C.muted} fontSize="10" textAnchor="middle" fontWeight="500">{entry.day}</SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

function LockedCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{
      flex: 1,
      backgroundColor: C.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: C.cardBorder,
      padding: 16,
      minHeight: 115,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <View style={{
          width: 32, height: 32, borderRadius: 10,
          backgroundColor: C.accentSoft,
          alignItems: 'center', justifyContent: 'center', marginRight: 10,
        }}>
          <FontAwesome name="lock" size={13} color={C.accent} />
        </View>
        <Text style={{ color: C.text, fontSize: 14, fontWeight: '700', flex: 1 }}>{title}</Text>
      </View>
      <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16, marginBottom: 10 }}>{subtitle}</Text>
      <View style={{ backgroundColor: C.accentSoft, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
        <Text style={{ color: C.accent, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>PRO & PRO PLUS</Text>
      </View>
    </View>
  );
}

export default function CaloriesScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [daily, setDaily] = useState<any>(null);
  const [weekly, setWeekly] = useState<{ intakeTrend: DayPoint[]; burnedTrend: DayPoint[] }>({
    intakeTrend: [],
    burnedTrend: [],
  });
  const [steps, setSteps] = useState<{ steps: number; distanceKm: number }>({ steps: 0, distanceKm: 0 });
  const [burn, setBurn] = useState<{ totalCaloriesBurned: number }>({ totalCaloriesBurned: 0 });

  // Location permission state
  const [locationGranted, setLocationGranted] = useState(true);

  // Search overlay state
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [addingFoodId, setAddingFoodId] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const searchInputRef = useRef<TextInput>(null);

  const progressSize = 188;
  const stroke = 12;
  const radius = (progressSize - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const consumedCalories = Number(daily?.consumedCalories || 0);
  const targetCalories = Number(daily?.targetCalories || 2000);
  const remainingCalories = Number(daily?.remainingCalories ?? targetCalories - consumedCalories);
  const progress = Math.max(0, Math.min(consumedCalories / Math.max(targetCalories, 1), 1));
  const progressOffset = circumference * (1 - progress);

  const protein = Number(daily?.macros?.protein || 0);
  const carbs = Number(daily?.macros?.carbs || 0);
  const fat = Number(daily?.macros?.fat || 0);

  const recentFoods = useMemo(() => (daily?.logs || []).slice(0, 5), [daily?.logs]);

  const mealTotals = useMemo(() => {
    const mealMap: Record<string, { calories: number; protein: number; carbs: number; fat: number; count: number }> = {
      breakfast: { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
      lunch: { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
      dinner: { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
      snacks: { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
    };

    for (const key of mealOrder) {
      const list: FoodEntry[] = Array.isArray(daily?.meals?.[key]) ? daily.meals[key] : [];
      for (const item of list) {
        mealMap[key].calories += Number(item.caloriesConsumed || item.calories || 0);
        mealMap[key].protein += Number(item.protein || 0);
        mealMap[key].carbs += Number(item.carbs || 0);
        mealMap[key].fat += Number(item.fat || 0);
        mealMap[key].count += 1;
      }
    }

    return mealMap;
  }, [daily?.meals]);

  const loadData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else setRefreshing(true);

      const token = await AsyncStorage.getItem('token');
      setAuthToken(token || null);

      const [todayRes, weeklyRes, stepsRes, burnRes] = await Promise.all([
        getCaloriesToday(),
        getCaloriesWeekly(),
        getStepsToday(),
        getCaloriesBurn(),
      ]);

      setDaily(todayRes.data || null);
      setWeekly({
        intakeTrend: Array.isArray(weeklyRes.data?.intakeTrend) ? weeklyRes.data.intakeTrend : [],
        burnedTrend: Array.isArray(weeklyRes.data?.burnedTrend) ? weeklyRes.data.burnedTrend : [],
      });
      setSteps({
        steps: Number(stepsRes.data?.steps || 0),
        distanceKm: Number(stepsRes.data?.distanceKm || 0),
      });
      setBurn({
        totalCaloriesBurned: Number(burnRes.data?.totalCaloriesBurned || 0),
      });
    } catch (error) {
      console.warn('Calories screen load error', error);
      Alert.alert('Sync Error', 'Could not fetch calories data from backend.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Check location permission on focus
  useFocusEffect(
    useCallback(() => {
      loadData(false);
      (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          setLocationGranted(status === 'granted');
          // Load recent searches
          const stored = await AsyncStorage.getItem('recentFoodSearches');
          if (stored) setRecentSearches(JSON.parse(stored).slice(0, 8));
        } catch { /* ignore */ }
      })();
    }, [loadData])
  );

  // Debounced search (reuses existing API — no duplicate calls)
  useEffect(() => {
    const query = searchText.trim();
    if (query.length < 3) {
      setResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        setSearchLoading(true);
        const res = await searchFoodsAutocomplete(query, 12);
        setResults(Array.isArray(res.data) ? res.data : []);
        // Save to recent searches
        const trimmed = query;
        const updated = [trimmed, ...recentSearches.filter(r => r.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8);
        setRecentSearches(updated);
        await AsyncStorage.setItem('recentFoodSearches', JSON.stringify(updated));
      } catch (error) {
        console.warn('Search error', error);
      } finally {
        setSearchLoading(false);
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [searchText]);

  const addQuickFood = async (foodId: string, mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack' = 'snack') => {
    try {
      setAddingFoodId(foodId);
      await logCaloriesMeal({ foodId, servings: 1, mealType });
      setSearchText('');
      setResults([]);
      setSearchVisible(false);
      await loadData(true);
    } catch (error) {
      Alert.alert('Add Failed', 'Unable to add this food to today log.');
    } finally {
      setAddingFoodId('');
    }
  };

  const handleRequestLocation = async () => {
    try {
      const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        setLocationGranted(true);
        await AsyncStorage.setItem('locationTrackingEnabled', 'true');
        return;
      }
      if (canAskAgain) {
        const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
        if (newStatus === 'granted') {
          setLocationGranted(true);
          await AsyncStorage.setItem('locationTrackingEnabled', 'true');
        }
      } else {
        // Can't ask again — deep-link to Settings
        Linking.openSettings();
      }
    } catch { /* ignore */ }
  };

  const openSearch = () => {
    setSearchText('');
    setResults([]);
    setSearchVisible(true);
  };

  const closeSearch = () => {
    Keyboard.dismiss();
    setSearchVisible(false);
    setSearchText('');
    setResults([]);
  };

  const clearRecentSearches = async () => {
    setRecentSearches([]);
    await AsyncStorage.removeItem('recentFoodSearches');
  };

  const suggestionExamples = ['Optimum Nutrition', 'MuscleBlaze Whey', 'Creatine', 'Oats', 'Greek Yogurt'];

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={{ color: C.subtext, marginTop: 10 }}>Loading calories dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Top-right radial glow — same as Profile */}
      <View style={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(0,230,118,0.06)' }} />
      <View style={{ position: 'absolute', top: -20, right: -20, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(0,230,118,0.04)' }} />

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: 8, paddingBottom: 10 }}>
            <View>
              <Text style={{ color: C.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.6 }}>Calories</Text>
              <Text style={{ color: C.subtext, fontSize: 14, marginTop: 4 }}>Track your daily energy</Text>
            </View>
            <TouchableOpacity onPress={openSearch} activeOpacity={0.7}
              style={{
                width: 42, height: 42, borderRadius: 21,
                backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder,
                justifyContent: 'center', alignItems: 'center', marginTop: 4,
              }}>
              <FontAwesome name="search" size={16} color={C.accent} />
            </TouchableOpacity>
          </View>

          {/* ═══ HERO CARD — Calorie Ring ═══ */}
          <View style={{
            backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.cardBorder,
            padding: 20, marginTop: 4,
          }}>
            <View style={{ alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 16 }}>
              {/* Outer glow */}
              <View style={{
                width: progressSize + 16, height: progressSize + 16, borderRadius: (progressSize + 16) / 2,
                backgroundColor: 'rgba(0,230,118,0.04)',
                justifyContent: 'center', alignItems: 'center',
              }}>
                <Svg width={progressSize} height={progressSize}>
                  <Defs>
                    <SvgGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0%" stopColor="#00E676" />
                      <Stop offset="50%" stopColor="#6CFFB0" />
                      <Stop offset="100%" stopColor="#00E676" />
                    </SvgGradient>
                  </Defs>
                  <Circle cx={progressSize / 2} cy={progressSize / 2} r={radius} stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} fill="transparent" />
                  <Circle cx={progressSize / 2} cy={progressSize / 2} r={radius} stroke="url(#ring-grad)" strokeWidth={stroke} fill="transparent" strokeLinecap="round"
                    strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={progressOffset}
                    transform={`rotate(-90 ${progressSize / 2} ${progressSize / 2})`} />
                </Svg>
                <View style={{ position: 'absolute', alignItems: 'center' }}>
                  <Text style={{ color: C.text, fontSize: 32, fontWeight: '800' }}>{Math.round(consumedCalories)}</Text>
                  <Text style={{ color: C.subtext, fontSize: 12, marginTop: 2 }}>consumed kcal</Text>
                  <Text style={{ color: C.accent, fontSize: 13, marginTop: 4, fontWeight: '700' }}>{Math.round(remainingCalories)} remaining</Text>
                  <Text style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>Target {Math.round(targetCalories)} kcal</Text>
                </View>
              </View>
            </View>

            {/* Macro bars */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[
                { label: 'Protein', value: protein, color: '#00E676', max: 150 },
                { label: 'Carbs', value: carbs, color: '#6CFFB0', max: 250 },
                { label: 'Fats', value: fat, color: '#FFB088', max: 80 },
              ].map(m => (
                <View key={m.label} style={{ flex: 1, backgroundColor: C.glass, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.cardBorder }}>
                  <Text style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>{m.label}</Text>
                  <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{m.value.toFixed(1)}g</Text>
                  <View style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 6 }}>
                    <View style={{ height: 3, borderRadius: 2, backgroundColor: m.color, width: `${Math.min((m.value / m.max) * 100, 100)}%` as any }} />
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* ═══ LOCATION PERMISSION CARD ═══ */}
          {!locationGranted && (
            <View style={{
              backgroundColor: C.card, borderRadius: 18, borderWidth: 1,
              borderColor: 'rgba(255,170,50,0.2)', padding: 16, marginTop: 12,
              flexDirection: 'row', alignItems: 'center',
            }}>
              <View style={{
                width: 42, height: 42, borderRadius: 12,
                backgroundColor: 'rgba(255,170,50,0.12)',
                justifyContent: 'center', alignItems: 'center', marginRight: 14,
              }}>
                <FontAwesome name="map-marker" size={18} color="#FFAA32" />
              </View>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>Location Required</Text>
                <Text style={{ color: C.muted, fontSize: 11, marginTop: 2, lineHeight: 15 }}>Enable location to track steps, distance and calorie burn</Text>
              </View>
              <TouchableOpacity onPress={handleRequestLocation} activeOpacity={0.8}
                style={{
                  backgroundColor: '#FFAA32', borderRadius: 10,
                  paddingHorizontal: 14, paddingVertical: 8,
                }}>
                <Text style={{ color: '#050505', fontSize: 12, fontWeight: '700' }}>Enable</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ═══ BURN + STEPS CARDS ═══ */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.burnSoft, justifyContent: 'center', alignItems: 'center' }}>
                  <FontAwesome name="fire" size={16} color={C.burnColor} />
                </View>
                <Text style={{ color: C.subtext, fontSize: 12 }}>Calories Burn</Text>
              </View>
              <Text style={{ color: C.text, fontSize: 26, fontWeight: '800' }}>{Math.round(burn.totalCaloriesBurned)}</Text>
              <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>kcal today</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center' }}>
                  <FontAwesome name="road" size={14} color={C.accent} />
                </View>
                <Text style={{ color: C.subtext, fontSize: 12 }}>Daily Steps</Text>
              </View>
              <Text style={{ color: C.text, fontSize: 26, fontWeight: '800' }}>{Math.round(steps.steps).toLocaleString()}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <FontAwesome name="map-marker" size={10} color={C.accent} />
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '600' }}>{steps.distanceKm.toFixed(2)} km</Text>
              </View>
            </View>
          </View>

          {/* ═══ WEEKLY ANALYTICS — Dual Chart ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.subtext, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 2 }}>Weekly Analytics</Text>
          <DualTrendChart intakeData={weekly.intakeTrend} burnData={weekly.burnedTrend} />

          {/* ═══ QUICK ACTIONS ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.subtext, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 }}>Quick Actions</Text>
          <TouchableOpacity activeOpacity={0.8} onPress={() => router.push('/scan')}
            style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center' }}>
              <FontAwesome name="cutlery" size={16} color={C.accent} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>Get Food Calories</Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Scan or search food calories</Text>
            </View>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center' }}>
              <FontAwesome name="barcode" size={15} color={C.accent} />
            </View>
          </TouchableOpacity>


          {/* ═══ FOOD LOG TODAY ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.subtext, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 }}>Food Log Today</Text>
          <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 14 }}>
            {mealOrder.map((meal) => {
              const totals = mealTotals[meal];
              const mealLabel = meal.charAt(0).toUpperCase() + meal.slice(1);
              const mealIcons: Record<string, string> = { breakfast: 'coffee', lunch: 'sun-o', dinner: 'moon-o', snacks: 'apple' };
              return (
                <View key={meal} style={{ backgroundColor: C.glass, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center' }}>
                    <FontAwesome name={mealIcons[meal] as any} size={13} color={C.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>{mealLabel}</Text>
                      <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700' }}>{Math.round(totals.calories)} kcal</Text>
                    </View>
                    <Text style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>P {totals.protein.toFixed(1)}g | C {totals.carbs.toFixed(1)}g | F {totals.fat.toFixed(1)}g</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* ═══ PREMIUM INSIGHTS ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.subtext, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 }}>Premium Insights</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <LockedCard title="AI Diet" subtitle="Personalized daily diet coaching and adaptive meal timing based on your intake trends." />
            <LockedCard title="MBM" subtitle="Real-time nutrient quality scoring and imbalance alerts for each meal." />
          </View>

          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>

      {/* ═══ SEARCH OVERLAY MODAL ═══ */}
      <Modal visible={searchVisible} animationType="slide" transparent={false} onRequestClose={closeSearch}>
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          <SafeAreaView style={{ flex: 1 }}>
            {/* Search Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 10 }}>
              <TouchableOpacity onPress={closeSearch} style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder,
                justifyContent: 'center', alignItems: 'center',
              }}>
                <FontAwesome name="chevron-left" size={14} color={C.text} />
              </TouchableOpacity>
              <View style={{
                flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder,
                flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 46,
              }}>
                <FontAwesome name="search" size={14} color={C.muted} />
                <TextInput
                  ref={searchInputRef}
                  placeholder="Search foods, supplements, brands..."
                  placeholderTextColor={C.muted}
                  value={searchText}
                  onChangeText={setSearchText}
                  autoFocus
                  returnKeyType="search"
                  style={{ color: C.text, flex: 1, marginLeft: 10, fontSize: 14 }}
                />
                {searchLoading ? (
                  <ActivityIndicator color={C.accent} size="small" />
                ) : searchText.length > 0 ? (
                  <TouchableOpacity onPress={() => { setSearchText(''); setResults([]); }}>
                    <FontAwesome name="times-circle" size={16} color={C.muted} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {/* Suggestion Chips */}
              {searchText.length === 0 && (
                <>
                  <Text style={{ color: C.subtext, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Suggestions</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                    {suggestionExamples.map((example) => (
                      <TouchableOpacity key={example}
                        style={{ paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center' }}
                        onPress={() => setSearchText(example)}>
                        <Text style={{ color: C.subtext, fontSize: 12 }}>{example}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {/* Recent Searches */}
              {searchText.length === 0 && recentSearches.length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <Text style={{ color: C.subtext, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>Recent</Text>
                    <TouchableOpacity onPress={clearRecentSearches}>
                      <Text style={{ color: C.accent, fontSize: 11, fontWeight: '600' }}>Clear All</Text>
                    </TouchableOpacity>
                  </View>
                  {recentSearches.map((term, idx) => (
                    <TouchableOpacity key={`${term}-${idx}`} onPress={() => setSearchText(term)}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.cardBorder }}>
                      <FontAwesome name="clock-o" size={14} color={C.muted} style={{ marginRight: 12 }} />
                      <Text style={{ color: C.text, fontSize: 14, flex: 1 }}>{term}</Text>
                      <FontAwesome name="arrow-right" size={10} color={C.muted} />
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {/* Min chars hint */}
              {searchText.length > 0 && searchText.length < 3 && (
                <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                  <Text style={{ color: C.muted, fontSize: 13 }}>Type at least 3 characters to search</Text>
                </View>
              )}

              {/* Results */}
              {results.length > 0 && (
                <View style={{ marginTop: 4 }}>
                  <Text style={{ color: C.subtext, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Results</Text>
                  {results.map((food) => (
                    <View key={food._id} style={{
                      backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder,
                      padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center',
                    }}>
                      <View style={{
                        width: 38, height: 38, borderRadius: 10,
                        backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center', marginRight: 12,
                      }}>
                        <FontAwesome name="cutlery" size={14} color={C.accent} />
                      </View>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{food.name || 'Food'}</Text>
                        <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                          {food.brand || 'Unknown brand'} • {Math.round(Number(food.calories || 0))} kcal
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => addQuickFood(food._id, 'snack')} disabled={addingFoodId === food._id}
                        style={{ backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}>
                        <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700' }}>{addingFoodId === food._id ? 'Adding...' : '+ Add'}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              {/* No results */}
              {searchText.length >= 3 && !searchLoading && results.length === 0 && (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <FontAwesome name="search" size={28} color="rgba(255,255,255,0.08)" />
                  <Text style={{ color: C.muted, fontSize: 14, marginTop: 10 }}>No results found</Text>
                  <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Try a different search term</Text>
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

