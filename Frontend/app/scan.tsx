import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Alert, StyleSheet, ActivityIndicator,
  TextInput, FlatList, Animated, Dimensions, ScrollView, Modal, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { searchFoodsByName, addFoodToLog, recognizeFood, smartFoodSearch, trackFoodMemory, submitFoodFeedback, getUsageToday } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ═══ THEME ═══
const C = {
  bg: '#050505',
  card: 'rgba(25,25,25,1)',
  cardBorder: 'rgba(255,255,255,0.06)',
  glass: 'rgba(20,22,24,0.92)',
  accent: '#1FA463',
  accentDim: 'rgba(31,164,99,0.14)',
  accentGlow: 'rgba(31,164,99,0.25)',
  text: '#F4F6F5',
  subtext: 'rgba(255,255,255,0.62)',
  muted: 'rgba(255,255,255,0.4)',
  border: 'rgba(255,255,255,0.06)',
  red: '#FF6B6B',
  orange: '#FFB74D',
  blue: '#42A5F5',
  green: '#66BB6A',
  purple: '#AB47BC',
  cyan: '#26C6DA',
};

// ═══ SERVING CONVERSION MAP ═══
const SERVING_MAP: Record<string, Record<string, number>> = {
  'rice': { bowl: 150, cup: 185, serving: 150 },
  'oats': { bowl: 40, cup: 80, serving: 40, scoop: 30 },
  'pasta': { bowl: 200, cup: 140, serving: 200 },
  'bread': { piece: 30, slice: 30, serving: 30 },
  'roti': { piece: 35, serving: 35 },
  'chapati': { piece: 35, serving: 35 },
  'egg': { piece: 50, serving: 50 },
  'chicken': { piece: 120, serving: 100 },
  'paneer': { piece: 25, serving: 100, bowl: 150 },
  'dal': { bowl: 200, cup: 200, serving: 200 },
  'milk': { cup: 244, glass: 244, serving: 244 },
  'yogurt': { cup: 245, bowl: 200, serving: 150 },
  'banana': { piece: 120, serving: 120 },
  'apple': { piece: 180, serving: 180 },
  'whey protein': { scoop: 30, serving: 30 },
  'protein powder': { scoop: 30, serving: 30 },
  'creatine': { scoop: 5, serving: 5 },
  'almonds': { handful: 28, serving: 28 },
  'peanut butter': { tbsp: 32, serving: 32 },
  'biryani': { bowl: 250, plate: 300, serving: 250 },
  'curry': { bowl: 200, serving: 200 },
};

const getGramsPerUnit = (name: string, unit: string): number | null => {
  if (unit === 'g' || unit === 'ml') return 1;
  const lower = name.toLowerCase();
  for (const [key, map] of Object.entries(SERVING_MAP)) {
    if (lower.includes(key) && map[unit] !== undefined) return map[unit];
  }
  return null;
};

const getUnitsForFood = (name: string): string[] => {
  const base = ['g'];
  const lower = (name || '').toLowerCase();
  for (const [key, map] of Object.entries(SERVING_MAP)) {
    if (lower.includes(key)) {
      return [...base, ...Object.keys(map)];
    }
  }
  return [...base, 'serving', 'bowl', 'cup', 'piece'];
};

const detectFoodType = (name: string): string => {
  const l = (name || '').toLowerCase();
  if (/(raw|uncooked|fresh)\s/.test(l)) return 'Raw';
  if (/(cooked|boiled|steamed|grilled|fried|baked|roasted)/.test(l)) return 'Cooked';
  if (/(whey|creatine|bcaa|pre[\s-]?workout|mass gainer|protein powder|supplement)/.test(l)) return 'Supplement';
  if (/(bar|chips|biscuit|cookie|packaged)/.test(l)) return 'Packaged';
  return '';
};

// ═══ TYPES ═══
type FoodResult = {
  _id: string;
  name: string;
  brand?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  servingSize?: string;
  servingUnit?: string;
  source?: string;
  origin?: string;
  _matchScore?: number;
  _macroValid?: boolean;
  _macroIssues?: string[];
  _rejected?: boolean;
};

type FoodAlternative = {
  name: string;
  normalized_name: string;
  confidence: number;
  dish_type: string;
  cooking_style: string;
  grams: number;
  count: number;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  source: string;
};

type DetectedFood = {
  name: string;
  normalized_name: string;
  state: string;
  portion: string;
  grams: number;
  confidence: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar?: number;
  sodium?: number;
  confirmed: boolean;
  matchedFood?: FoodResult | null;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  // Pipeline v3 fields
  dish_type?: string;
  cooking_style?: string;
  visible_ingredients?: string[];
  confidence_tier?: 'auto' | 'confirm' | 'select' | 'unknown';
  source?: string;
  alternatives?: FoodAlternative[];
  reasoning_adjustment?: number;
  reasoning_explanation?: string[];
  // Portion v2 fields
  per100g?: { calories: number; protein: number; carbs: number; fat: number; fiber: number };
  portion_confidence?: number;
  portion_source?: string;
  estimated_weight?: number;
  needs_confirmation?: boolean;
  portion_options?: { label: string; grams: number }[];
  is_user_modified?: boolean;
};

type AIReasoningData = {
  extracted_ingredients: string[];
  visual_cues: string[];
  cooking_indicators: string[];
  portion_cues: string[];
  counts: Record<string, number>;
  food_state: string;
  ontology_size: number;
  validation_state: string;
  object_count: number;
  objects_detected: any[];
  is_meal: boolean;
  meal_type: string;
};

// ═══ ANIMATED PULSE ═══
function PulseRing({ size = 200, color = C.accent }: { size?: number; color?: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const opacity = anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 0.3, 0] });
  return (
    <Animated.View
      style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2,
        borderWidth: 2, borderColor: color, transform: [{ scale }], opacity,
      }}
    />
  );
}

// ═══ ANALYZING STAGES ═══
function AnalyzingStage({ stage, index, isActive, isDone }: { stage: string; index: number; isActive: boolean; isDone: boolean }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, delay: index * 200, useNativeDriver: true }).start();
  }, []);

  return (
    <Animated.View style={{ opacity: fadeAnim, flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 12 }}>
      <View style={{
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: isDone ? C.accent : isActive ? 'rgba(31,164,99,0.2)' : 'rgba(255,255,255,0.04)',
        justifyContent: 'center', alignItems: 'center',
        borderWidth: isActive ? 2 : 0, borderColor: C.accent,
      }}>
        {isDone ? (
          <FontAwesome name="check" size={12} color="#000" />
        ) : isActive ? (
          <ActivityIndicator size="small" color={C.accent} />
        ) : (
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700' }}>{index + 1}</Text>
        )}
      </View>
      <Text style={{
        color: isDone ? C.accent : isActive ? C.text : C.muted,
        fontSize: 14, fontWeight: isDone || isActive ? '700' : '500',
      }}>
        {stage}
      </Text>
    </Animated.View>
  );
}

// ═══ SKELETON LOADER ═══
function SkeletonCard() {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });
  return (
    <Animated.View style={[styles.skeletonCard, { opacity }]}>
      <View style={{ height: 16, width: '60%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8 }} />
      <View style={{ height: 12, width: '40%', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, marginTop: 8 }} />
      <View style={{ flexDirection: 'row', marginTop: 12, gap: 12 }}>
        <View style={{ height: 10, width: 40, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 5 }} />
        <View style={{ height: 10, width: 40, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 5 }} />
        <View style={{ height: 10, width: 40, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 5 }} />
      </View>
    </Animated.View>
  );
}

// ═══ FOOD RESULT CARD (for manual search) ═══
function FoodCard({ item, onPress, index }: { item: FoodResult; onPress: () => void; index: number }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 250, delay: index * 50, useNativeDriver: true,
    }).start();
  }, []);

  const foodType = detectFoodType(item.name);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.foodCard}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.foodName} numberOfLines={1}>{item.name}</Text>
            {foodType ? (
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{foodType}</Text>
              </View>
            ) : null}
          </View>
          {item.brand ? <Text style={styles.foodBrand} numberOfLines={1}>{item.brand}</Text> : null}
          <View style={styles.macroRow}>
            <View style={styles.macroChip}>
              <FontAwesome name="fire" size={9} color={C.red} />
              <Text style={styles.macroText}>{item.calories} kcal</Text>
            </View>
            <View style={styles.macroChip}>
              <FontAwesome name="bolt" size={9} color={C.green} />
              <Text style={styles.macroText}>{item.protein}g P</Text>
            </View>
            <View style={styles.macroChip}>
              <FontAwesome name="leaf" size={9} color={C.orange} />
              <Text style={styles.macroText}>{item.carbs}g C</Text>
            </View>
            <View style={styles.macroChip}>
              <FontAwesome name="tint" size={9} color={C.blue} />
              <Text style={styles.macroText}>{item.fat}g F</Text>
            </View>
          </View>
        </View>
        <View style={styles.sourceCol}>
          {item.source === 'usda' || item.source === 'custom' ? (
            <View style={[styles.sourceBadge, { backgroundColor: 'rgba(0,230,118,0.12)' }]}>
              <FontAwesome name="shield" size={8} color={C.accent} />
              <Text style={[styles.sourceBadgeText, { color: C.accent }]}>USDA</Text>
            </View>
          ) : item.source === 'ai-vision' ? (
            <View style={[styles.sourceBadge, { backgroundColor: 'rgba(171,71,188,0.12)' }]}>
              <FontAwesome name="magic" size={8} color={C.purple} />
              <Text style={[styles.sourceBadgeText, { color: C.purple }]}>AI</Text>
            </View>
          ) : (
            <View style={[styles.sourceBadge, { backgroundColor: 'rgba(66,165,245,0.12)' }]}>
              <FontAwesome name="users" size={8} color={C.blue} />
              <Text style={[styles.sourceBadgeText, { color: C.blue }]}>OFF</Text>
            </View>
          )}
          <Text style={styles.servingText}>{item.servingSize || '100g'}</Text>
        </View>
        <FontAwesome name="chevron-right" size={12} color={C.muted} style={{ marginLeft: 8 }} />
      </TouchableOpacity>
    </Animated.View>
  );
}

// ═══ CONFIDENCE BADGE SYSTEM ═══
function getConfidenceBadge(conf: number): { label: string; color: string; bg: string; icon: any } {
  const pct = conf <= 1 ? conf * 100 : conf;
  if (pct >= 96) return { label: 'Verified', color: '#1FA463', bg: 'rgba(31,164,99,0.14)', icon: 'check-circle' };
  if (pct >= 90) return { label: 'High Confidence', color: '#4ECDC4', bg: 'rgba(78,205,196,0.14)', icon: 'shield' };
  if (pct >= 80) return { label: 'Needs Confirmation', color: '#60A5FA', bg: 'rgba(96,165,250,0.14)', icon: 'question-circle' };
  return { label: 'Please Verify', color: '#FF6B6B', bg: 'rgba(255,107,107,0.14)', icon: 'exclamation-triangle' };
}

// ═══ HEALTH SCORE (1-100) ═══
function computeHealthScore(f: { calories: number; protein: number; carbs: number; fat: number; fiber: number; sugar?: number }): { score: number; label: string; color: string } {
  const cals = f.calories || 1;
  // Protein density (g per 100 kcal) — higher is better
  const proteinDensity = (f.protein / cals) * 100;
  // Fiber per 100 kcal
  const fiberDensity = ((f.fiber || 0) / cals) * 100;
  // Sugar penalty
  const sugarRatio = ((f.sugar || 0) / cals) * 100;

  let score = 50;
  score += Math.min(25, proteinDensity * 3);      // up to +25 for high protein
  score += Math.min(15, fiberDensity * 5);        // up to +15 for fiber
  score -= Math.min(25, sugarRatio * 2);          // up to -25 for sugar
  score -= Math.min(15, (f.fat / cals) * 100 * 1.2); // fat penalty (mild)
  score = Math.max(1, Math.min(100, Math.round(score)));

  let label = 'Fair', color = '#60A5FA';
  if (score >= 80) { label = 'Excellent'; color = '#1FA463'; }
  else if (score >= 65) { label = 'Good'; color = '#4ECDC4'; }
  else if (score >= 45) { label = 'Fair'; color = '#60A5FA'; }
  else { label = 'Poor'; color = '#FF6B6B'; }
  return { score, label, color };
}

// ═══ AI NUTRITION SUGGESTIONS ═══
function generateSuggestions(t: { calories: number; protein: number; carbs: number; fat: number; fiber: number; sugar?: number }): { text: string; type: 'good' | 'warn' | 'info' }[] {
  const out: { text: string; type: 'good' | 'warn' | 'info' }[] = [];
  if (t.calories <= 0) return out;
  const pCalPct = (t.protein * 4) / t.calories * 100;
  if (pCalPct >= 30) out.push({ text: 'High protein — great for muscle recovery', type: 'good' });
  if (pCalPct >= 25) out.push({ text: 'Good post-workout meal', type: 'good' });
  if (t.fiber < 3 && t.calories > 200) out.push({ text: 'Low fiber — consider adding vegetables', type: 'warn' });
  if ((t.sugar || 0) > 25) out.push({ text: 'High sugar content', type: 'warn' });
  if (t.fiber >= 6) out.push({ text: 'Excellent fiber content', type: 'good' });
  if (pCalPct < 12 && t.calories > 150) out.push({ text: 'Low protein — add a protein source', type: 'warn' });
  if (out.length === 0) out.push({ text: 'Balanced macronutrient profile', type: 'info' });
  return out.slice(0, 3);
}

// ═══ ANIMATED NUMBER COUNTER ═══
function AnimatedNumber({ value, style, duration = 800, decimals = 0 }: { value: number; style?: any; duration?: number; decimals?: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    anim.setValue(0);
    const id = anim.addListener(({ value: v }) => setDisplay(v * value));
    Animated.timing(anim, { toValue: 1, duration, useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [value]);
  return <Text style={style}>{decimals > 0 ? display.toFixed(decimals) : Math.round(display)}</Text>;
}

// ═══ ANIMATED CONFIDENCE RING ═══
function ConfidenceRing({ pct, size = 56, color = C.accent }: { pct: number; size?: number; color?: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }).start();
  }, [pct]);
  // Simple conic-style ring using rotating half-circles is heavy; use a clean
  // bordered badge with animated fill text instead (60fps safe).
  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(pct / 100) * 360}deg`] });
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: color, borderRightColor: 'transparent', borderBottomColor: 'transparent', transform: [{ rotate }] }} />
      <AnimatedNumber value={pct} style={{ color, fontSize: size * 0.28, fontWeight: '900' }} />
    </View>
  );
}

// ═══ ANIMATED MACRO BAR FILL ═══
function AnimatedBar({ pct, color, duration = 800 }: { pct: number; color: string; duration?: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration, useNativeDriver: false }).start();
  }, [pct]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return <Animated.View style={{ height: '100%', width, backgroundColor: color, borderRadius: 3 }} />;
}

// ═══ STAGGERED ENTRANCE WRAPPER (60fps, native driver) ═══
function StaggerCard({ index, children }: { index: number; children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1, duration: 350, delay: Math.min(index * 80, 400), useNativeDriver: true,
    }).start();
  }, []);
  return (
    <Animated.View style={{
      opacity: anim,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
    }}>
      {children}
    </Animated.View>
  );
}

// ═══ MACRO BAR (visual split) ═══
function MacroBar({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const total = protein + carbs + fat;
  if (total === 0) return null;
  const pPct = (protein / total) * 100;
  const cPct = (carbs / total) * 100;
  const fPct = (fat / total) * 100;

  return (
    <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.04)' }}>
      <View style={{ width: `${pPct}%` as any, backgroundColor: '#1FA463', borderRadius: 3 }} />
      <View style={{ width: `${cPct}%` as any, backgroundColor: '#60A5FA' }} />
      <View style={{ width: `${fPct}%` as any, backgroundColor: '#FF6B6B', borderRadius: 3 }} />
    </View>
  );
}

// ═══ SCAN CREDITS BADGE (free: "X left", premium: "Unlimited") ═══
function ScanCreditsBadge({
  usage, type,
}: {
  usage: { subscription: 'free' | 'premium'; food: { remaining: number | null; limit: number | null }; barcode: { remaining: number | null; limit: number | null } } | null;
  type: 'food' | 'barcode';
}) {
  if (!usage) return null;
  const isPremium = usage.subscription === 'premium';
  const data = type === 'food' ? usage.food : usage.barcode;

  if (isPremium) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, backgroundColor: 'rgba(31,164,99,0.16)', borderWidth: 1, borderColor: 'rgba(31,164,99,0.35)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
        <FontAwesome name="star" size={11} color={C.accent} />
        <Text style={{ color: C.accent, fontSize: 12, fontWeight: '800' }}>Unlimited scans  ∞</Text>
      </View>
    );
  }

  const remaining = data.remaining ?? 0;
  const limit = data.limit ?? 0;
  const out = remaining <= 0;
  const low = !out && remaining <= Math.max(1, Math.ceil((limit || 1) * 0.2));
  const color = out ? '#FF6B6B' : low ? '#FFB74D' : '#FFFFFF';
  const bg = out ? 'rgba(255,107,107,0.16)' : low ? 'rgba(255,183,77,0.16)' : 'rgba(255,255,255,0.10)';
  const border = out ? 'rgba(255,107,107,0.4)' : low ? 'rgba(255,183,77,0.4)' : 'rgba(255,255,255,0.18)';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 6, backgroundColor: bg, borderWidth: 1, borderColor: border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
      <FontAwesome name={type === 'food' ? 'camera' : 'barcode'} size={11} color={color} />
      <Text style={{ color, fontSize: 12, fontWeight: '800' }}>
        {out ? `No ${type === 'food' ? 'food' : 'barcode'} scans left today` : `${remaining} of ${limit} ${type === 'food' ? 'food' : 'barcode'} scans left`}
      </Text>
    </View>
  );
}

// ═══ MAIN COMPONENT ═══
export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'barcode' | 'food'>('barcode');
  const toggleAnim = useRef(new Animated.Value(0)).current;

  // Barcode state
  const [isProcessing, setIsProcessing] = useState(false);
  const [isScannerEnabled, setIsScannerEnabled] = useState(true);
  const scanLockRef = useRef(false);
  const alertOpenRef = useRef(false);

  // Food camera + AI state
  const foodCameraRef = useRef<any>(null);
  const [foodScanPhase, setFoodScanPhase] = useState<'camera' | 'analyzing' | 'results'>('camera');
  const [detectedFoods, setDetectedFoods] = useState<DetectedFood[]>([]);
  const [capturedPhotoUri, setCapturedPhotoUri] = useState<string | null>(null);
  const capturedBase64Ref = useRef<string | null>(null);
  const [selectedFoodType, setSelectedFoodType] = useState<string>('homemade');
  const [selectedCookingMethods, setSelectedCookingMethods] = useState<string[]>([]);
  const [analysisStageIdx, setAnalysisStageIdx] = useState(0);
  const [mealDescription, setMealDescription] = useState('');
  const [addingAll, setAddingAll] = useState(false);
  const [aiReasoningData, setAiReasoningData] = useState<AIReasoningData | null>(null);

  // Food search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoodResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentFoods, setRecentFoods] = useState<FoodResult[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showManualSearch, setShowManualSearch] = useState(false);

  // Bottom sheet state (for manual search)
  const [selectedFood, setSelectedFood] = useState<FoodResult | null>(null);
  const [quantity, setQuantity] = useState('100');
  const [selectedUnit, setSelectedUnit] = useState('g');
  const [mealType, setMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('lunch');
  const [adding, setAdding] = useState(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  // Daily scan limit (free tier) — shown when backend returns HTTP 429
  const [limitInfo, setLimitInfo] = useState<{ limit: number; resetAt?: string } | null>(null);

  // Live daily usage (food + barcode) — accurate, backend is source of truth
  const [usage, setUsage] = useState<{
    subscription: 'free' | 'premium';
    food: { remaining: number | null; limit: number | null };
    barcode: { remaining: number | null; limit: number | null };
  } | null>(null);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await getUsageToday();
      const d = res?.data;
      if (!d?.success) return;
      setUsage({
        subscription: d.subscription === 'premium' ? 'premium' : 'free',
        food: { remaining: d.foodScans?.remaining ?? null, limit: d.foodScans?.limit ?? null },
        barcode: { remaining: d.barcodeScans?.remaining ?? null, limit: d.barcodeScans?.limit ?? null },
      });
    } catch (_) {
      // non-fatal — indicator just won't show
    }
  }, []);

  const ANALYSIS_STAGES = ['Capturing image', 'Identifying foods', 'Estimating nutrition', 'Matching database'];
  const COOKING_METHODS = ['Boiled', 'Fried', 'Grilled', 'Steamed', 'Baked', 'Roasted', 'Sauteed', 'Raw'];
  const FOOD_TYPES = ['homemade', 'restaurant', 'packaged'];

  // Auto-detect meal type by time
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) setMealType('breakfast');
    else if (hour >= 11 && hour < 15) setMealType('lunch');
    else if (hour >= 15 && hour < 18) setMealType('snack');
    else setMealType('dinner');
  }, []);

  useEffect(() => { loadRecentFoods(); }, []);
  useEffect(() => { refreshUsage(); }, [refreshUsage]);

  const loadRecentFoods = async () => {
    try {
      const stored = await AsyncStorage.getItem('recent_foods');
      if (stored) setRecentFoods(JSON.parse(stored));
    } catch (_) {}
  };

  const saveToRecent = async (food: FoodResult) => {
    try {
      const updated = [food, ...recentFoods.filter(f => f._id !== food._id)].slice(0, 20);
      setRecentFoods(updated);
      await AsyncStorage.setItem('recent_foods', JSON.stringify(updated));
    } catch (_) {}
  };

  // ── Mode toggle ──
  const switchMode = (newMode: 'barcode' | 'food') => {
    setMode(newMode);
    Animated.spring(toggleAnim, {
      toValue: newMode === 'food' ? 1 : 0,
      useNativeDriver: false, tension: 60, friction: 10,
    }).start();
  };

  const goBackSafe = () => {
    if (router.canGoBack()) { router.back(); return; }
    router.replace('/(tabs)/calories');
  };

  // ── Barcode ──
  const resetScanner = () => {
    scanLockRef.current = false;
    alertOpenRef.current = false;
    setIsProcessing(false);
    setIsScannerEnabled(true);
  };

  const handleBarcodeScanned = async (rawData: string) => {
    if (!isScannerEnabled || isProcessing || scanLockRef.current || alertOpenRef.current) return;
    const normalized = `${rawData || ''}`.trim().replace(/\s+/g, '');
    if (!/^\d{8,14}$/.test(normalized)) {
      Alert.alert('Invalid Barcode', 'Please scan a valid food barcode (8 to 14 digits).', [
        { text: 'Try Again', onPress: resetScanner },
        { text: 'Back', onPress: goBackSafe, style: 'cancel' },
      ]);
      alertOpenRef.current = true;
      return;
    }
    scanLockRef.current = true;
    setIsScannerEnabled(false);
    setIsProcessing(true);
    try {
      router.replace({ pathname: '/food-details', params: { barcode: normalized } });
    } catch {
      Alert.alert('Error', 'Failed to scan barcode.', [
        { text: 'Try Again', onPress: resetScanner },
        { text: 'Back', onPress: goBackSafe, style: 'cancel' },
      ]);
      alertOpenRef.current = true;
      setIsProcessing(false);
    }
  };

  // ── Food search ──
  const handleSearch = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (text.trim().length < 2) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchFoodsByName(text.trim(), 15);
        setSearchResults(res?.data || []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 400);
  }, []);

  // ── Food capture → AI analyze → show results ──
  const handleFoodCapture = async () => {
    if (!foodCameraRef.current) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setFoodScanPhase('analyzing');
      setAnalysisStageIdx(0);

      const photo = await foodCameraRef.current.takePictureAsync({
        quality: 0.5, base64: true, exif: false,
      });

      if (photo.uri) setCapturedPhotoUri(photo.uri);
      let base64Data = photo.base64;
      if (!base64Data && photo.uri) {
        base64Data = await FileSystem.readAsStringAsync(photo.uri, { encoding: 'base64' });
      }
      capturedBase64Ref.current = base64Data || null;

      if (!photo.uri || !base64Data) {
        Alert.alert('Error', 'Could not capture image. Please try again.');
        setFoodScanPhase('camera');
        return;
      }

      // Stage 1: Captured
      setAnalysisStageIdx(1);

      // Stage 2: AI recognition
      const aiRes = await recognizeFood(base64Data, 'image/jpeg', selectedFoodType, selectedCookingMethods);
      const aiData = aiRes?.data;
      setAnalysisStageIdx(2);

      if (aiData?.success && aiData.foods?.length > 0) {
        const confidenceTier = aiData.confidence_tier || 'confirm';
        const alternatives: FoodAlternative[] = (aiData.alternatives || []).map((a: any) => ({
          name: a.name || '',
          normalized_name: a.normalized_name || '',
          confidence: a.confidence || 0,
          dish_type: a.dish_type || '',
          cooking_style: a.cooking_style || '',
          grams: a.grams || 100,
          count: a.count || 1,
          portion: a.portion || '~100g',
          calories: Math.round(a.calories || 0),
          protein: Number((a.protein || 0).toFixed(1)),
          carbs: Number((a.carbs || 0).toFixed(1)),
          fat: Number((a.fat || 0).toFixed(1)),
          fiber: Number((a.fiber || 0).toFixed(1)),
          source: a.source || '',
        }));

        const foods: DetectedFood[] = aiData.foods.map((f: any) => ({
          name: f.name || '',
          normalized_name: f.normalized_name || f.name || '',
          state: f.state || 'general',
          portion: f.portion || '1 serving',
          grams: f.grams || 100,
          confidence: f.confidence || 0.8,
          calories: Math.round(f.calories || 0),
          protein: Number((f.protein || 0).toFixed(1)),
          carbs: Number((f.carbs || 0).toFixed(1)),
          fat: Number((f.fat || 0).toFixed(1)),
          fiber: Number((f.fiber || 0).toFixed(1)),
          sugar: Number((f.sugar || 0).toFixed(1)),
          sodium: Number((f.sodium || 0).toFixed(1)),
          confirmed: confidenceTier === 'auto' || confidenceTier === 'confirm',
          matchedFood: null,
          mealType: mealType,
          // Pipeline v3 fields
          dish_type: f.dish_type || '',
          cooking_style: f.cooking_style || f.state || '',
          visible_ingredients: f.visible_ingredients || [],
          confidence_tier: confidenceTier,
          source: f.source || '',
          alternatives,
          reasoning_adjustment: f.reasoning_adjustment || 0,
          reasoning_explanation: f.reasoning_explanation || [],
          // Portion v2: store per-100g so portion changes recalc instantly (no API)
          per100g: (() => {
            const g = f.grams || 100;
            const m = g > 0 ? 100 / g : 1;
            return {
              calories: (f.calories || 0) * m,
              protein: (f.protein || 0) * m,
              carbs: (f.carbs || 0) * m,
              fat: (f.fat || 0) * m,
              fiber: (f.fiber || 0) * m,
            };
          })(),
          portion_confidence: f.portion_confidence ?? 0.9,
          portion_source: f.portion_source || 'database_default',
          estimated_weight: f.estimated_weight ?? f.grams ?? 100,
          needs_confirmation: f.needs_confirmation ?? false,
          portion_options: f.portion_options || [],
          is_user_modified: false,
        }));

        setDetectedFoods(foods);
        setMealDescription(aiData.meal_description || '');
        setAiReasoningData(aiData.reasoning || null);

        // Update live usage from the authoritative response (exact remaining count)
        setUsage(prev => ({
          subscription: aiData.subscription === 'premium' ? 'premium' : 'free',
          food: {
            remaining: aiData.remainingFoodScans ?? null,
            limit: aiData.dailyLimit ?? null,
          },
          barcode: prev?.barcode ?? { remaining: null, limit: null },
        }));

        // Stage 3: Done
        setAnalysisStageIdx(3);
        await new Promise(r => setTimeout(r, 500));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFoodScanPhase('results');
      } else if (aiData?.quality_issue) {
        Alert.alert('Image Quality Issue', aiData.error || 'Please take a clearer photo of your food.', [
          { text: 'Retake', onPress: () => resetFoodScan() }
        ]);
        setFoodScanPhase('camera');
      } else {
        Alert.alert('Could not identify food', aiData?.error || 'Try manual search or retake.', [
          { text: 'Manual Search', onPress: () => { setShowManualSearch(true); setFoodScanPhase('camera'); } },
          { text: 'Retake', onPress: () => resetFoodScan() },
        ]);
      }
    } catch (err: any) {
      console.warn('[FoodCapture] error:', err?.message);

      // ── Daily scan limit reached (HTTP 429) — show upgrade modal, do NOT retry ──
      if (err?.response?.status === 429 && err?.response?.data?.code === 'DAILY_SCAN_LIMIT') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        setLimitInfo({
          limit: err.response.data.limit ?? 10,
          resetAt: err.response.data.resetAt,
        });
        setFoodScanPhase('camera');
        return;
      }

      const isTimeout = err?.code === 'ECONNABORTED' || err?.message?.includes('timeout');
      const isNetwork = !err?.response && err?.message?.includes('Network');
      
      let title = 'Capture Failed';
      let message = 'Could not process photo. Try again.';
      
      if (isTimeout) {
        title = 'Request Timed Out';
        message = 'AI analysis took too long. Please try again — it usually works on retry.';
      } else if (isNetwork) {
        title = 'Network Error';
        message = 'Cannot reach the server. Make sure you are on the same network.';
      } else if (err?.response?.data?.error) {
        message = err.response.data.error;
      }
      
      Alert.alert(title, message, [
        { text: 'Retry', onPress: () => handleFoodCapture() },
        { text: 'Manual Search', onPress: () => { setShowManualSearch(true); setFoodScanPhase('camera'); } },
        { text: 'Cancel', onPress: () => setFoodScanPhase('camera'), style: 'cancel' },
      ]);
    }
  };

  // ── Toggle cooking method ──
  const toggleCookingMethod = (method: string) => {
    setSelectedCookingMethods(prev =>
      prev.includes(method) ? prev.filter(m => m !== method) : [...prev, method]
    );
  };

  // ── Toggle food confirmed ──
  const toggleFoodConfirmed = (index: number) => {
    Haptics.selectionAsync();
    setDetectedFoods(prev => prev.map((f, i) => i === index ? { ...f, confirmed: !f.confirmed } : f));
  };

  // ── Remove food ──
  const removeDetectedFood = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetectedFoods(prev => prev.filter((_, i) => i !== index));
  };

  // ── Change meal type for a food ──
  const setFoodMealType = (index: number, meal: 'breakfast' | 'lunch' | 'dinner' | 'snack') => {
    setDetectedFoods(prev => prev.map((f, i) => i === index ? { ...f, mealType: meal } : f));
  };

  // ── Portion confirmation sheet state ──
  const [portionSheetIndex, setPortionSheetIndex] = useState<number | null>(null);
  const portionSheetAnim = useRef(new Animated.Value(0)).current;

  // ── Progressive disclosure: which card has its "AI details" expanded ──
  const [expandedDetailIdx, setExpandedDetailIdx] = useState<number | null>(null);
  const toggleDetail = (idx: number) => {
    Haptics.selectionAsync();
    setExpandedDetailIdx(prev => (prev === idx ? null : idx));
  };

  const openPortionSheet = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPortionSheetIndex(index);
    Animated.spring(portionSheetAnim, { toValue: 1, useNativeDriver: true, tension: 55, friction: 9 }).start();
  };

  const closePortionSheet = () => {
    Animated.timing(portionSheetAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setPortionSheetIndex(null));
  };

  // ── Apply a new weight: recalc nutrition from per100g (no API), store learning ──
  // ── Apply a new weight: LOCAL ONLY. Recalc nutrition from per100g.
  //    NO API call here — portion learning is persisted once at Log time.
  const applyPortionWeight = (index: number, newGrams: number) => {
    const g = Math.max(1, Math.round(newGrams));
    Haptics.selectionAsync();
    setDetectedFoods(prev => prev.map((f, i) => {
      if (i !== index) return f;
      const per = f.per100g || { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
      const m = g / 100;
      return {
        ...f,
        grams: g,
        calories: Math.round(per.calories * m),
        protein: Number((per.protein * m).toFixed(1)),
        carbs: Number((per.carbs * m).toFixed(1)),
        fat: Number((per.fat * m).toFixed(1)),
        fiber: Number((per.fiber * m).toFixed(1)),
        portion_source: 'user_selected',
        portion_confidence: 0.99,
        needs_confirmation: false,
        is_user_modified: true,
      };
    }));
  };

  // ── Select alternative (swap primary with alternative) ──
  const selectAlternative = (foodIndex: number, alt: FoodAlternative) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDetectedFoods(prev => prev.map((f, i) => {
      if (i !== foodIndex) return f;
      // Send feedback for learning
      submitFoodFeedback({
        aiPrediction: f.name,
        userCorrection: alt.name,
        confidence: f.confidence,
        rawVisionText: '',
        detectedIngredients: f.visible_ingredients || [],
        visualCues: [],
        wasAlternativeSelected: true,
      }).catch(() => {});
      // Swap
      return {
        ...f,
        name: alt.name,
        normalized_name: alt.normalized_name,
        state: alt.cooking_style || f.state,
        portion: alt.portion,
        grams: alt.grams,
        confidence: alt.confidence,
        calories: alt.calories,
        protein: alt.protein,
        carbs: alt.carbs,
        fat: alt.fat,
        fiber: alt.fiber,
        dish_type: alt.dish_type,
        cooking_style: alt.cooking_style,
        source: alt.source,
        confirmed: true,
      };
    }));
  };

  // ── Add single food to log ──
  const handleAddSingleFood = async (food: DetectedFood, index: number) => {
    if (food.calories <= 0) {
      Alert.alert('No nutrition data', 'This food has no calorie information. Try searching manually.');
      return;
    }

    try {
      // Create a temporary food entry or use smart search to find best match
      const searchRes = await smartFoodSearch(
        [{ name: food.name, normalized_name: food.normalized_name, state: food.state, calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat, fiber: food.fiber, grams: food.grams, portion: food.portion }],
        selectedCookingMethods
      );

      const bestMatch = searchRes?.data?.results?.[0]?.bestMatch;
      if (bestMatch?._id && !bestMatch._id.startsWith('ai_') && !bestMatch._id.startsWith('fallback_')) {
        const servingMultiplier = (food.grams || 100) / 100;
        const estimatedWeight = food.estimated_weight ?? food.grams;
        const selectedWeight = food.grams;
        await addFoodToLog({
          foodId: bestMatch._id,
          quantity: servingMultiplier,
          meal: food.mealType,
          mealType: food.mealType,
          servingText: food.portion,
          servingUnit: 'g',
          // ── Portion data: backend saves learning if estimated != selected ──
          foodName: food.normalized_name || food.name,
          estimatedWeight,
          selectedWeight,
          userModifiedWeight: !!food.is_user_modified,
        });

        trackFoodMemory({
          foodName: food.name,
          foodId: bestMatch._id,
          quantity: 1,
          unit: 'serving',
          mealType: food.mealType,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          source: 'scan',
          aiDetectedName: food.name,
        }).catch(() => {});

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        removeDetectedFood(index);

        if (detectedFoods.length <= 1) {
          Alert.alert('Added!', `${food.name} logged.`, [{ text: 'OK', onPress: goBackSafe }]);
        }
      } else {
        // Navigate to food-details for manual add
        router.push({
          pathname: '/food-details',
          params: { foodData: JSON.stringify(bestMatch || { name: food.name, calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat }), source: 'ai-vision' },
        });
      }
    } catch (err) {
      console.warn('[AddSingle] error:', err);
      Alert.alert('Error', 'Failed to add food. Try manual search.');
    }
  };

  // ── Log ALL confirmed foods (primary action) ──
  const [loggingAll, setLoggingAll] = useState(false);
  const handleLogAll = async () => {
    const confirmed = detectedFoods.filter(f => f.confirmed && f.calories > 0);
    if (confirmed.length === 0) {
      Alert.alert('Nothing to log', 'Select at least one food with nutrition data.');
      return;
    }
    setLoggingAll(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    let logged = 0;
    try {
      for (const food of confirmed) {
        try {
          const searchRes = await smartFoodSearch(
            [{ name: food.name, normalized_name: food.normalized_name, state: food.state, calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat, fiber: food.fiber, grams: food.grams, portion: food.portion }],
            selectedCookingMethods
          );
          const bestMatch = searchRes?.data?.results?.[0]?.bestMatch;
          if (bestMatch?._id && !bestMatch._id.startsWith('ai_') && !bestMatch._id.startsWith('fallback_')) {
            await addFoodToLog({
              foodId: bestMatch._id,
              quantity: (food.grams || 100) / 100,
              meal: food.mealType, mealType: food.mealType,
              servingText: food.portion, servingUnit: 'g',
              foodName: food.normalized_name || food.name,
              estimatedWeight: food.estimated_weight ?? food.grams,
              selectedWeight: food.grams,
              userModifiedWeight: !!food.is_user_modified,
            });
            trackFoodMemory({
              foodName: food.name, foodId: bestMatch._id, quantity: 1, unit: 'serving',
              mealType: food.mealType, calories: food.calories, protein: food.protein,
              carbs: food.carbs, fat: food.fat, source: 'scan', aiDetectedName: food.name,
            }).catch(() => {});
            logged++;
          }
        } catch (e) { console.warn('[LogAll] item failed:', e); }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (logged > 0) {
        Alert.alert('Logged!', `${logged} food${logged !== 1 ? 's' : ''} added to ${detectedFoods[0]?.mealType || 'your log'}.`, [
          { text: 'Done', onPress: goBackSafe },
        ]);
      } else {
        Alert.alert('Could not log', 'No exact database match found. Try editing the food manually.');
      }
    } finally {
      setLoggingAll(false);
    }
  };

  // ── Set meal type for ALL foods at once (Hick's Law: one decision) ──
  const setAllMealType = (m: 'breakfast' | 'lunch' | 'dinner' | 'snack') => {
    Haptics.selectionAsync();
    setMealType(m);
    setDetectedFoods(prev => prev.map(f => ({ ...f, mealType: m })));
  };

  // ── Reset ──
  const resetFoodScan = () => {
    setFoodScanPhase('camera');
    setDetectedFoods([]);
    setSearchResults([]);
    setShowManualSearch(false);
    setCapturedPhotoUri(null);
    capturedBase64Ref.current = null;
    setSelectedCookingMethods([]);
    setAnalysisStageIdx(0);
    setMealDescription('');
  };

  // ── Bottom sheet (manual search) ──
  const openFoodDetail = (food: FoodResult) => {
    setSelectedFood(food);
    setQuantity('100');
    setSelectedUnit('g');
    Animated.spring(sheetAnim, { toValue: 1, useNativeDriver: true, tension: 50, friction: 9 }).start();
    saveToRecent(food);
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setSelectedFood(null));
  };

  const calculatedNutrition = useMemo(() => {
    if (!selectedFood) return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, grams: 0 };
    const qty = parseFloat(quantity) || 0;
    let grams = qty;
    if (selectedUnit !== 'g' && selectedUnit !== 'ml') {
      const conv = getGramsPerUnit(selectedFood.name, selectedUnit);
      grams = conv ? qty * conv : qty;
    }
    const mult = grams / 100;
    return {
      calories: Math.round((selectedFood.calories || 0) * mult),
      protein: Number(((selectedFood.protein || 0) * mult).toFixed(1)),
      carbs: Number(((selectedFood.carbs || 0) * mult).toFixed(1)),
      fat: Number(((selectedFood.fat || 0) * mult).toFixed(1)),
      fiber: Number(((selectedFood.fiber || 0) * mult).toFixed(1)),
      grams: Math.round(grams),
    };
  }, [selectedFood, quantity, selectedUnit]);

  const unitOptions = useMemo(() => selectedFood ? getUnitsForFood(selectedFood.name) : ['g'], [selectedFood]);

  const handleAddMeal = async () => {
    if (!selectedFood?._id || !calculatedNutrition.grams) return;
    setAdding(true);
    try {
      const servingMultiplier = (calculatedNutrition.grams || 100) / 100;
      await addFoodToLog({
        foodId: selectedFood._id,
        quantity: servingMultiplier,
        meal: mealType,
        mealType,
        servingText: `${quantity}${selectedUnit}`,
        servingUnit: selectedUnit === 'ml' ? 'ml' : 'g',
      });
      closeSheet();
      Alert.alert('Added!', `${selectedFood.name} logged to ${mealType}.`, [
        { text: 'OK', onPress: goBackSafe },
        { text: 'Add More', onPress: () => {} },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to add food to log.');
    } finally {
      setAdding(false);
    }
  };

  // ── Totals for results view ──
  const confirmedTotals = useMemo(() => {
    const confirmed = detectedFoods.filter(f => f.confirmed);
    const avgConf = confirmed.length
      ? confirmed.reduce((s, f) => s + (f.confidence <= 1 ? f.confidence * 100 : f.confidence), 0) / confirmed.length
      : 0;
    return {
      calories: confirmed.reduce((s, f) => s + f.calories, 0),
      protein: confirmed.reduce((s, f) => s + f.protein, 0),
      carbs: confirmed.reduce((s, f) => s + f.carbs, 0),
      fat: confirmed.reduce((s, f) => s + f.fat, 0),
      fiber: confirmed.reduce((s, f) => s + (f.fiber || 0), 0),
      sugar: confirmed.reduce((s, f) => s + (f.sugar || 0), 0),
      sodium: confirmed.reduce((s, f) => s + (f.sodium || 0), 0),
      count: confirmed.length,
      avgConfidence: Math.round(avgConf),
    };
  }, [detectedFoods]);

  // Health score + suggestions for the whole meal
  const mealHealth = useMemo(() => computeHealthScore(confirmedTotals), [confirmedTotals]);
  const mealSuggestions = useMemo(() => generateSuggestions(confirmedTotals), [confirmedTotals]);

  // Recommended meal type based on time of day (Stage 9)
  const recommendedMeal = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return { meal: 'breakfast', conf: 92 };
    if (hour >= 11 && hour < 15) return { meal: 'lunch', conf: 90 };
    if (hour >= 15 && hour < 18) return { meal: 'snack', conf: 80 };
    return { meal: 'dinner', conf: 88 };
  }, []);

  const SUGGESTIONS = ['Cooked rice', 'Chicken breast', 'Boiled egg', 'Paneer', 'Oats', 'Dal', 'Banana', 'Whey protein'];

  // ── Permission ──
  if (!permission || !permission.granted) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <View style={styles.permissionContent}>
          <FontAwesome name="camera" size={64} color="#9ca3af" />
          <Text style={styles.permissionTitle}>Camera permission required</Text>
          <Text style={styles.permissionSubtitle}>Allow camera access to scan food barcodes.</Text>
          <TouchableOpacity style={styles.allowButton} onPress={requestPermission}>
            <Text style={styles.allowButtonText}>Allow Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backButton} onPress={goBackSafe}>
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const toggleLeft = toggleAnim.interpolate({ inputRange: [0, 1], outputRange: [3, (SCREEN_W - 80) / 2 - 3] });

  return (
    <View style={styles.container}>
      {/* ═══ BARCODE MODE ═══ */}
      {mode === 'barcode' ? (
        <View style={{ flex: 1 }}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            onBarcodeScanned={isScannerEnabled && !isProcessing ? ({ data }) => handleBarcodeScanned(data) : undefined}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
          />
          <View style={[styles.overlay, { paddingTop: insets.top + 14 }]}>
            <View style={styles.topRow}>
              <TouchableOpacity style={styles.iconButton} onPress={goBackSafe}>
                <FontAwesome name="chevron-left" size={16} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.title}>Scan Barcode</Text>
            </View>
            {/* Live scans-left indicator (barcode) */}
            <View style={{ marginTop: 10 }}>
              <ScanCreditsBadge usage={usage} type="barcode" />
            </View>
            <View style={styles.centerContent}>
              <View style={styles.scanFrame}>
                <View style={[styles.corner, styles.cornerTopLeft]} />
                <View style={[styles.corner, styles.cornerTopRight]} />
                <View style={[styles.corner, styles.cornerBottomLeft]} />
                <View style={[styles.corner, styles.cornerBottomRight]} />
              </View>
              <Text style={styles.frameText}>Place barcode inside the frame</Text>
            </View>
            <View style={{ height: 60 }} />
          </View>
          {isProcessing && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.processingText}>Processing...</Text>
            </View>
          )}
        </View>
      ) : (
        /* ═══ FOOD MODE ═══ */
        <View style={{ flex: 1, backgroundColor: C.bg }}>
          {/* ── PHASE: CAMERA ── */}
          {foodScanPhase === 'camera' && !showManualSearch && (
            <View style={{ flex: 1 }}>
              <CameraView ref={foodCameraRef} style={StyleSheet.absoluteFillObject} />
              <View style={[styles.overlay, { paddingTop: insets.top + 14 }]}>
                <View style={styles.topRow}>
                  <TouchableOpacity style={styles.iconButton} onPress={goBackSafe}>
                    <FontAwesome name="chevron-left" size={16} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.title}>Scan Food</Text>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity style={[styles.iconButton, { backgroundColor: 'rgba(255,255,255,0.15)' }]} onPress={() => setShowManualSearch(true)}>
                    <FontAwesome name="search" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>

                {/* Live scans-left indicator (food) */}
                <View style={{ marginTop: 10 }}>
                  <ScanCreditsBadge usage={usage} type="food" />
                </View>

                <View style={styles.centerContent}>
                  <View style={[styles.scanFrame, { borderRadius: 999, width: 220, height: 220 }]}>
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 3, borderColor: 'rgba(31,164,99,0.5)' }} />
                  </View>
                  <Text style={[styles.frameText, { marginTop: 18 }]}>Point camera at your food</Text>
                </View>

                {/* Pre-capture context: Food type */}
                <View style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
                    {FOOD_TYPES.map(t => (
                      <TouchableOpacity
                        key={t}
                        onPress={() => setSelectedFoodType(t)}
                        style={{
                          paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                          backgroundColor: selectedFoodType === t ? C.accent : 'rgba(255,255,255,0.08)',
                          borderWidth: 1, borderColor: selectedFoodType === t ? C.accent : 'rgba(255,255,255,0.1)',
                        }}
                      >
                        <Text style={{ color: selectedFoodType === t ? '#000' : C.text, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Cooking methods */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}>
                    {COOKING_METHODS.map(m => (
                      <TouchableOpacity
                        key={m}
                        onPress={() => toggleCookingMethod(m.toLowerCase())}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
                          backgroundColor: selectedCookingMethods.includes(m.toLowerCase()) ? 'rgba(31,164,99,0.2)' : 'rgba(255,255,255,0.05)',
                          borderWidth: 1, borderColor: selectedCookingMethods.includes(m.toLowerCase()) ? 'rgba(31,164,99,0.4)' : 'rgba(255,255,255,0.08)',
                        }}
                      >
                        <Text style={{
                          color: selectedCookingMethods.includes(m.toLowerCase()) ? C.accent : C.muted,
                          fontSize: 11, fontWeight: '600',
                        }}>{m}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {/* Capture button */}
                  <View style={{ alignItems: 'center', marginTop: 16, marginBottom: 60 }}>
                    <TouchableOpacity onPress={handleFoodCapture} activeOpacity={0.7}
                      style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.25)' }}
                    >
                      <FontAwesome name="camera" size={22} color="#000" />
                    </TouchableOpacity>
                    <Text style={{ color: C.muted, fontSize: 11, marginTop: 6, fontWeight: '600' }}>Tap to scan</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* ── PHASE: ANALYZING ── */}
          {foodScanPhase === 'analyzing' && (
            <View style={{ flex: 1, backgroundColor: C.bg }}>
              {capturedPhotoUri && (
                <Image source={{ uri: capturedPhotoUri }} style={{ width: '100%', height: SCREEN_H * 0.35, opacity: 0.25 }} resizeMode="cover" blurRadius={15} />
              )}
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                {/* Pulse rings */}
                <View style={{ width: 100, height: 100, justifyContent: 'center', alignItems: 'center', marginBottom: 30 }}>
                  <PulseRing size={100} />
                  <PulseRing size={100} />
                  <View style={{
                    width: 70, height: 70, borderRadius: 35,
                    backgroundColor: 'rgba(31,164,99,0.15)', justifyContent: 'center', alignItems: 'center',
                    borderWidth: 2, borderColor: 'rgba(31,164,99,0.3)',
                  }}>
                    <FontAwesome name="magic" size={24} color={C.accent} />
                  </View>
                </View>

                {/* Progressive stages */}
                <View style={{ alignItems: 'flex-start', paddingHorizontal: 50 }}>
                  {ANALYSIS_STAGES.map((stage, idx) => (
                    <AnalyzingStage
                      key={stage}
                      stage={stage}
                      index={idx}
                      isActive={idx === analysisStageIdx}
                      isDone={idx < analysisStageIdx}
                    />
                  ))}
                </View>

                <Text style={{ color: C.muted, fontSize: 11, marginTop: 16, textAlign: 'center', paddingHorizontal: 50 }}>
                  AI is analyzing your meal using advanced vision recognition
                </Text>
              </View>
            </View>
          )}

          {/* ── PHASE: RESULTS (unified confirm + nutrition) ── */}
          {foodScanPhase === 'results' && (
            <View style={{ flex: 1, backgroundColor: C.bg }}>
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 8 }}>
                <TouchableOpacity onPress={resetFoodScan} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center' }}>
                  <FontAwesome name="chevron-left" size={14} color={C.text} />
                </TouchableOpacity>
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 }}>Scan Results</Text>
                <TouchableOpacity onPress={() => setShowManualSearch(true)} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center' }}>
                  <FontAwesome name="search" size={14} color={C.text} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={{ paddingHorizontal: 16, paddingBottom: 96 + Math.max(insets.bottom, 12) }}>

                  {/* ── Captured Photo ── */}
                  {capturedPhotoUri && (
                    <View style={{ height: 180, borderRadius: 20, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: C.cardBorder }}>
                      <Image source={{ uri: capturedPhotoUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      {/* Gradient overlay at bottom */}
                      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, backgroundColor: 'rgba(0,0,0,0.5)' }} />
                      {/* AI Scan badge */}
                      <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(31,164,99,0.9)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, gap: 5 }}>
                        <FontAwesome name="magic" size={10} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>AI Scan</Text>
                      </View>
                      {/* Detected items overlay — plain language */}
                      {aiReasoningData?.objects_detected && aiReasoningData.objects_detected.length > 0 && (
                        <View style={{ position: 'absolute', top: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, maxWidth: '70%' }}>
                          {aiReasoningData.objects_detected.slice(0, 3).map((obj, i) => (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: i < Math.min(aiReasoningData.objects_detected.length, 3) - 1 ? 3 : 0 }}>
                              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#fff' }} />
                              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
                                {obj.name}{obj.count > 1 ? ` ×${obj.count}` : ''}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                      
                      {/* Food count badge */}
                      <View style={{ position: 'absolute', bottom: 12, left: 14 }}>
                        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
                          {detectedFoods.length} food{detectedFoods.length !== 1 ? 's' : ''} detected
                        </Text>
                        {mealDescription ? <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 }}>{mealDescription}</Text> : null}
                      </View>
                    </View>
                  )}

                  {/* ══ HERO SUMMARY CARD ══ */}
                  <View style={{ backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.cardBorder, padding: 18, marginBottom: 16, overflow: 'hidden' }}>
                    {/* Accent glow */}
                    <View style={{ position: 'absolute', top: -40, right: -40, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(31,164,99,0.06)' }} />

                    {/* Top row: calories + confidence ring */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                          <AnimatedNumber value={confirmedTotals.calories} style={{ color: C.text, fontSize: 40, fontWeight: '900', letterSpacing: -1.5 }} />
                          <Text style={{ color: C.muted, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>kcal</Text>
                        </View>
                        <Text style={{ color: C.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: -2 }}>TOTAL CALORIES</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.muted }} />
                          <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '600' }}>
                            {confirmedTotals.count} food{confirmedTotals.count !== 1 ? 's' : ''} detected
                          </Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'center' }}>
                        <ConfidenceRing pct={confirmedTotals.avgConfidence} color={getConfidenceBadge(confirmedTotals.avgConfidence).color} />
                        <Text style={{ color: C.muted, fontSize: 8, fontWeight: '700', letterSpacing: 0.5, marginTop: 4 }}>CONFIDENCE</Text>
                      </View>
                    </View>

                    {/* Macro bars (animated fill) */}
                    {[
                      { label: 'Protein', value: confirmedTotals.protein, color: '#1FA463', max: 50 },
                      { label: 'Carbs', value: confirmedTotals.carbs, color: '#60A5FA', max: 100 },
                      { label: 'Fat', value: confirmedTotals.fat, color: '#FF6B6B', max: 50 },
                    ].map(m => (
                      <View key={m.label} style={{ marginBottom: 10 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '600' }}>{m.label}</Text>
                          <Text style={{ color: m.color, fontSize: 12, fontWeight: '800' }}>{m.value.toFixed(1)}g</Text>
                        </View>
                        <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                          <AnimatedBar pct={Math.min(100, (m.value / m.max) * 100)} color={m.color} />
                        </View>
                      </View>
                    ))}

                    {/* Micro row: fiber / sugar / sodium */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: C.text, fontSize: 13, fontWeight: '800' }}>{confirmedTotals.fiber.toFixed(1)}g</Text>
                        <Text style={{ color: C.muted, fontSize: 8, fontWeight: '700', marginTop: 1 }}>FIBER</Text>
                      </View>
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: C.text, fontSize: 13, fontWeight: '800' }}>{confirmedTotals.sugar.toFixed(1)}g</Text>
                        <Text style={{ color: C.muted, fontSize: 8, fontWeight: '700', marginTop: 1 }}>SUGAR</Text>
                      </View>
                      {confirmedTotals.sodium > 0 && (
                        <View style={{ alignItems: 'center', flex: 1 }}>
                          <Text style={{ color: C.text, fontSize: 13, fontWeight: '800' }}>{Math.round(confirmedTotals.sodium)}mg</Text>
                          <Text style={{ color: C.muted, fontSize: 8, fontWeight: '700', marginTop: 1 }}>SODIUM</Text>
                        </View>
                      )}
                      <View style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: mealHealth.color, fontSize: 13, fontWeight: '800' }}>{mealHealth.score}</Text>
                        <Text style={{ color: C.muted, fontSize: 8, fontWeight: '700', marginTop: 1 }}>HEALTH</Text>
                      </View>
                    </View>
                  </View>

                  {/* ══ AI SUGGESTIONS ══ */}
                  {mealSuggestions.length > 0 && confirmedTotals.count > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                      {mealSuggestions.map((s, i) => (
                        <View key={i} style={{
                          flexDirection: 'row', alignItems: 'center', gap: 5,
                          backgroundColor: s.type === 'good' ? 'rgba(31,164,99,0.10)' : s.type === 'warn' ? 'rgba(255,107,107,0.10)' : 'rgba(96,165,250,0.10)',
                          borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
                          borderWidth: 1, borderColor: s.type === 'good' ? 'rgba(31,164,99,0.15)' : s.type === 'warn' ? 'rgba(255,107,107,0.15)' : 'rgba(96,165,250,0.15)',
                        }}>
                          <FontAwesome name={s.type === 'good' ? 'check' : s.type === 'warn' ? 'exclamation' : 'info'} size={9} color={s.type === 'good' ? '#1FA463' : s.type === 'warn' ? '#FF6B6B' : '#60A5FA'} />
                          <Text style={{ color: s.type === 'good' ? '#1FA463' : s.type === 'warn' ? '#FF6B6B' : '#60A5FA', fontSize: 11, fontWeight: '600' }}>{s.text}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* ── ONE meal selector for the whole scan (Hick's Law) ── */}
                  {confirmedTotals.count > 0 && (
                    <View style={{ marginBottom: 16 }}>
                      <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 }}>ADD TO MEAL</Text>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map(m => {
                          const active = mealType === m;
                          return (
                            <TouchableOpacity
                              key={m}
                              onPress={() => setAllMealType(m)}
                              style={{
                                flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 14,
                                backgroundColor: active ? C.accent : 'rgba(255,255,255,0.04)',
                                borderWidth: 1.5, borderColor: active ? C.accent : 'rgba(255,255,255,0.06)',
                              }}
                            >
                              <Text style={{ color: active ? '#000' : C.subtext, fontSize: 12, fontWeight: '800' }}>
                                {m.charAt(0).toUpperCase() + m.slice(1)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  {/* ── Detected Foods ── */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>DETECTED ITEMS</Text>
                    <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600' }}>
                      {detectedFoods.filter(f => f.confirmed).length}/{detectedFoods.length} selected
                    </Text>
                  </View>

                  {detectedFoods.map((food, idx) => {
                    const confPct = Math.round(food.confidence <= 1 ? food.confidence * 100 : food.confidence);
                    const badge = getConfidenceBadge(confPct);
                    const confColor = badge.color;
                    const count = (food as any).count || 1;
                    const perUnit = count > 1 ? Math.round(food.grams / count) : Math.round(food.grams);

                    return (
                      <StaggerCard key={idx} index={idx}>
                      <View style={{
                        backgroundColor: C.card,
                        borderRadius: 20, padding: 16, marginBottom: 12,
                        borderWidth: 1.5, borderColor: food.confirmed ? 'rgba(31,164,99,0.35)' : C.cardBorder,
                      }}>
                        {/* Top row: checkbox + name + badges */}
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                          <TouchableOpacity onPress={() => toggleFoodConfirmed(idx)} style={{ marginRight: 12, marginTop: 2 }}>
                            <View style={{
                              width: 28, height: 28, borderRadius: 14,
                              backgroundColor: food.confirmed ? C.accent : 'rgba(255,255,255,0.04)',
                              borderWidth: 2, borderColor: food.confirmed ? C.accent : 'rgba(255,255,255,0.12)',
                              justifyContent: 'center', alignItems: 'center',
                            }}>
                              {food.confirmed && <FontAwesome name="check" size={13} color="#000" />}
                            </View>
                          </TouchableOpacity>

                          <View style={{ flex: 1 }}>
                            <Text style={{ color: C.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 }}>{food.name}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                              {/* Count & weight */}
                              {count > 1 ? (
                                <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                  <Text style={{ color: C.accent, fontSize: 12, fontWeight: '800' }}>{count}×</Text>
                                  <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '600' }}>{perUnit}g each</Text>
                                  <Text style={{ color: C.muted, fontSize: 10 }}>=</Text>
                                  <Text style={{ color: C.text, fontSize: 11, fontWeight: '700' }}>{Math.round(food.grams)}g</Text>
                                </View>
                              ) : (
                                <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                                  <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '600' }}>{Math.round(food.grams)}g</Text>
                                </View>
                              )}
                              {/* Cooking state badge */}
                              {food.state !== 'general' && (
                                <View style={{ backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>
                                  <Text style={{ color: C.accent, fontSize: 10, fontWeight: '700' }}>{food.state}</Text>
                                </View>
                              )}
                              {/* Change Portion (Stage 10) */}
                              <TouchableOpacity
                                onPress={() => openPortionSheet(idx)}
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: food.needs_confirmation ? 'rgba(255,167,38,0.14)' : 'rgba(255,255,255,0.06)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: food.needs_confirmation ? 1 : 0, borderColor: 'rgba(255,167,38,0.3)' }}
                              >
                                <FontAwesome name="pencil" size={8} color={food.needs_confirmation ? C.orange : C.subtext} />
                                <Text style={{ color: food.needs_confirmation ? C.orange : C.subtext, fontSize: 10, fontWeight: '700' }}>
                                  {food.needs_confirmation ? 'Confirm portion' : 'Change portion'}
                                </Text>
                              </TouchableOpacity>
                            </View>
                          </View>

                          {/* Confidence badge + remove */}
                          <View style={{ alignItems: 'flex-end', gap: 6 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: badge.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }}>
                              <FontAwesome name={badge.icon} size={9} color={confColor} />
                              <Text style={{ color: confColor, fontSize: 10, fontWeight: '800' }}>{confPct}%</Text>
                            </View>
                            <Text style={{ color: confColor, fontSize: 8, fontWeight: '700' }}>{badge.label}</Text>
                            <TouchableOpacity onPress={() => removeDetectedFood(idx)} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,107,107,0.08)', justifyContent: 'center', alignItems: 'center' }}>
                              <FontAwesome name="times" size={10} color="rgba(255,107,107,0.6)" />
                            </TouchableOpacity>
                          </View>
                        </View>

                        {/* ── Nutrition Grid ── */}
                        <View style={{ marginTop: 14, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                            <View style={{ alignItems: 'center', flex: 1 }}>
                              <Text style={{ color: C.red, fontSize: 20, fontWeight: '900' }}>{food.calories}</Text>
                              <Text style={{ color: C.muted, fontSize: 8, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 }}>KCAL</Text>
                            </View>
                            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                            <View style={{ alignItems: 'center', flex: 1 }}>
                              <Text style={{ color: '#1FA463', fontSize: 15, fontWeight: '800' }}>{food.protein}g</Text>
                              <Text style={{ color: C.muted, fontSize: 8, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 }}>PROTEIN</Text>
                            </View>
                            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                            <View style={{ alignItems: 'center', flex: 1 }}>
                              <Text style={{ color: '#60A5FA', fontSize: 15, fontWeight: '800' }}>{food.carbs}g</Text>
                              <Text style={{ color: C.muted, fontSize: 8, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 }}>CARBS</Text>
                            </View>
                            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
                            <View style={{ alignItems: 'center', flex: 1 }}>
                              <Text style={{ color: '#FF6B6B', fontSize: 15, fontWeight: '800' }}>{food.fat}g</Text>
                              <Text style={{ color: C.muted, fontSize: 8, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 }}>FAT</Text>
                            </View>
                          </View>
                          <MacroBar protein={food.protein} carbs={food.carbs} fat={food.fat} />
                          {/* Per-unit info */}
                          {count > 1 && food.calories > 0 && (
                            <Text style={{ color: C.muted, fontSize: 9, textAlign: 'center', marginTop: 8, fontStyle: 'italic' }}>
                              {Math.round(food.calories / count)} cal × {count} = {food.calories} cal total
                            </Text>
                          )}
                        </View>

                        {/* ── Source + Ingredients (only when expanded) ── */}
                        {expandedDetailIdx === idx && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                          {food.source && food.source !== 'unknown' && (
                            <View style={{
                              flexDirection: 'row', alignItems: 'center', gap: 3,
                              backgroundColor: food.source === 'getfit' ? 'rgba(31,164,99,0.10)' : food.source === 'usda' ? 'rgba(0,230,118,0.10)' : 'rgba(255,152,0,0.10)',
                              borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
                            }}>
                              <FontAwesome name="check-circle" size={8} color={food.source === 'getfit' ? C.accent : food.source === 'usda' ? '#00E676' : '#FF9800'} />
                              <Text style={{ color: food.source === 'getfit' ? C.accent : food.source === 'usda' ? '#00E676' : '#FF9800', fontSize: 9, fontWeight: '800' }}>
                                {food.source === 'getfit' ? 'GetFit DB' : food.source === 'usda' ? 'USDA' : food.source === 'openfoodfacts' ? 'OFF' : food.source.toUpperCase()}
                              </Text>
                            </View>
                          )}
                          {food.dish_type && food.dish_type !== 'ingredient' && (
                            <View style={{ backgroundColor: 'rgba(156,39,176,0.10)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>
                              <Text style={{ color: '#CE93D8', fontSize: 9, fontWeight: '700' }}>{food.dish_type}</Text>
                            </View>
                          )}
                          {food.cooking_style && food.cooking_style !== 'general' && (
                            <View style={{ backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>
                              <Text style={{ color: C.accent, fontSize: 9, fontWeight: '700' }}>{food.cooking_style}</Text>
                            </View>
                          )}
                          {(food.visible_ingredients || []).slice(0, 4).map((ing, ii) => (
                            <View key={ii} style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 }}>
                              <Text style={{ color: C.subtext, fontSize: 9, fontWeight: '600' }}>{ing}</Text>
                            </View>
                          ))}
                        </View>
                        )}

                        {/* ── AI Explanation Timeline (collapsed by default) ── */}
                        {expandedDetailIdx === idx && ((food.reasoning_explanation && food.reasoning_explanation.length > 0) || (food.visible_ingredients && food.visible_ingredients.length > 0)) && (
                          <View style={{ marginTop: 12, backgroundColor: 'rgba(31,164,99,0.05)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(31,164,99,0.12)' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                              <FontAwesome name="magic" size={11} color={C.accent} />
                              <Text style={{ color: C.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>HOW AI IDENTIFIED THIS</Text>
                            </View>

                            {/* Step 1: Vision detected */}
                            {food.visible_ingredients && food.visible_ingredients.length > 0 && (
                              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                                <View style={{ alignItems: 'center' }}>
                                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(66,165,245,0.15)', justifyContent: 'center', alignItems: 'center' }}>
                                    <FontAwesome name="eye" size={10} color={C.blue} />
                                  </View>
                                  <View style={{ width: 1, flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 2 }} />
                                </View>
                                <View style={{ flex: 1, paddingBottom: 4 }}>
                                  <Text style={{ color: C.text, fontSize: 11, fontWeight: '700', marginBottom: 3 }}>AI Vision detected</Text>
                                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                                    {food.visible_ingredients.slice(0, 5).map((ing, ii) => (
                                      <View key={ii} style={{ backgroundColor: 'rgba(66,165,245,0.10)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                        <Text style={{ color: '#90CAF9', fontSize: 10, fontWeight: '600' }}>{ing}</Text>
                                      </View>
                                    ))}
                                  </View>
                                </View>
                              </View>
                            )}

                            {/* Step 2: Reasoning (matched / rejected) */}
                            {food.reasoning_explanation && food.reasoning_explanation.length > 0 && (
                              <View style={{ flexDirection: 'row', gap: 10 }}>
                                <View style={{ alignItems: 'center' }}>
                                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(31,164,99,0.15)', justifyContent: 'center', alignItems: 'center' }}>
                                    <FontAwesome name="check" size={10} color={C.accent} />
                                  </View>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: C.text, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>
                                    Matched: {food.name} {food.cooking_style && food.cooking_style !== 'general' ? `(${food.cooking_style})` : ''}
                                  </Text>
                                  {food.reasoning_explanation.slice(0, 4).map((exp, i) => {
                                    const isReject = exp.includes('Penalized') || exp.includes('Reject');
                                    const isBoost = exp.includes('Boosted') || exp.includes('match');
                                    return (
                                      <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 3 }}>
                                        <FontAwesome name={isReject ? 'times' : isBoost ? 'plus' : 'angle-right'} size={9} color={isReject ? C.red : isBoost ? '#00E676' : C.muted} style={{ marginTop: 2 }} />
                                        <Text style={{ color: C.subtext, fontSize: 10, flex: 1, lineHeight: 14 }}>{exp.replace(/^(Boosted|Penalized): /, '')}</Text>
                                      </View>
                                    );
                                  })}
                                </View>
                              </View>
                            )}
                          </View>
                        )}

                        {/* ── Did you mean? (auto-shown when confidence < 90%) ── */}
                        {food.alternatives && food.alternatives.length > 0 && (
                          <View style={{ marginTop: 12, backgroundColor: confPct < 90 ? 'rgba(96,165,250,0.06)' : 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: confPct < 90 ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                              {confPct < 90 && <FontAwesome name="question-circle" size={10} color="#60A5FA" />}
                              <Text style={{ color: confPct < 90 ? '#60A5FA' : C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>
                                {confPct < 90 ? 'NOT QUITE RIGHT? DID YOU MEAN:' : 'DID YOU MEAN?'}
                              </Text>
                            </View>
                            {food.alternatives.map((alt, ai) => (
                              <TouchableOpacity
                                key={ai}
                                onPress={() => selectAlternative(idx, alt)}
                                style={{
                                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                                  paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, marginBottom: 4,
                                  backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
                                }}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>{alt.name}</Text>
                                  <Text style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>
                                    {alt.calories} cal · {alt.protein}g P · {alt.portion}
                                  </Text>
                                </View>
                                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                                  <View style={{
                                    backgroundColor: `${getConfidenceBadge(alt.confidence * 100).color}15`,
                                    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
                                  }}>
                                    <Text style={{ color: getConfidenceBadge(alt.confidence * 100).color, fontSize: 10, fontWeight: '800' }}>
                                      {Math.round(alt.confidence * 100)}%
                                    </Text>
                                  </View>
                                  <FontAwesome name="exchange" size={9} color={C.muted} />
                                </View>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}

                        {/* ── Card footer: AI Details toggle (progressive disclosure) ── */}
                        {((food.reasoning_explanation && food.reasoning_explanation.length > 0) || (food.visible_ingredients && food.visible_ingredients.length > 0) || food.source) && (
                          <TouchableOpacity
                            onPress={() => toggleDetail(idx)}
                            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 8 }}
                          >
                            <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700' }}>
                              {expandedDetailIdx === idx ? 'Hide details' : 'Why this match?'}
                            </Text>
                            <FontAwesome name={expandedDetailIdx === idx ? 'chevron-up' : 'chevron-down'} size={9} color={C.muted} />
                          </TouchableOpacity>
                        )}
                      </View>
                      </StaggerCard>
                    );
                  })}

                  {/* Add missing food */}
                  <TouchableOpacity onPress={() => setShowManualSearch(true)} style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    paddingVertical: 16, marginTop: 4, borderRadius: 16,
                    borderWidth: 1.5, borderColor: 'rgba(31,164,99,0.2)', borderStyle: 'dashed',
                    backgroundColor: 'rgba(31,164,99,0.04)',
                  }}>
                    <FontAwesome name="plus" size={10} color={C.accent} />
                    <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>Add missing food</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>

              {/* Bottom: primary Log + secondary Scan Again */}
              <View style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 12) + 8, paddingTop: 12,
                backgroundColor: 'rgba(5,5,5,0.95)', borderTopWidth: 1, borderTopColor: C.cardBorder,
                flexDirection: 'row', gap: 10,
              }}>
                <TouchableOpacity onPress={resetFoodScan} style={{
                  width: 56, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: C.card, borderRadius: 16, paddingVertical: 16,
                  borderWidth: 1, borderColor: C.cardBorder,
                }}>
                  <FontAwesome name="camera" size={16} color={C.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleLogAll}
                  disabled={loggingAll || confirmedTotals.count === 0}
                  style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    backgroundColor: confirmedTotals.count === 0 ? 'rgba(31,164,99,0.3)' : C.accent,
                    borderRadius: 16, paddingVertical: 16,
                  }}>
                  {loggingAll ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <>
                      <FontAwesome name="check" size={14} color="#000" />
                      <Text style={{ color: '#000', fontSize: 15, fontWeight: '800' }}>
                        Log {confirmedTotals.count > 0 ? `${confirmedTotals.count} ` : ''}to {mealType.charAt(0).toUpperCase() + mealType.slice(1)}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── MANUAL SEARCH ── */}
          {showManualSearch && (
            <KeyboardAvoidingView style={{ ...StyleSheet.absoluteFillObject, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 10 }}>
                <TouchableOpacity style={styles.iconButton} onPress={() => setShowManualSearch(false)}>
                  <FontAwesome name="chevron-left" size={16} color="#fff" />
                </TouchableOpacity>
                <Text style={[styles.title, { marginLeft: 10 }]}>Food Search</Text>
              </View>

              <View style={styles.searchBar}>
                <FontAwesome name="search" size={14} color={C.muted} style={{ marginRight: 10 }} />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={handleSearch}
                  placeholder="Search foods... (e.g. cooked rice, paneer)"
                  placeholderTextColor={C.muted}
                  autoFocus
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                    <FontAwesome name="times-circle" size={16} color={C.muted} />
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {searching && (
                  <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></View>
                )}
                {!searching && searchResults.length > 0 && (
                  <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
                    <Text style={styles.sectionTitle}>{searchResults.length} Results</Text>
                    {searchResults.map((item, idx) => (
                      <FoodCard key={item._id} item={item} index={idx} onPress={() => openFoodDetail(item)} />
                    ))}
                  </View>
                )}
                {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
                  <View style={styles.emptyState}>
                    <FontAwesome name="cutlery" size={32} color={C.muted} />
                    <Text style={styles.emptyTitle}>No results found</Text>
                    <Text style={styles.emptySubtext}>Try a different search term</Text>
                  </View>
                )}
                {!searching && searchQuery.length < 2 && (
                  <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
                    <Text style={styles.sectionTitle}>Suggestions</Text>
                    <View style={styles.suggestRow}>
                      {SUGGESTIONS.map(s => (
                        <TouchableOpacity key={s} style={styles.suggestChip} onPress={() => { setSearchQuery(s); handleSearch(s); }}>
                          <Text style={styles.suggestChipText}>{s}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {recentFoods.length > 0 && (
                      <>
                        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Recent</Text>
                        {recentFoods.slice(0, 8).map((item, idx) => (
                          <FoodCard key={item._id + '-recent'} item={item} index={idx} onPress={() => openFoodDetail(item)} />
                        ))}
                      </>
                    )}
                  </View>
                )}
                <View style={{ height: 100 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          )}
        </View>
      )}

      {/* ═══ MODE TOGGLE ═══ */}
      {(mode === 'barcode' || (mode === 'food' && foodScanPhase === 'camera' && !showManualSearch)) && (
        <View style={styles.toggleContainer}>
          <View style={styles.toggleTrack}>
            <Animated.View style={[styles.toggleIndicator, { left: toggleLeft }]} />
            <TouchableOpacity style={styles.toggleBtn} onPress={() => switchMode('barcode')}>
              <FontAwesome name="barcode" size={14} color={mode === 'barcode' ? '#000' : C.text} />
              <Text style={[styles.toggleText, mode === 'barcode' && styles.toggleTextActive]}>Barcode</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.toggleBtn} onPress={() => switchMode('food')}>
              <FontAwesome name="cutlery" size={13} color={mode === 'food' ? '#000' : C.text} />
              <Text style={[styles.toggleText, mode === 'food' && styles.toggleTextActive]}>Food</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ═══ PORTION CONFIRMATION BOTTOM SHEET (Stage 3/9) ═══ */}
      {portionSheetIndex !== null && detectedFoods[portionSheetIndex] && (() => {
        const food = detectedFoods[portionSheetIndex];
        const options = (food.portion_options && food.portion_options.length)
          ? food.portion_options
          : [
              { label: 'Small', grams: Math.round((food.estimated_weight || food.grams) * 0.6) },
              { label: 'Medium', grams: Math.round(food.estimated_weight || food.grams) },
              { label: 'Large', grams: Math.round((food.estimated_weight || food.grams) * 1.4) },
              { label: 'Extra Large', grams: Math.round((food.estimated_weight || food.grams) * 1.9) },
            ];
        const liveCalories = (() => {
          const per = food.per100g; if (!per) return food.calories;
          return Math.round(per.calories * (food.grams / 100));
        })();
        return (
          <Modal visible transparent animationType="none" onRequestClose={closePortionSheet}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }} activeOpacity={1} onPress={closePortionSheet}>
              <Animated.View style={{
                transform: [{ translateY: portionSheetAnim.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }],
                backgroundColor: C.glass, borderTopLeftRadius: 28, borderTopRightRadius: 28,
                paddingTop: 10, paddingBottom: insets.bottom + 20, paddingHorizontal: 20,
                borderTopWidth: 1, borderColor: C.cardBorder,
              }}>
                <TouchableOpacity activeOpacity={1}>
                  {/* Grabber */}
                  <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 16 }} />

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <FontAwesome name="cutlery" size={14} color={C.accent} />
                    <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>{food.name}</Text>
                  </View>
                  <Text style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>
                    AI estimated {Math.round(food.estimated_weight || food.grams)}g · How much did you actually eat?
                  </Text>

                  {/* Options */}
                  {options.map((opt, oi) => {
                    const selected = Math.round(food.grams) === Math.round(opt.grams);
                    return (
                      <TouchableOpacity
                        key={oi}
                        onPress={() => applyPortionWeight(portionSheetIndex, opt.grams)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                          paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, marginBottom: 8,
                          backgroundColor: selected ? 'rgba(31,164,99,0.12)' : 'rgba(255,255,255,0.04)',
                          borderWidth: 1.5, borderColor: selected ? C.accent : 'rgba(255,255,255,0.06)',
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: selected ? C.accent : 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' }}>
                            {selected && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent }} />}
                          </View>
                          <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>{opt.label}</Text>
                        </View>
                        <Text style={{ color: C.subtext, fontSize: 13, fontWeight: '600' }}>~{opt.grams}g</Text>
                      </TouchableOpacity>
                    );
                  })}

                  {/* Custom weight stepper (Stage 4) */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 16, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 8 }}>
                    <TouchableOpacity onPress={() => applyPortionWeight(portionSheetIndex, food.grams - 10)} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' }}>
                      <FontAwesome name="minus" size={14} color={C.text} />
                    </TouchableOpacity>
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: C.text, fontSize: 22, fontWeight: '900' }}>{Math.round(food.grams)}g</Text>
                      <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700' }}>{liveCalories} kcal</Text>
                    </View>
                    <TouchableOpacity onPress={() => applyPortionWeight(portionSheetIndex, food.grams + 10)} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center' }}>
                      <FontAwesome name="plus" size={14} color={C.text} />
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity onPress={closePortionSheet} style={{ backgroundColor: C.accent, borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}>
                    <Text style={{ color: '#000', fontSize: 15, fontWeight: '800' }}>Continue</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              </Animated.View>
            </TouchableOpacity>
          </Modal>
        );
      })()}

      {/* ═══ FOOD DETAIL BOTTOM SHEET ═══ */}
      {selectedFood && (
        <Modal visible transparent animationType="none" onRequestClose={closeSheet}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeSheet}>
            <Animated.View style={[styles.sheetContainer, {
              transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }) }],
            }]}>
              <TouchableOpacity activeOpacity={1}>
                <View style={styles.sheetHandle} />
                <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
                  <Text style={styles.sheetFoodName}>{selectedFood.name}</Text>
                  {selectedFood.brand && <Text style={styles.sheetBrand}>{selectedFood.brand}</Text>}
                </View>
                <View style={styles.sheetNutritionRow}>
                  <View style={styles.sheetNutritionItem}>
                    <Text style={[styles.sheetNutrValue, { color: C.red }]}>{calculatedNutrition.calories}</Text>
                    <Text style={styles.sheetNutrLabel}>kcal</Text>
                  </View>
                  <View style={styles.sheetNutritionItem}>
                    <Text style={[styles.sheetNutrValue, { color: C.green }]}>{calculatedNutrition.protein}g</Text>
                    <Text style={styles.sheetNutrLabel}>Protein</Text>
                  </View>
                  <View style={styles.sheetNutritionItem}>
                    <Text style={[styles.sheetNutrValue, { color: C.orange }]}>{calculatedNutrition.carbs}g</Text>
                    <Text style={styles.sheetNutrLabel}>Carbs</Text>
                  </View>
                  <View style={styles.sheetNutritionItem}>
                    <Text style={[styles.sheetNutrValue, { color: C.blue }]}>{calculatedNutrition.fat}g</Text>
                    <Text style={styles.sheetNutrLabel}>Fat</Text>
                  </View>
                </View>
                <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
                  <Text style={styles.sheetSectionLabel}>Quantity</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <TextInput style={styles.quantityInput} value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" placeholder="100" placeholderTextColor={C.muted} />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {unitOptions.map(u => (
                          <TouchableOpacity key={u} onPress={() => setSelectedUnit(u)} style={[styles.unitChip, selectedUnit === u && styles.unitChipActive]}>
                            <Text style={[styles.unitChipText, selectedUnit === u && styles.unitChipTextActive]}>{u}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                  {selectedUnit !== 'g' && selectedUnit !== 'ml' && (
                    <Text style={styles.gramEquiv}>= {calculatedNutrition.grams}g equivalent</Text>
                  )}
                </View>
                <View style={{ paddingHorizontal: 20, marginTop: 18 }}>
                  <Text style={styles.sheetSectionLabel}>Meal</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map(m => (
                      <TouchableOpacity key={m} onPress={() => setMealType(m)} style={[styles.mealChip, mealType === m && styles.mealChipActive]}>
                        <Text style={[styles.mealChipText, mealType === m && styles.mealChipTextActive]}>
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <TouchableOpacity onPress={handleAddMeal} disabled={adding || !parseFloat(quantity)} activeOpacity={0.8} style={[styles.addButton, adding && { opacity: 0.6 }]}>
                  <FontAwesome name="plus-circle" size={16} color="#000" style={{ marginRight: 8 }} />
                  <Text style={styles.addButtonText}>{adding ? 'Adding...' : 'Add Meal'}</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* ═══ DAILY SCAN LIMIT MODAL (free tier — HTTP 429) ═══ */}
      <Modal visible={!!limitInfo} transparent animationType="fade" onRequestClose={() => setLimitInfo(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 360, backgroundColor: C.glass, borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: C.cardBorder }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,183,77,0.14)', borderWidth: 2, borderColor: C.orange, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <FontAwesome name="lock" size={30} color={C.orange} />
            </View>
            <Text style={{ color: C.text, fontSize: 19, fontWeight: '800', textAlign: 'center', marginBottom: 8 }}>
              Daily AI Scan Limit Reached
            </Text>
            <Text style={{ color: C.subtext, fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 20 }}>
              You've used all {limitInfo?.limit ?? 10} AI scans today. Unlimited scans are available with GetFit Pro.
            </Text>
            <TouchableOpacity
              onPress={() => { setLimitInfo(null); router.push('/upgrade' as any); }}
              activeOpacity={0.85}
              style={{ width: '100%', height: 50, borderRadius: 14, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center', marginBottom: 10, flexDirection: 'row', gap: 8 }}
            >
              <FontAwesome name="star" size={14} color="#000" />
              <Text style={{ color: '#000', fontSize: 15, fontWeight: '800' }}>Upgrade to Pro</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setLimitInfo(null)} activeOpacity={0.7} style={{ paddingVertical: 10 }}>
              <Text style={{ color: C.muted, fontSize: 13, fontWeight: '600' }}>Try Again Tomorrow</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ═══ STYLES ═══
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, backgroundColor: 'rgba(0,0,0,0.2)' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(17,24,39,0.72)' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  centerContent: { alignItems: 'center' },
  scanFrame: { width: 250, height: 250, borderRadius: 24, position: 'relative' },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: '#fff' },
  cornerTopLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 20 },
  cornerTopRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 20 },
  cornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 20 },
  cornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 20 },
  frameText: { marginTop: 14, color: '#fff', fontSize: 14, fontWeight: '500', opacity: 0.9 },
  processingOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  processingText: { marginTop: 8, color: '#fff', fontWeight: '600' },
  permissionContainer: { flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', paddingHorizontal: 24 },
  permissionContent: { alignItems: 'center' },
  permissionTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 18 },
  permissionSubtitle: { color: '#9ca3af', textAlign: 'center', marginTop: 8, marginBottom: 24, fontSize: 15 },
  allowButton: { width: '100%', backgroundColor: '#1FA463', paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginBottom: 10 },
  allowButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  backButton: { width: '100%', backgroundColor: '#374151', paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  backButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  toggleContainer: { position: 'absolute', bottom: Platform.OS === 'ios' ? 42 : 24, left: 40, right: 40, alignItems: 'center' },
  toggleTrack: { flexDirection: 'row', backgroundColor: 'rgba(20,20,20,0.95)', borderRadius: 14, padding: 3, borderWidth: 1, borderColor: C.cardBorder, width: SCREEN_W - 80 },
  toggleIndicator: { position: 'absolute', top: 3, width: (SCREEN_W - 86) / 2, height: 36, borderRadius: 11, backgroundColor: C.accent },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, gap: 5, zIndex: 1 },
  toggleText: { fontSize: 13, fontWeight: '700', color: C.text },
  toggleTextActive: { color: '#000' },

  searchBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, color: C.text, padding: 0 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.muted, letterSpacing: 0.5, marginBottom: 10, marginTop: 8 },

  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestChip: { backgroundColor: C.accentDim, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(31,164,99,0.2)' },
  suggestChipText: { color: C.accent, fontSize: 12, fontWeight: '600' },

  foodCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.cardBorder },
  foodName: { color: C.text, fontSize: 15, fontWeight: '700', flex: 1 },
  foodBrand: { color: C.muted, fontSize: 11, marginTop: 2 },
  macroRow: { flexDirection: 'row', marginTop: 8, gap: 8 },
  macroChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  macroText: { color: C.subtext, fontSize: 10, fontWeight: '600' },
  sourceCol: { alignItems: 'flex-end', marginLeft: 8 },
  sourceBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  sourceBadgeText: { fontSize: 8, fontWeight: '700' },
  servingText: { color: C.muted, fontSize: 9, marginTop: 4 },
  typeBadge: { backgroundColor: 'rgba(255,183,77,0.15)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  typeBadgeText: { color: C.orange, fontSize: 9, fontWeight: '700' },

  skeletonCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: C.cardBorder },

  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 14 },
  emptySubtext: { color: C.muted, fontSize: 13, marginTop: 6, marginBottom: 16 },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheetContainer: { backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, maxHeight: '80%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted, alignSelf: 'center', marginTop: 10, marginBottom: 12 },
  sheetFoodName: { color: C.text, fontSize: 22, fontWeight: '800' },
  sheetBrand: { color: C.muted, fontSize: 13, marginTop: 2 },
  sheetNutritionRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 18, paddingHorizontal: 10, paddingVertical: 14, backgroundColor: C.card, marginHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder },
  sheetNutritionItem: { alignItems: 'center' },
  sheetNutrValue: { fontSize: 20, fontWeight: '800' },
  sheetNutrLabel: { fontSize: 10, color: C.muted, marginTop: 2, fontWeight: '600' },
  sheetSectionLabel: { fontSize: 12, fontWeight: '700', color: C.muted, letterSpacing: 0.5 },
  quantityInput: { width: 80, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 14, paddingVertical: 10, color: C.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  unitChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder },
  unitChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  unitChipText: { color: C.text, fontSize: 12, fontWeight: '600' },
  unitChipTextActive: { color: '#000' },
  gramEquiv: { color: C.accent, fontSize: 11, fontWeight: '600', marginTop: 6 },
  mealChip: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, alignItems: 'center' },
  mealChipActive: { backgroundColor: C.accent, borderColor: C.accent },
  mealChipText: { color: C.text, fontSize: 11, fontWeight: '700' },
  mealChipTextActive: { color: '#000' },
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginHorizontal: 20, marginTop: 20, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 15 },
  addButtonText: { color: '#000', fontSize: 15, fontWeight: '800' },
});
