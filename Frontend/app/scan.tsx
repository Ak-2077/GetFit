import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Alert, StyleSheet, ActivityIndicator,
  TextInput, FlatList, Animated, Dimensions, ScrollView, Modal, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { searchFoodsByName, addFoodToLog, recognizeFood, smartFoodSearch, trackFoodMemory } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const { width: SCREEN_W } = Dimensions.get('window');

// ═══ THEME ═══
const C = {
  bg: '#050505',
  card: 'rgba(25,25,25,1)',
  cardBorder: 'rgba(255,255,255,0.06)',
  glass: 'rgba(20,22,24,0.92)',
  accent: '#1FA463',
  accentDim: 'rgba(31,164,99,0.14)',
  text: '#F4F6F5',
  subtext: 'rgba(255,255,255,0.62)',
  muted: 'rgba(255,255,255,0.4)',
  border: 'rgba(255,255,255,0.06)',
  red: '#FF6B6B',
  orange: '#FFB74D',
  blue: '#42A5F5',
  green: '#66BB6A',
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

type DetectedFood = {
  name: string;
  normalized_name: string;
  state: string;
  portion: string;
  confidence: number;
  confirmed: boolean;
  matchedFood?: FoodResult | null;
};

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

// ═══ FOOD RESULT CARD ═══
function FoodCard({ item, onPress, index }: { item: FoodResult; onPress: () => void; index: number }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 250,
      delay: index * 50,
      useNativeDriver: true,
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

// ═══ MAIN COMPONENT ═══
export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<'barcode' | 'food'>('barcode');
  const toggleAnim = useRef(new Animated.Value(0)).current;

  // Barcode state
  const [isProcessing, setIsProcessing] = useState(false);
  const [isScannerEnabled, setIsScannerEnabled] = useState(true);
  const scanLockRef = useRef(false);
  const alertOpenRef = useRef(false);

  // Food camera + AI recognition state
  const foodCameraRef = useRef<any>(null);
  const [foodScanPhase, setFoodScanPhase] = useState<'camera' | 'analyzing' | 'confirm' | 'nutrition'>('camera');
  const [detectedFoods, setDetectedFoods] = useState<DetectedFood[]>([]);
  const [capturedPhotoUri, setCapturedPhotoUri] = useState<string | null>(null);
  const capturedBase64Ref = useRef<string | null>(null);
  const [selectedFoodType, setSelectedFoodType] = useState<string>('homemade');
  const [selectedCookingMethods, setSelectedCookingMethods] = useState<string[]>([]);
  const [foodQuantityInput, setFoodQuantityInput] = useState('1');
  const [foodQuantityUnit, setFoodQuantityUnit] = useState('piece');
  const [analysisStage, setAnalysisStage] = useState('');
  const [nutritionResults, setNutritionResults] = useState<{ food: DetectedFood; matches: FoodResult[] }[]>([]);

  // Food search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoodResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentFoods, setRecentFoods] = useState<FoodResult[]>([]);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showManualSearch, setShowManualSearch] = useState(false);

  // Bottom sheet state
  const [selectedFood, setSelectedFood] = useState<FoodResult | null>(null);
  const [quantity, setQuantity] = useState('100');
  const [selectedUnit, setSelectedUnit] = useState('g');
  const [mealType, setMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('lunch');
  const [adding, setAdding] = useState(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  // Load recent foods on mount
  useEffect(() => {
    loadRecentFoods();
  }, []);

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

  // ── Mode toggle animation ──
  const switchMode = (newMode: 'barcode' | 'food') => {
    setMode(newMode);
    Animated.spring(toggleAnim, {
      toValue: newMode === 'food' ? 1 : 0,
      useNativeDriver: false,
      tension: 60,
      friction: 10,
    }).start();
  };

  // ── Navigation ──
  const goBackSafe = () => {
    if (router.canGoBack()) { router.back(); return; }
    router.replace('/(tabs)/calories');
  };

  // ── Barcode handlers ──
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

  // ── Food search with debounce ──
  const handleSearch = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (text.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await searchFoodsByName(text.trim(), 15);
        setSearchResults(res?.data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  // ── Food camera capture → go to analyzing immediately ──
  const handleFoodCapture = async () => {
    if (!foodCameraRef.current) return;
    try {
      const photo = await foodCameraRef.current.takePictureAsync({
        quality: 0.6,
        base64: true,
        exif: false,
      });

      if (photo.uri) setCapturedPhotoUri(photo.uri);
      let base64Data = photo.base64;
      if (!base64Data && photo.uri) {
        base64Data = await FileSystem.readAsStringAsync(photo.uri, { encoding: 'base64' });
      }
      capturedBase64Ref.current = base64Data || null;

      if (!photo.uri || !base64Data) {
        Alert.alert('Error', 'Could not capture image. Please try again.');
        return;
      }

      // Start progressive AI analysis
      setFoodScanPhase('analyzing');
      setAnalysisStage('Analyzing image...');

      // Call AI vision with context
      setAnalysisStage('Identifying foods...');
      const aiRes = await recognizeFood(base64Data, 'image/jpeg', selectedFoodType, selectedCookingMethods);
      const aiData = aiRes?.data;

      if (aiData?.success && aiData.foods?.length > 0) {
        const foods: DetectedFood[] = aiData.foods.map((f: any) => ({
          name: f.name || '',
          normalized_name: f.normalized_name || f.name || '',
          state: f.state || 'general',
          portion: f.portion || '1 serving',
          confidence: f.confidence || 0.8,
          confirmed: f.confidence >= 0.7,
          matchedFood: null,
        }));
        setDetectedFoods(foods);
        setFoodScanPhase('confirm');
      } else {
        // AI failed — let user manual search
        Alert.alert('Could not identify food', aiData?.error || 'Try manual search.', [
          { text: 'Manual Search', onPress: () => { setShowManualSearch(true); setFoodScanPhase('camera'); } },
          { text: 'Retake', onPress: () => resetFoodScan() },
        ]);
      }
    } catch (err: any) {
      console.warn('[FoodCapture] error:', err?.message);
      Alert.alert('Capture Failed', 'Could not process photo. Try again.', [
        { text: 'OK', onPress: () => setFoodScanPhase('camera') },
      ]);
    }
  };

  // ── Toggle cooking method ──
  const toggleCookingMethod = (method: string) => {
    setSelectedCookingMethods(prev =>
      prev.includes(method) ? prev.filter(m => m !== method) : [...prev, method]
    );
  };

  // ── Toggle food confirmation ──
  const toggleFoodConfirmed = (index: number) => {
    setDetectedFoods(prev => prev.map((f, i) => i === index ? { ...f, confirmed: !f.confirmed } : f));
  };

  // ── Remove detected food ──
  const removeDetectedFood = (index: number) => {
    setDetectedFoods(prev => prev.filter((_, i) => i !== index));
  };

  // ── Continue → Smart search for all confirmed foods ──
  const handleContinueToNutrition = async () => {
    const confirmedFoods = detectedFoods.filter(f => f.confirmed);
    if (confirmedFoods.length === 0) {
      Alert.alert('No foods selected', 'Please confirm at least one food item.');
      return;
    }

    setFoodScanPhase('analyzing');
    setAnalysisStage('Matching nutrition database...');

    try {
      // Use smart search endpoint for all foods at once
      const searchPayload = confirmedFoods.map(f => ({
        name: f.name,
        normalized_name: f.normalized_name,
        state: f.state,
      }));

      const smartRes = await smartFoodSearch(searchPayload, selectedCookingMethods);
      const smartData = smartRes?.data;

      if (smartData?.success && Array.isArray(smartData.results)) {
        setAnalysisStage('Calculating macros...');
        const nutritionData = smartData.results.map((r: any, idx: number) => ({
          food: confirmedFoods[idx] || r.detected,
          matches: Array.isArray(r.matches) ? r.matches : [],
        }));
        setNutritionResults(nutritionData);
        setFoodScanPhase('nutrition');
      } else {
        // Fallback: search each food individually
        setAnalysisStage('Searching databases...');
        const nutritionData: { food: DetectedFood; matches: FoodResult[] }[] = [];

        for (const food of confirmedFoods) {
          const searchName = food.normalized_name || food.name;
          let matches: FoodResult[] = [];
          try {
            const res = await searchFoodsByName(searchName, 5);
            matches = Array.isArray(res?.data) ? res.data : [];
          } catch {}
          if (matches.length === 0) {
            try {
              const res2 = await searchFoodsByName(food.name, 5);
              matches = Array.isArray(res2?.data) ? res2.data : [];
            } catch {}
          }
          nutritionData.push({ food, matches });
        }

        setNutritionResults(nutritionData);
        setFoodScanPhase('nutrition');
      }
    } catch (err: any) {
      console.warn('[ContinueToNutrition] error:', err?.message);
      Alert.alert('Error', 'Could not fetch nutrition data.', [
        { text: 'Manual Search', onPress: () => { setShowManualSearch(true); setFoodScanPhase('camera'); } },
      ]);
    }
  };

  // ── Reset food scan ──
  const resetFoodScan = () => {
    setFoodScanPhase('camera');
    setDetectedFoods([]);
    setNutritionResults([]);
    setSearchResults([]);
    setShowManualSearch(false);
    setCapturedPhotoUri(null);
    capturedBase64Ref.current = null;
    setSelectedFoodType('homemade');
    setSelectedCookingMethods([]);
    setFoodQuantityInput('1');
    setFoodQuantityUnit('piece');
    setAnalysisStage('');
  };

  // ── Bottom sheet ──
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

  // ── Nutrition calculation ──
  const calculatedNutrition = useMemo(() => {
    if (!selectedFood) return { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
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

  // ── Add to log ──
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

  // ── Suggestions ──
  const SUGGESTIONS = ['Cooked rice', 'Chicken breast', 'Boiled egg', 'Paneer', 'Oats', 'Dal', 'Banana', 'Whey protein'];

  // ── Permission screen ──
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

  // ── Toggle indicator position ──
  const toggleLeft = toggleAnim.interpolate({ inputRange: [0, 1], outputRange: [3, (SCREEN_W - 80) / 2 - 3] });

  return (
    <SafeAreaView style={styles.container}>
      {/* ═══ BARCODE MODE ═══ */}
      {mode === 'barcode' ? (
        <View style={{ flex: 1 }}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            onBarcodeScanned={isScannerEnabled && !isProcessing ? ({ data }) => handleBarcodeScanned(data) : undefined}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
          />
          <View style={styles.overlay}>
            <View style={styles.topRow}>
              <TouchableOpacity style={styles.iconButton} onPress={goBackSafe}>
                <FontAwesome name="chevron-left" size={16} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.title}>Scan Barcode</Text>
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
          {/* ── PHASE: CAMERA (capture food photo) ── */}
          {foodScanPhase === 'camera' && !showManualSearch && (
            <View style={{ flex: 1 }}>
              <CameraView
                ref={foodCameraRef}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.overlay}>
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

                <View style={styles.centerContent}>
                  <View style={[styles.scanFrame, { borderRadius: 999, width: 220, height: 220 }]}>
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 999, borderWidth: 3, borderColor: 'rgba(31,164,99,0.5)' }} />
                  </View>
                  <Text style={[styles.frameText, { marginTop: 18 }]}>Point camera at your food</Text>
                </View>

                {/* Capture Button */}
                <View style={{ alignItems: 'center', marginBottom: 80 }}>
                  <TouchableOpacity
                    onPress={handleFoodCapture}
                    activeOpacity={0.7}
                    style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)' }}
                  >
                    <FontAwesome name="camera" size={20} color="#000" />
                  </TouchableOpacity>
                  <Text style={{ color: C.muted, fontSize: 11, marginTop: 6, fontWeight: '600' }}>Tap to scan</Text>
                </View>
              </View>
            </View>
          )}

          {/* ── PHASE: ANALYZING (progressive AI stages) ── */}
          {foodScanPhase === 'analyzing' && (
            <View style={{ flex: 1, backgroundColor: C.bg }}>
              {capturedPhotoUri && (
                <Image source={{ uri: capturedPhotoUri }} style={{ width: '100%', height: 260, opacity: 0.3 }} resizeMode="cover" blurRadius={12} />
              )}
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}>
                  <ActivityIndicator size="large" color={C.accent} />
                </View>
                <Text style={{ color: C.text, fontSize: 18, fontWeight: '700' }}>{analysisStage || 'Processing...'}</Text>
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 }}>
                  AI is analyzing your meal for accurate nutrition tracking
                </Text>
              </View>
            </View>
          )}

          {/* ── PHASE: CONFIRM (multi-food confirmation) ── */}
          {foodScanPhase === 'confirm' && (
            <View style={{ flex: 1, backgroundColor: C.bg }}>
              {/* Photo header with gradient overlay */}
              {capturedPhotoUri && (
                <View style={{ width: '100%', height: 220 }}>
                  <Image source={{ uri: capturedPhotoUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  <View style={{ position: 'absolute', bottom: 60, left: 0, right: 0, height: 40, backgroundColor: C.bg, opacity: 0.3 }} />
                  <View style={{ position: 'absolute', bottom: 30, left: 0, right: 0, height: 40, backgroundColor: C.bg, opacity: 0.6 }} />
                  <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40, backgroundColor: C.bg, opacity: 0.95 }} />
                </View>
              )}
              {/* Close button */}
              <TouchableOpacity style={{ position: 'absolute', top: 12, left: 16, zIndex: 10 }} onPress={resetFoodScan}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  <FontAwesome name="chevron-down" size={13} color="#fff" />
                </View>
              </TouchableOpacity>

              {/* AI badge on photo */}
              <View style={{ position: 'absolute', top: 14, right: 16, zIndex: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <FontAwesome name="magic" size={10} color={C.accent} style={{ marginRight: 5 }} />
                <Text style={{ color: C.text, fontSize: 10, fontWeight: '700' }}>AI Scan</Text>
              </View>

              <ScrollView style={{ flex: 1, marginTop: capturedPhotoUri ? -30 : 0 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={{ paddingHorizontal: 16, paddingTop: capturedPhotoUri ? 0 : 16 }}>
                  {/* Title section */}
                  <View style={{ marginBottom: 20 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                      <View style={{ width: 4, height: 20, borderRadius: 2, backgroundColor: C.accent, marginRight: 10 }} />
                      <Text style={{ color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 }}>Detected Foods</Text>
                    </View>
                    <Text style={{ color: C.muted, fontSize: 13, marginLeft: 14, lineHeight: 18 }}>
                      {detectedFoods.length} item{detectedFoods.length !== 1 ? 's' : ''} found  •  Tap to confirm or remove
                    </Text>
                  </View>

                  {/* Food cards */}
                  {detectedFoods.map((food, idx) => {
                    const confPct = Math.round(food.confidence * 100);
                    const confColor = food.confidence >= 0.8 ? '#4ECDC4' : food.confidence >= 0.6 ? '#FFE66D' : '#FF6B6B';
                    const confBg = food.confidence >= 0.8 ? 'rgba(76,205,196,0.12)' : food.confidence >= 0.6 ? 'rgba(255,230,109,0.12)' : 'rgba(255,107,107,0.12)';
                    return (
                      <View key={idx} style={{
                        backgroundColor: food.confirmed ? 'rgba(31,164,99,0.06)' : C.card,
                        borderRadius: 18, padding: 16, marginBottom: 12,
                        borderWidth: 1.5, borderColor: food.confirmed ? 'rgba(31,164,99,0.35)' : C.cardBorder,
                      }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {/* Checkbox */}
                          <TouchableOpacity onPress={() => toggleFoodConfirmed(idx)} style={{ marginRight: 14 }}>
                            <View style={{
                              width: 28, height: 28, borderRadius: 14,
                              backgroundColor: food.confirmed ? C.accent : 'rgba(255,255,255,0.04)',
                              borderWidth: 2, borderColor: food.confirmed ? C.accent : 'rgba(255,255,255,0.15)',
                              justifyContent: 'center', alignItems: 'center',
                            }}>
                              {food.confirmed && <FontAwesome name="check" size={13} color="#000" />}
                            </View>
                          </TouchableOpacity>

                          {/* Food icon */}
                          <View style={{
                            width: 44, height: 44, borderRadius: 14,
                            backgroundColor: 'rgba(31,164,99,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 12,
                            borderWidth: 1, borderColor: 'rgba(31,164,99,0.15)',
                          }}>
                            <FontAwesome name="cutlery" size={16} color={C.accent} />
                          </View>

                          {/* Food info */}
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 }}>{food.name}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5, flexWrap: 'wrap', gap: 6 }}>
                              {food.portion ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                                  <FontAwesome name="balance-scale" size={8} color={C.muted} style={{ marginRight: 4 }} />
                                  <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '600' }}>{food.portion}</Text>
                                </View>
                              ) : null}
                              {food.state && food.state !== 'general' && (
                                <View style={{ backgroundColor: C.accentDim, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                                  <Text style={{ color: C.accent, fontSize: 10, fontWeight: '700' }}>{food.state}</Text>
                                </View>
                              )}
                            </View>
                          </View>

                          {/* Confidence + Remove */}
                          <View style={{ alignItems: 'center', marginLeft: 8 }}>
                            <View style={{ backgroundColor: confBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6 }}>
                              <Text style={{ color: confColor, fontSize: 12, fontWeight: '800' }}>{confPct}%</Text>
                            </View>
                            <TouchableOpacity onPress={() => removeDetectedFood(idx)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,107,107,0.08)', justifyContent: 'center', alignItems: 'center' }}>
                              <FontAwesome name="times" size={12} color="rgba(255,107,107,0.6)" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })}

                  {/* Add missing food button */}
                  <TouchableOpacity onPress={() => setShowManualSearch(true)} style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    paddingVertical: 14, marginTop: 4, borderRadius: 14,
                    borderWidth: 1.5, borderColor: 'rgba(31,164,99,0.2)', borderStyle: 'dashed',
                    backgroundColor: 'rgba(31,164,99,0.04)',
                  }}>
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.accentDim, justifyContent: 'center', alignItems: 'center' }}>
                      <FontAwesome name="plus" size={10} color={C.accent} />
                    </View>
                    <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>Add missing food</Text>
                  </TouchableOpacity>

                  {/* Low confidence warning */}
                  {detectedFoods.some(f => f.confidence < 0.6) && (
                    <View style={{
                      backgroundColor: 'rgba(255,107,107,0.06)', borderRadius: 14, padding: 14, marginTop: 14,
                      flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,107,107,0.12)',
                    }}>
                      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,107,107,0.1)', justifyContent: 'center', alignItems: 'center' }}>
                        <FontAwesome name="exclamation-triangle" size={14} color="#FF6B6B" />
                      </View>
                      <Text style={{ color: 'rgba(255,107,107,0.85)', fontSize: 12, flex: 1, lineHeight: 17 }}>
                        Some items have low confidence. Please verify before continuing.
                      </Text>
                    </View>
                  )}

                  {/* Tip card */}
                  <View style={{
                    backgroundColor: 'rgba(66,165,245,0.06)', borderRadius: 14, padding: 14, marginTop: 14,
                    flexDirection: 'row', gap: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(66,165,245,0.1)',
                  }}>
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(66,165,245,0.1)', justifyContent: 'center', alignItems: 'center' }}>
                      <FontAwesome name="lightbulb-o" size={15} color={C.blue} />
                    </View>
                    <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, flex: 1, lineHeight: 16 }}>
                      Tap the checkmark to confirm each item. We'll find the best nutrition match from USDA.
                    </Text>
                  </View>
                </View>
                <View style={{ height: 110 }} />
              </ScrollView>

              {/* Bottom action bar */}
              <View style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                paddingHorizontal: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 20, paddingTop: 14,
                backgroundColor: 'rgba(5,5,5,0.92)', borderTopWidth: 1, borderTopColor: C.cardBorder,
              }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={resetFoodScan} style={{
                    flex: 0.35, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                    backgroundColor: C.card, borderRadius: 16, paddingVertical: 16,
                    borderWidth: 1, borderColor: C.cardBorder,
                  }}>
                    <FontAwesome name="refresh" size={13} color={C.text} />
                    <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>Retake</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleContinueToNutrition} style={{
                    flex: 0.65, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    backgroundColor: C.accent, borderRadius: 16, paddingVertical: 16,
                  }}>
                    <FontAwesome name="leaf" size={13} color="#000" />
                    <Text style={{ color: '#000', fontSize: 14, fontWeight: '800' }}>Get Nutrition</Text>
                    <FontAwesome name="arrow-right" size={12} color="#000" />
                  </TouchableOpacity>
                </View>
                {/* Item count */}
                <Text style={{ color: C.muted, fontSize: 10, textAlign: 'center', marginTop: 8 }}>
                  {detectedFoods.filter(f => f.confirmed).length} of {detectedFoods.length} items confirmed
                </Text>
              </View>
            </View>
          )}

          {/* ── PHASE: NUTRITION (multi-food nutrition results — food-details style) ── */}
          {foodScanPhase === 'nutrition' && (
            <View style={{ flex: 1, backgroundColor: C.bg }}>
              {/* Top-right radial glow */}
              <View style={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(0,230,118,0.06)' }} />
              <View style={{ position: 'absolute', top: -20, right: -20, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(0,230,118,0.04)' }} />

              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
                <TouchableOpacity onPress={() => setFoodScanPhase('confirm')} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center' }}>
                  <FontAwesome name="chevron-left" size={14} color={C.text} />
                </TouchableOpacity>
                <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 }}>Nutrition Details</Text>
                <TouchableOpacity onPress={() => { setShowManualSearch(true); }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center' }}>
                  <FontAwesome name="search" size={14} color={C.text} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={{ paddingHorizontal: 20, paddingBottom: 120 }}>

                  {/* ═══ Per-food cards (food-details style) ═══ */}
                  {nutritionResults.map((result, idx) => {
                    const bestMatch = result.matches[0];
                    const macroValid = bestMatch?._macroValid !== false;
                    const foodSource = bestMatch?.source || '';
                    const trustBadge = foodSource.includes('usda')
                      ? { icon: 'shield' as const, label: 'USDA Verified', color: '#00E676', bg: 'rgba(0,230,118,0.14)' }
                      : foodSource === 'openfoodfacts'
                      ? { icon: 'users' as const, label: 'Community', color: '#42A5F5', bg: 'rgba(66,165,245,0.14)' }
                      : { icon: 'cutlery' as const, label: 'AI Match', color: '#FFB74D', bg: 'rgba(255,183,77,0.14)' };

                    return (
                      <View key={idx} style={{ marginBottom: 16 }}>
                        {/* ── Product Info Card ── */}
                        <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16 }}>
                          {/* Photo thumbnail + food name */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                            {capturedPhotoUri && (
                              <View style={{ width: 56, height: 56, borderRadius: 14, overflow: 'hidden', marginRight: 12, backgroundColor: 'rgba(255,255,255,0.04)' }}>
                                <Image source={{ uri: capturedPhotoUri }} style={{ width: 56, height: 56 }} resizeMode="cover" />
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: C.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 }}>
                                {bestMatch?.name || result.food.name || 'Unknown Food'}
                              </Text>
                              {bestMatch && bestMatch.name !== result.food.name && (
                                <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                                  Detected: {result.food.name}
                                </Text>
                              )}
                            </View>
                          </View>

                          {/* Badges: source + portion */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: trustBadge.bg, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, gap: 4 }}>
                              <FontAwesome name={trustBadge.icon} size={9} color={trustBadge.color} />
                              <Text style={{ color: trustBadge.color, fontSize: 9, fontWeight: '700', letterSpacing: 0.2 }}>{trustBadge.label}</Text>
                            </View>
                            {result.food.portion ? (
                              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 }}>
                                <FontAwesome name="balance-scale" size={9} color={C.muted} style={{ marginRight: 4 }} />
                                <Text style={{ color: C.subtext, fontSize: 9, fontWeight: '600' }}>{result.food.portion}</Text>
                              </View>
                            ) : null}
                          </View>

                          {/* Serving info */}
                          <View style={{ backgroundColor: 'rgba(20,22,24,0.92)', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.cardBorder }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <FontAwesome name="balance-scale" size={10} color={C.accent} style={{ marginRight: 6 }} />
                              <Text style={{ color: C.subtext, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }}>
                                SERVING: {bestMatch?.servingSize || '100g'}
                              </Text>
                            </View>
                          </View>
                        </View>

                        {bestMatch ? (
                          <>
                            {/* ── Nutrition Grid (same as food-details page) ── */}
                            <View style={{ marginTop: 10, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(31,164,99,0.14)', justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                                  <FontAwesome name="pie-chart" size={12} color={C.accent} />
                                </View>
                                <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>Nutrition per {bestMatch?.servingSize || '100g'}</Text>
                              </View>

                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                                {[
                                  { label: 'Calories', value: Math.round(bestMatch.calories || 0), unit: 'kcal', icon: 'fire', color: '#FF6B6B' },
                                  { label: 'Protein', value: Number((bestMatch.protein || 0).toFixed(1)), unit: 'g', icon: 'bolt', color: '#00E676' },
                                  { label: 'Carbs', value: Number((bestMatch.carbs || 0).toFixed(1)), unit: 'g', icon: 'leaf', color: '#FFB74D' },
                                  { label: 'Fat', value: Number((bestMatch.fat || 0).toFixed(1)), unit: 'g', icon: 'tint', color: '#42A5F5' },
                                  { label: 'Fiber', value: Math.round(bestMatch.fiber || 0), unit: 'g', icon: 'pagelines', color: '#66BB6A' },
                                  { label: 'Sugar', value: Math.round(bestMatch.sugar || 0), unit: 'g', icon: 'cube', color: '#EC407A' },
                                ].map((block) => (
                                  <View key={block.label} style={{ width: '48%', backgroundColor: 'rgba(20,22,24,0.92)', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.cardBorder }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                                      <FontAwesome name={block.icon as any} size={11} color={block.color} style={{ marginRight: 6 }} />
                                      <Text style={{ color: C.subtext, fontSize: 12, fontWeight: '600' }}>{block.label}</Text>
                                    </View>
                                    <Text style={{ color: C.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 }}>{block.value}</Text>
                                    <Text style={{ color: C.muted, fontSize: 10, marginTop: 2, fontWeight: '500' }}>{block.unit}</Text>
                                  </View>
                                ))}
                              </View>

                              {/* Macro validation warning */}
                              {!macroValid && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,107,107,0.08)', borderRadius: 10, padding: 10, marginTop: 4 }}>
                                  <FontAwesome name="exclamation-triangle" size={12} color="#FF6B6B" />
                                  <Text style={{ color: '#FF6B6B', fontSize: 11, flex: 1 }}>Nutrition values may be inaccurate for this match</Text>
                                </View>
                              )}
                            </View>

                            {/* Alternative matches */}
                            {result.matches.length > 1 && (
                              <View style={{ marginTop: 10, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 14 }}>
                                <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginBottom: 8 }}>OTHER MATCHES</Text>
                                {result.matches.slice(1, 4).map((alt: any) => (
                                  <TouchableOpacity
                                    key={alt._id || alt.name}
                                    onPress={() => {
                                      router.push({
                                        pathname: '/food-details',
                                        params: { foodData: JSON.stringify(alt), source: alt.source || '' },
                                      });
                                    }}
                                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.cardBorder }}
                                  >
                                    <View style={{ flex: 1 }}>
                                      <Text numberOfLines={1} style={{ color: C.text, fontSize: 13, fontWeight: '600' }}>{alt.name}</Text>
                                      <Text style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>{alt.calories || 0} kcal · {alt.protein || 0}g P · {alt.carbs || 0}g C · {alt.fat || 0}g F</Text>
                                    </View>
                                    <FontAwesome name="chevron-right" size={10} color={C.muted} style={{ marginLeft: 8 }} />
                                  </TouchableOpacity>
                                ))}
                              </View>
                            )}

                            {/* View full details + Log button */}
                            <TouchableOpacity
                              onPress={() => {
                                router.push({
                                  pathname: '/food-details',
                                  params: { foodData: JSON.stringify(bestMatch), source: bestMatch.source || '' },
                                });
                              }}
                              style={{ marginTop: 12, backgroundColor: C.accent, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
                            >
                              <FontAwesome name="plus-circle" size={16} color="#000" />
                              <Text style={{ color: '#000', fontSize: 15, fontWeight: '800' }}>Add To Today Log</Text>
                            </TouchableOpacity>
                          </>
                        ) : (
                          /* ── No match: polished empty state ── */
                          <View style={{ marginTop: 10, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 20, alignItems: 'center' }}>
                            <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(255,183,77,0.14)', justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
                              <FontAwesome name="search" size={22} color="#FFB74D" />
                            </View>
                            <Text style={{ color: C.text, fontSize: 16, fontWeight: '800', marginBottom: 4 }}>No Nutrition Match</Text>
                            <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 16 }}>
                              We couldn't find nutrition data for "{result.food.name}". Try searching manually or create a custom entry.
                            </Text>
                            <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
                              <TouchableOpacity
                                onPress={() => { setShowManualSearch(true); }}
                                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(31,164,99,0.14)', borderRadius: 14, paddingVertical: 13, borderWidth: 1, borderColor: 'rgba(31,164,99,0.3)' }}
                              >
                                <FontAwesome name="search" size={13} color={C.accent} />
                                <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>Search</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => {
                                  router.push({ pathname: '/food-details', params: { barcode: '' } });
                                }}
                                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.card, borderRadius: 14, paddingVertical: 13, borderWidth: 1, borderColor: C.cardBorder }}
                              >
                                <FontAwesome name="plus" size={13} color={C.text} />
                                <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>Create</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {/* Global empty state */}
                  {nutritionResults.length === 0 && (
                    <View style={{ minHeight: 320, alignItems: 'center', justifyContent: 'center' }}>
                      <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(31,164,99,0.14)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                        <FontAwesome name="cutlery" size={22} color={C.accent} />
                      </View>
                      <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>No Foods Detected</Text>
                      <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 18, paddingHorizontal: 20 }}>
                        Try taking another photo or search for food manually.
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                        <TouchableOpacity onPress={resetFoodScan} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.card, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 20, borderWidth: 1, borderColor: C.cardBorder }}>
                          <FontAwesome name="camera" size={13} color={C.text} />
                          <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>Retake</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { setShowManualSearch(true); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 20 }}>
                          <FontAwesome name="search" size={13} color="#000" />
                          <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>Search</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              </ScrollView>
            </View>
          )}

          {/* ── MANUAL SEARCH (fallback) ── */}
          {showManualSearch && (
            <KeyboardAvoidingView style={{ ...StyleSheet.absoluteFillObject, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 }}>
                <TouchableOpacity style={styles.iconButton} onPress={() => setShowManualSearch(false)}>
                  <FontAwesome name="chevron-left" size={16} color="#fff" />
                </TouchableOpacity>
                <Text style={[styles.title, { marginLeft: 10 }]}>Food Search</Text>
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={[styles.iconButton, { backgroundColor: C.accentDim }]} onPress={() => Alert.alert('Coming Soon', 'Voice search will be available soon.')}>
                  <FontAwesome name="microphone" size={16} color={C.accent} />
                </TouchableOpacity>
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

      {/* ═══ MODE TOGGLE — only on camera phase ═══ */}
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

      {/* ═══ FOOD DETAIL BOTTOM SHEET ═══ */}
      {selectedFood && (
        <Modal visible transparent animationType="none" onRequestClose={closeSheet}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeSheet}>
            <Animated.View style={[styles.sheetContainer, {
              transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }) }],
            }]}>
              <TouchableOpacity activeOpacity={1}>
                {/* Handle */}
                <View style={styles.sheetHandle} />

                {/* Food header */}
                <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
                  <Text style={styles.sheetFoodName}>{selectedFood.name}</Text>
                  {selectedFood.brand && <Text style={styles.sheetBrand}>{selectedFood.brand}</Text>}
                  {detectFoodType(selectedFood.name) ? (
                    <View style={[styles.typeBadge, { marginTop: 6, alignSelf: 'flex-start' }]}>
                      <Text style={styles.typeBadgeText}>{detectFoodType(selectedFood.name)}</Text>
                    </View>
                  ) : null}
                </View>

                {/* Nutrition preview */}
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

                {/* Quantity + Unit */}
                <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
                  <Text style={styles.sheetSectionLabel}>Quantity</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <TextInput
                      style={styles.quantityInput}
                      value={quantity}
                      onChangeText={setQuantity}
                      keyboardType="decimal-pad"
                      placeholder="100"
                      placeholderTextColor={C.muted}
                    />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {unitOptions.map(u => (
                          <TouchableOpacity
                            key={u}
                            onPress={() => setSelectedUnit(u)}
                            style={[styles.unitChip, selectedUnit === u && styles.unitChipActive]}
                          >
                            <Text style={[styles.unitChipText, selectedUnit === u && styles.unitChipTextActive]}>{u}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                  {selectedUnit !== 'g' && selectedUnit !== 'ml' && (
                    <Text style={styles.gramEquiv}>
                      = {calculatedNutrition.grams}g equivalent
                    </Text>
                  )}
                </View>

                {/* Meal type */}
                <View style={{ paddingHorizontal: 20, marginTop: 18 }}>
                  <Text style={styles.sheetSectionLabel}>Meal</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map(m => (
                      <TouchableOpacity
                        key={m}
                        onPress={() => setMealType(m)}
                        style={[styles.mealChip, mealType === m && styles.mealChipActive]}
                      >
                        <Text style={[styles.mealChipText, mealType === m && styles.mealChipTextActive]}>
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Add button */}
                <TouchableOpacity
                  onPress={handleAddMeal}
                  disabled={adding || !parseFloat(quantity)}
                  activeOpacity={0.8}
                  style={[styles.addButton, adding && { opacity: 0.6 }]}
                >
                  <FontAwesome name="plus-circle" size={16} color="#000" style={{ marginRight: 8 }} />
                  <Text style={styles.addButtonText}>{adding ? 'Adding...' : 'Add Meal'}</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            </Animated.View>
          </TouchableOpacity>
        </Modal>
      )}
    </SafeAreaView>
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

  // Toggle
  toggleContainer: { position: 'absolute', bottom: Platform.OS === 'ios' ? 42 : 24, left: 40, right: 40, alignItems: 'center' },
  toggleTrack: { flexDirection: 'row', backgroundColor: 'rgba(20,20,20,0.95)', borderRadius: 14, padding: 3, borderWidth: 1, borderColor: C.cardBorder, width: SCREEN_W - 80 },
  toggleIndicator: { position: 'absolute', top: 3, width: (SCREEN_W - 86) / 2, height: 36, borderRadius: 11, backgroundColor: C.accent },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, gap: 5, zIndex: 1 },
  toggleText: { fontSize: 13, fontWeight: '700', color: C.text },
  toggleTextActive: { color: '#000' },

  // Search
  searchBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, color: C.text, padding: 0 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.muted, letterSpacing: 0.5, marginBottom: 10, marginTop: 8 },

  // Suggestions
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestChip: { backgroundColor: C.accentDim, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(31,164,99,0.2)' },
  suggestChipText: { color: C.accent, fontSize: 12, fontWeight: '600' },

  // Food card
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

  // Skeleton
  skeletonCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: C.cardBorder },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 14 },
  emptySubtext: { color: C.muted, fontSize: 13, marginTop: 6, marginBottom: 16 },

  // Bottom sheet
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
