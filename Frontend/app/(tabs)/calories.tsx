import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
  Dimensions,
  Modal,
  Linking,
  Platform,
  Keyboard,
  RefreshControl,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop, Text as SvgText, Rect, Line } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getCaloriesToday,
  getCaloriesWeekly,
  logCaloriesMeal,
  searchFoodsAutocomplete,
  setAuthToken,
  getFoodByBarcode,
  removeFoodFromLog,
  getUserProfile,
} from '../../services/api';
import { useFitness } from '../../hooks/useFitness';
import { FitnessService } from '../../services/fitness';

const BarcodeIcon:Record<string, any> = {
  barcode: require('../../assets/icons/calories/barcode.png'),
  food: require('../../assets/icons/calories/food.png'),
  burn: require('../../assets/icons/calories/burn.png'),
  steps: require('../../assets/icons/calories/steps.png'),
}

// Meal category icons from assets
const mealImages: Record<string, any> = {
  breakfast: require('../../assets/icons/calories/breakfast.png'),
  lunch: require('../../assets/icons/calories/Lunch.png'),
  dinner: require('../../assets/icons/calories/dinner.png'),
  snacks: require('../../assets/icons/calories/snack.png'),
};
import GFLoader from '../../components/GFLoader';

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

const CHART_PADDING_LEFT = 36;
const CHART_PADDING_RIGHT = 8;
const CHART_DRAW_WIDTH = CHART_WIDTH - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;

function DualTrendChart({ intakeData, burnData }: { intakeData: DayPoint[]; burnData: DayPoint[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: number; type: string } | null>(null);

  const allValues = [...intakeData.map(d => d.calories), ...burnData.map(d => d.calories)];
  const maxValue = Math.max(100, ...allValues);
  const minValue = 0;
  const range = maxValue - minValue || 1;

  // Y-axis ticks
  const yTicks = [0, Math.round(maxValue * 0.33), Math.round(maxValue * 0.66), Math.round(maxValue)];

  const mapPoints = (data: DayPoint[]) => data.map((item, index) => {
    const x = CHART_PADDING_LEFT + (data.length === 1 ? CHART_DRAW_WIDTH / 2 : (index / (data.length - 1)) * CHART_DRAW_WIDTH);
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

  const handlePointPress = (type: string, index: number, data: DayPoint[], points: { x: number; y: number }[]) => {
    const item = data[index];
    const point = points[index];
    if (!item || !point) return;
    setTooltip({ x: point.x, y: point.y, label: item.day, value: item.calories, type });
    setTimeout(() => setTooltip(null), 2500);
  };

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
      <View>
        <Svg width={CHART_WIDTH} height={CHART_HEIGHT + 28}>
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
          {/* Y-axis grid lines */}
          {yTicks.map((tick, i) => {
            const y = CHART_HEIGHT - ((tick - minValue) / range) * (CHART_HEIGHT - 18) - 9;
            const clampedY = Math.max(6, Math.min(CHART_HEIGHT - 6, y));
            return (
              <React.Fragment key={`yt-${i}`}>
                <Line x1={CHART_PADDING_LEFT} y1={clampedY} x2={CHART_WIDTH - CHART_PADDING_RIGHT} y2={clampedY} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
                <SvgText x={CHART_PADDING_LEFT - 6} y={clampedY + 3} fill={C.muted} fontSize="8" textAnchor="end" fontWeight="500">{tick}</SvgText>
              </React.Fragment>
            );
          })}
          {/* Y-axis line */}
          <Line x1={CHART_PADDING_LEFT} y1={6} x2={CHART_PADDING_LEFT} y2={CHART_HEIGHT} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
          {intakeArea ? <Path d={intakeArea} fill="url(#intake-area)" /> : null}
          {burnArea ? <Path d={burnArea} fill="url(#burn-area)" /> : null}
          {intakeLine ? <Path d={intakeLine} stroke="url(#intake-line)" strokeWidth={2.5} fill="none" strokeLinecap="round" /> : null}
          {burnLine ? <Path d={burnLine} stroke="url(#burn-line)" strokeWidth={2.5} fill="none" strokeLinecap="round" /> : null}
          {intakePoints.map((p, i) => (
            <React.Fragment key={`ip-${i}`}>
              <Circle cx={p.x} cy={p.y} r={4.5} fill="rgba(0,230,118,0.2)" />
              <Circle cx={p.x} cy={p.y} r={3} fill={C.card} stroke={C.accent} strokeWidth={1.8} />
              <Rect x={p.x - 12} y={p.y - 12} width={24} height={24} fill="transparent" onPress={() => handlePointPress('Intake', i, intakeData, intakePoints)} />
            </React.Fragment>
          ))}
          {burnPoints.map((p, i) => (
            <React.Fragment key={`bp-${i}`}>
              <Circle cx={p.x} cy={p.y} r={4.5} fill="rgba(255,107,107,0.2)" />
              <Circle cx={p.x} cy={p.y} r={3} fill={C.card} stroke={C.burnColor} strokeWidth={1.8} />
              <Rect x={p.x - 12} y={p.y - 12} width={24} height={24} fill="transparent" onPress={() => handlePointPress('Burn', i, burnData, burnPoints)} />
            </React.Fragment>
          ))}
          {/* X-axis labels */}
          {days.map((entry, idx) => {
            const x = CHART_PADDING_LEFT + (days.length === 1 ? CHART_DRAW_WIDTH / 2 : (idx / (days.length - 1)) * CHART_DRAW_WIDTH);
            return (
              <SvgText key={`dl-${idx}`} x={x} y={CHART_HEIGHT + 18} fill={C.muted} fontSize="10" textAnchor="middle" fontWeight="500">{entry.day}</SvgText>
            );
          })}
        </Svg>
        {/* Tooltip overlay */}
        {tooltip && (
          <View style={{
            position: 'absolute', left: Math.min(Math.max(tooltip.x - 45, 4), CHART_WIDTH - 94), top: Math.max(tooltip.y - 46, 0),
            backgroundColor: 'rgba(0,0,0,0.88)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1,
            borderColor: tooltip.type === 'Intake' ? C.accent : C.burnColor,
          }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{tooltip.value} kcal</Text>
            <Text style={{ color: C.muted, fontSize: 9 }}>{tooltip.label} · {tooltip.type}</Text>
          </View>
        )}
      </View>
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
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const liveSyncRef = useRef(false);
  const liveSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [daily, setDaily] = useState<any>(null);
  const [profileGoal, setProfileGoal] = useState<number>(0);
  const [weekly, setWeekly] = useState<{ intakeTrend: DayPoint[]; burnedTrend: DayPoint[] }>({
    intakeTrend: [],
    burnedTrend: [],
  });

  // ── HealthKit-backed fitness data (steps + burn) ──
  const fitness = useFitness();

  // Search overlay state
  const [searchVisible, setSearchVisible] = useState(false);
  const [actionPickerVisible, setActionPickerVisible] = useState(false);
  const [manualPickerVisible, setManualPickerVisible] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [addingFoodId, setAddingFoodId] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Meal type picker state
  const [mealPickerVisible, setMealPickerVisible] = useState(false);
  const [pendingFoodId, setPendingFoodId] = useState('');

  // Meal detail sheet state (opened when tapping a meal summary card)
  const [mealDetailVisible, setMealDetailVisible] = useState(false);
  const [activeMeal, setActiveMeal] = useState<string>('');
  const [deletingFoodId, setDeletingFoodId] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const progressSize = 188;
  const stroke = 12;
  const radius = (progressSize - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const consumedCalories = Number(daily?.consumedCalories || 0);
  // Use profile goalCalories as primary target, fallback to API targetCalories, then 2000
  const targetCalories = profileGoal > 0 ? profileGoal : Number(daily?.targetCalories || 2000);
  const remainingCalories = Math.max(0, targetCalories - consumedCalories);
  const progress = Math.max(0, Math.min(consumedCalories / Math.max(targetCalories, 1), 1));
  const progressOffset = circumference * (1 - progress);

  // Dynamic ring color based on consumption percentage
  const consumptionPercent = (consumedCalories / Math.max(targetCalories, 1)) * 100;
  const ringColor = consumptionPercent > 75 ? '#00E676' : consumptionPercent >= 50 ? '#FFA500' : '#FF4D4D';
  const ringColorSecondary = consumptionPercent > 75 ? '#6CFFB0' : consumptionPercent >= 50 ? '#FFD180' : '#FF8A80';
  const ringGlowBg = consumptionPercent > 75 ? 'rgba(0,230,118,0.04)' : consumptionPercent >= 50 ? 'rgba(255,165,0,0.04)' : 'rgba(255,77,77,0.04)';

  const protein = Number(daily?.macros?.protein || 0);
  const carbs = Number(daily?.macros?.carbs || 0);
  const fat = Number(daily?.macros?.fat || 0);

  const recentFoods = useMemo(() => (daily?.logs || []).slice(0, 5), [daily?.logs]);

  // Flat food list for grid
  const allFoodEntries: FoodEntry[] = useMemo(() => {
    const entries: FoodEntry[] = [];
    for (const key of mealOrder) {
      const list: FoodEntry[] = Array.isArray(daily?.meals?.[key]) ? daily.meals[key] : [];
      for (const item of list) {
        entries.push({ ...item, mealType: key, meal: key });
      }
    }
    return entries;
  }, [daily?.meals]);

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
      if (silent && liveSyncRef.current) return;
      liveSyncRef.current = true;
      if (!silent) setLoading(true);
      else setRefreshing(true);

      const token = await AsyncStorage.getItem('token');
      setAuthToken(token || null);

      const [todayRes, weeklyRes, profileRes] = await Promise.all([
        getCaloriesToday(),
        getCaloriesWeekly(),
        getUserProfile().catch(() => ({ data: null })),
      ]);

      setDaily(todayRes.data || null);

      // Sync goalCalories from user profile
      const goal = Number(profileRes.data?.goalCalories || profileRes.data?.maintenanceCalories || 0);
      if (goal > 0) setProfileGoal(goal);

      // Update user weight in FitnessService for calorie estimation
      const userWeight = Number(profileRes.data?.weight || 0);
      if (userWeight > 0) {
        FitnessService.setUserWeight(userWeight);
      }

      setWeekly({
        intakeTrend: Array.isArray(weeklyRes.data?.intakeTrend) ? weeklyRes.data.intakeTrend : [],
        burnedTrend: Array.isArray(weeklyRes.data?.burnedTrend) ? weeklyRes.data.burnedTrend : [],
      });

      // Trigger fitness refresh for steps + burn (via HealthKit/backend)
      fitness.refresh();
    } catch (error) {
      console.warn('Calories screen load error', error);
      Alert.alert('Sync Error', 'Could not fetch calories data from backend.');
    } finally {
      liveSyncRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshCaloriesSilently = useCallback(() => loadData(true), [loadData]);

  // Check location permission on focus
  useFocusEffect(
    useCallback(() => {
      if (liveSyncTimerRef.current) {
        clearInterval(liveSyncTimerRef.current);
        liveSyncTimerRef.current = null;
      }

      loadData(false);
      (async () => {
        try {
          // Load recent searches
          const stored = await AsyncStorage.getItem('recentFoodSearches');
          if (stored) setRecentSearches(JSON.parse(stored).slice(0, 8));
        } catch { /* ignore */ }
      })();

      liveSyncTimerRef.current = setInterval(() => {
        void refreshCaloriesSilently();
      }, 20000);

      return () => {
        if (liveSyncTimerRef.current) {
          clearInterval(liveSyncTimerRef.current);
          liveSyncTimerRef.current = null;
        }
      };
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

  const showMealPicker = (foodId: string) => {
    setPendingFoodId(foodId);
    setMealPickerVisible(true);
  };

  const handleMealTypeSelected = async (mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack') => {
    const foodId = pendingFoodId;
    setMealPickerVisible(false);
    setPendingFoodId('');
    if (!foodId) return;
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

  const handleDeleteFood = async (logId: string) => {
    try {
      setDeletingFoodId(logId);
      await removeFoodFromLog(logId);
      await loadData(true);
    } catch (error) {
      Alert.alert('Delete Failed', 'Unable to remove this food from your log.');
    } finally {
      setDeletingFoodId('');
    }
  };

  const openMealDetail = (meal: string) => {
    setActiveMeal(meal);
    setMealDetailVisible(true);
  };

  const handleRequestHealthKit = async () => {
    try {
      await FitnessService.initialize();
      fitness.refresh();
    } catch { /* ignore */ }
  };

  const openSearch = () => {
    setSearchText('');
    setResults([]);
    setSearchVisible(true);
  };

  const openActionPicker = () => {
    Keyboard.dismiss();
    setActionPickerVisible(true);
  };

  const closeActionPicker = () => {
    setActionPickerVisible(false);
  };

  const openManualSearch = () => {
    closeActionPicker();
    openSearch();
  };

  const openBarcodeScan = () => {
    closeActionPicker();
    router.push('/scan');
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
    return <GFLoader message="Loading calories dashboard..." />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Top-right radial glow — same as Profile */}
      <View style={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(0,230,118,0.06)' }} />
      <View style={{ position: 'absolute', top: -20, right: -20, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(0,230,118,0.04)' }} />

      {/* Custom GFLoader refresh indicator */}
      {refreshing && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 99, alignItems: 'center', paddingTop: 60 }}>
          <GFLoader fullScreen={false} size={32} message="Refreshing..." />
        </View>
      )}

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              tintColor="transparent"
              colors={['transparent']}
              progressBackgroundColor="transparent"
            />
          }
        >
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
                backgroundColor: ringGlowBg,
                justifyContent: 'center', alignItems: 'center',
              }}>
                <Svg width={progressSize} height={progressSize}>
                  <Defs>
                    <SvgGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0%" stopColor={ringColor} />
                      <Stop offset="50%" stopColor={ringColorSecondary} />
                      <Stop offset="100%" stopColor={ringColor} />
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
                  <Text style={{ color: ringColor, fontSize: 13, marginTop: 4, fontWeight: '700' }}>{Math.round(remainingCalories)} remaining</Text>
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

          {/* ═══ HEALTHKIT PERMISSION CARD ═══ */}
          {(fitness.isHealthKitAvailable && !fitness.isHealthKitAuthorized) && (
            <View style={{
              backgroundColor: C.card, borderRadius: 18, borderWidth: 1,
              borderColor: 'rgba(255,170,50,0.2)', padding: 16, marginTop: 12,
              flexDirection: 'row', alignItems: 'center',
            }}>
              <View style={{
                width: 42, height: 42, borderRadius: 12,
                backgroundColor: 'rgba(0,230,118,0.12)',
                justifyContent: 'center', alignItems: 'center', marginRight: 14,
              }}>
                <FontAwesome name="heartbeat" size={18} color={C.accent} />
              </View>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>Apple Health</Text>
                <Text style={{ color: C.muted, fontSize: 11, marginTop: 2, lineHeight: 15 }}>Enable HealthKit for accurate steps and calorie burn data</Text>
              </View>
              <TouchableOpacity onPress={handleRequestHealthKit} activeOpacity={0.8}
                style={{
                  backgroundColor: C.accent, borderRadius: 10,
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
                <View style={{ width: 36, height: 36, borderRadius: 10,  justifyContent: 'center', alignItems: 'center' }}>
                   <Image source={BarcodeIcon.burn} style={{ width: 50, height: 50 }} resizeMode="contain" />
                  
                </View>
                <Text style={{ color: C.subtext, fontSize: 12 }}>Calories Burn</Text>
              </View>
              <Text style={{ color: C.text, fontSize: 26, fontWeight: '800' }}>{Math.round(fitness.caloriesBurned)}</Text>
              <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>kcal today</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <Text style={{ color: C.accent, fontSize: 10 }}>Active {Math.round(fitness.walkingCalories)} kcal</Text>
                {fitness.source === 'healthkit' && (
                  <View style={{ backgroundColor: 'rgba(0,230,118,0.15)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                    <Text style={{ color: C.accent, fontSize: 8, fontWeight: '700' }}>❤️ HK</Text>
                  </View>
                )}
                {fitness.source === 'estimated' && (
                  <View style={{ backgroundColor: 'rgba(255,170,50,0.15)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                    <Text style={{ color: '#FFAA32', fontSize: 8, fontWeight: '700' }}>EST</Text>
                  </View>
                )}
              </View>
            </View>
            <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10,  justifyContent: 'center', alignItems: 'center' }}>
                  <Image source={BarcodeIcon.steps} style={{ width: 50, height: 50 }} resizeMode="contain" />
                </View>
                <Text style={{ color: C.subtext, fontSize: 12 }}>Daily Steps</Text>
              </View>
              <Text style={{ color: C.text, fontSize: 26, fontWeight: '800' }}>{Math.round(fitness.steps).toLocaleString()}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <FontAwesome name="map-marker" size={10} color={C.accent} />
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '600' }}>{fitness.distanceKm.toFixed(2)} km</Text>
              </View>
            </View>
          </View>

          {/* ═══ WEEKLY ANALYTICS — Dual Chart ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.subtext, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 2 }}>Weekly Analytics</Text>
          <DualTrendChart intakeData={weekly.intakeTrend} burnData={weekly.burnedTrend} />

          {/* ═══ QUICK ACTIONS ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.subtext, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 }}>Quick Actions</Text>
          <TouchableOpacity activeOpacity={0.8} onPress={openActionPicker}
            style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 42, height: 42, borderRadius: 12,  justifyContent: 'center', alignItems: 'center' }}>
              {/* <Image source={BarcodeIcon.food} style={{ width: 50, height: 50 }} resizeMode="contain" /> */}
            </View>
            <View style={{ flex: 1, marginLeft: -32 }}>
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>Get Food Calories</Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Scan or search food calories</Text>
            </View>
            <View style={{ width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }}>
              <Image source={BarcodeIcon.barcode} style={{ width: 50, height: 50 }} resizeMode="contain" />
            </View>
          </TouchableOpacity>



          {/* ═══ FOOD LOG TODAY — Clean Summary Grid ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.subtext, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 }}>Food Log Today</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {mealOrder.map((meal) => {
              const mealLabel = meal.charAt(0).toUpperCase() + meal.slice(1);
              const totals = mealTotals[meal];
              const itemCount = totals.count;
              return (
                <TouchableOpacity
                  key={meal}
                  activeOpacity={0.85}
                  onPress={() => openMealDetail(meal)}
                  style={{
                    width: (SCREEN_WIDTH - 50) / 2,
                    backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder,
                    paddingVertical: 20, paddingHorizontal: 14, alignItems: 'center',
                  }}
                >
                  <Image source={mealImages[meal]} style={{ width: 50, height: 50, borderRadius: 10, marginBottom: 10 }} resizeMode="cover" />
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '800' }}>{mealLabel}</Text>
                  <Text style={{ color: C.accent, fontSize: 16, fontWeight: '800', marginTop: 4 }}>{Math.round(totals.calories)}<Text style={{ fontSize: 11, fontWeight: '600' }}> kcal</Text></Text>
                  <Text style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>{itemCount} {itemCount === 1 ? 'item' : 'items'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ═══ NUTRITION DETAILS — Grid ═══ */}
          {/* <Text style={{ fontSize: 13, fontWeight: '700', color: C.subtext, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 }}>Nutrition Details</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {[
              { label: 'Protein', value: protein, unit: 'g', icon: 'bolt', color: '#00E676', bg: 'rgba(0,230,118,0.12)' },
              { label: 'Carbs', value: carbs, unit: 'g', icon: 'leaf', color: '#6CFFB0', bg: 'rgba(108,255,176,0.12)' },
              { label: 'Fats', value: fat, unit: 'g', icon: 'tint', color: '#FFB088', bg: 'rgba(255,176,136,0.12)' },
              { label: 'Fiber', value: Number(daily?.macros?.fiber || 0), unit: 'g', icon: 'pagelines', color: '#80CBC4', bg: 'rgba(128,203,196,0.12)' },
            ].map((item) => (
              <View
                key={item.label}
                style={{
                  width: (SCREEN_WIDTH - 50) / 2,
                  backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder,
                  padding: 14,
                }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: item.bg, justifyContent: 'center', alignItems: 'center', marginBottom: 10 }}>
                  <FontAwesome name={item.icon as any} size={14} color={item.color} />
                </View>
                <Text style={{ color: C.muted, fontSize: 10, marginBottom: 2 }}>{item.label}</Text>
                <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>{item.value.toFixed(1)}<Text style={{ fontSize: 12, color: C.muted }}>{item.unit}</Text></Text>
              </View>
            ))}
          </View> */}

          {/* ═══ PREMIUM INSIGHTS ═══ */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.subtext, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 }}>Premium Insights</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <LockedCard title="AI Diet" subtitle="Personalized daily diet coaching and adaptive meal timing based on your intake trends." />
            <LockedCard title="MBM" subtitle="Real-time nutrient quality scoring and imbalance alerts for each meal." />
          </View>

          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>

      <Modal visible={actionPickerVisible} transparent animationType="fade" onRequestClose={closeActionPicker}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 22 }}>
          <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <View style={{ width: 36, height: 0, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
               
              </View>
              {/*                               */}
              <TouchableOpacity onPress={closeActionPicker} style={{ width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' }}>
               
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => { closeActionPicker(); setManualPickerVisible(true); }}
              style={{  borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginTop: 8, flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                <FontAwesome name="search" size={15} color={C.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>Manual</Text>
                <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>Search food or supplement name</Text>
              </View>
              <FontAwesome name="chevron-right" size={12} color={C.muted} />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={openBarcodeScan}
              style={{  borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginTop: 10, flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10,  justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                <Image source={BarcodeIcon.barcode} style={{ width: 45, height: 45 }} resizeMode="contain" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>Scan Barcode</Text>
                <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>Open camera scanner instantly</Text>
              </View>
              <FontAwesome name="chevron-right" size={12} color={C.muted} />
            </TouchableOpacity>

            <TouchableOpacity onPress={closeActionPicker} activeOpacity={0.8} style={{ marginTop: 12, alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: C.muted, fontSize: 12, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Manual bottom sheet: choose Search or Enter Barcode */}
      <Modal visible={manualPickerVisible} transparent animationType="slide" onRequestClose={() => setManualPickerVisible(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <View style={{ backgroundColor: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, borderWidth: 1, borderColor: C.cardBorder }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>Manual Entry</Text>
              <TouchableOpacity onPress={() => setManualPickerVisible(false)}>
                <FontAwesome name="times" size={18} color={C.muted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => { setManualPickerVisible(false); openSearch(); }} activeOpacity={0.85}
              style={{ backgroundColor: C.glass, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center' }}>
              <FontAwesome name="search" size={16} color={C.text} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontWeight: '700' }}>Search Food</Text>
                <Text style={{ color: C.muted, fontSize: 12 }}>Search by product or supplement name</Text>
              </View>
              <FontAwesome name="chevron-right" size={12} color={C.muted} />
            </TouchableOpacity>

            <View style={{ height: 12 }} />

            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 12, height: 46, justifyContent: 'center' }}>
                <TextInput value={manualBarcode} onChangeText={setManualBarcode} placeholder="Enter barcode number" placeholderTextColor={C.muted} style={{ color: C.text }} keyboardType="numeric" />
              </View>
              <TouchableOpacity onPress={async () => {
                try {
                  if (!manualBarcode.trim()) { Alert.alert('Enter barcode', 'Please enter a barcode number'); return; }
                  const res = await getFoodByBarcode(manualBarcode.trim());
                  const found = res?.data?.food || res?.data || null;
                  if (found && (found._id || (Array.isArray(found) && found.length > 0))) {
                    const fid = found._id || (Array.isArray(found) ? found[0]._id : null);
                    if (fid) router.push(`/food-details?id=${fid}`);
                    else router.push(`/food-details?barcode=${manualBarcode.trim()}`);
                    setManualPickerVisible(false);
                  } else {
                    Alert.alert('Not found', 'Product not found for this barcode. You can add it manually in details.');
                  }
                } catch (err) {
                  Alert.alert('Lookup failed', 'Could not lookup barcode.');
                }
              }} style={{ backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 14, height: 46, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: '#050505', fontWeight: '700' }}>Lookup</Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: 10 }} />
            <TouchableOpacity onPress={() => setManualPickerVisible(false)} style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: C.muted }}>Close</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ═══ SEARCH OVERLAY MODAL ═══ */}
      <Modal visible={searchVisible} animationType="slide" transparent={false} onRequestClose={closeSearch}>
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          <SafeAreaView style={{ flex: 1 }}>
            {/* Search Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Math.max(insets.top, 8), paddingBottom: 12, gap: 10 }}>
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
                  <GFLoader fullScreen={false} size={20} />
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
                    <TouchableOpacity
                      key={food._id}
                      activeOpacity={0.85}
                      onPress={() => {
                        closeSearch();
                        router.push(`/food-details?id=${food._id}`);
                      }}
                      style={{
                        backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder,
                        padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center',
                      }}
                    >
                      <View style={{
                        width: 38, height: 38, borderRadius: 10,
                        backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center', marginRight: 12,
                      }}>
                        <FontAwesome name="cutlery" size={14} color={C.accent} />
                      </View>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{food.name || 'Food'}</Text>
                        <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>
                          {food.brand || 'Unknown brand'} • {Math.round(Number(food.calories || 0))} kcal • {food.servingSize || 'Serving not set'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={(e) => {
                          e?.stopPropagation?.();
                          showMealPicker(food._id);
                        }}
                        disabled={addingFoodId === food._id}
                        style={{ backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}
                      >
                        <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700' }}>{addingFoodId === food._id ? 'Adding...' : '+ Add'}</Text>
                      </TouchableOpacity>
                    </TouchableOpacity>
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

      {/* ═══ MEAL TYPE PICKER MODAL ═══ */}
      <Modal visible={mealPickerVisible} transparent animationType="fade" onRequestClose={() => { setMealPickerVisible(false); setPendingFoodId(''); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 22 }}>
          <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                <FontAwesome name="cutlery" size={16} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '800' }}>Choose Meal Type</Text>
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Where should this food be logged?</Text>
              </View>
              <TouchableOpacity onPress={() => { setMealPickerVisible(false); setPendingFoodId(''); }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: C.glass, justifyContent: 'center', alignItems: 'center' }}>
                <FontAwesome name="times" size={14} color={C.text} />
              </TouchableOpacity>
            </View>

            {([
              { key: 'breakfast' as const, label: 'Breakfast', icon: 'coffee', desc: 'Morning meal' },
              { key: 'lunch' as const, label: 'Lunch', icon: 'sun-o', desc: 'Afternoon meal' },
              { key: 'dinner' as const, label: 'Dinner', icon: 'moon-o', desc: 'Evening meal' },
              { key: 'snack' as const, label: 'Snacks', icon: 'apple', desc: 'Between meals' },
            ]).map((item) => (
              <TouchableOpacity
                key={item.key}
                activeOpacity={0.8}
                onPress={() => handleMealTypeSelected(item.key)}
                style={{
                  backgroundColor: C.glass, borderWidth: 1, borderColor: C.border, borderRadius: 14,
                  padding: 14, marginBottom: 8, flexDirection: 'row', alignItems: 'center',
                }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                  <FontAwesome name={item.icon as any} size={15} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>{item.label}</Text>
                  <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{item.desc}</Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color={C.muted} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity onPress={() => { setMealPickerVisible(false); setPendingFoodId(''); }} activeOpacity={0.8} style={{ marginTop: 4, alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: C.muted, fontSize: 12, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ═══ MEAL DETAIL BOTTOM SHEET ═══ */}
      <Modal visible={mealDetailVisible} transparent animationType="slide" onRequestClose={() => setMealDetailVisible(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.cardBorder, padding: 20, paddingBottom: 36, maxHeight: '70%' }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              {activeMeal ? <Image source={mealImages[activeMeal]} style={{ width: 36, height: 36, borderRadius: 10, marginRight: 12 }} resizeMode="cover" /> : null}
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>{activeMeal ? activeMeal.charAt(0).toUpperCase() + activeMeal.slice(1) : ''} Details</Text>
                <Text style={{ color: C.accent, fontSize: 12, fontWeight: '600', marginTop: 2 }}>{Math.round(mealTotals[activeMeal]?.calories || 0)} kcal total</Text>
              </View>
              <TouchableOpacity onPress={() => setMealDetailVisible(false)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: C.glass, justifyContent: 'center', alignItems: 'center' }}>
                <FontAwesome name="times" size={14} color={C.text} />
              </TouchableOpacity>
            </View>

            {/* Food items list */}
            <ScrollView showsVerticalScrollIndicator={false}>
              {(() => {
                const foods: FoodEntry[] = Array.isArray(daily?.meals?.[activeMeal]) ? daily.meals[activeMeal] : [];
                if (foods.length === 0) {
                  return (
                    <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                      <FontAwesome name="cutlery" size={24} color="rgba(255,255,255,0.08)" />
                      <Text style={{ color: C.muted, fontSize: 13, marginTop: 10 }}>No food logged</Text>
                      <Text style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>Add food via search or barcode scan</Text>
                    </View>
                  );
                }
                return foods.map((food, idx) => {
                  const foodName = food.foodId?.name || 'Food';
                  const cal = Math.round(Number(food.caloriesConsumed || food.calories || 0));
                  const isDeleting = deletingFoodId === food._id;
                  return (
                    <View
                      key={food._id || `md-${idx}`}
                      style={{
                        flexDirection: 'row', alignItems: 'center', backgroundColor: C.glass,
                        borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder,
                        padding: 14, marginBottom: 8,
                      }}
                    >
                      <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                        <FontAwesome name="cutlery" size={12} color={C.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{foodName}</Text>
                        <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{cal} kcal</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          if (!food._id) return;
                          Alert.alert('Remove Food', `Remove ${foodName}?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Remove', style: 'destructive', onPress: () => handleDeleteFood(food._id) },
                          ]);
                        }}
                        disabled={isDeleting}
                        style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: C.burnSoft, justifyContent: 'center', alignItems: 'center' }}
                      >
                        <FontAwesome name="trash-o" size={12} color={C.burnColor} />
                      </TouchableOpacity>
                    </View>
                  );
                });
              })()}
            </ScrollView>

            <TouchableOpacity onPress={() => setMealDetailVisible(false)} activeOpacity={0.8} style={{ marginTop: 10, alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: C.muted, fontSize: 12, fontWeight: '600' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

