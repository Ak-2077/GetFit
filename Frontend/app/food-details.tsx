import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, ScrollView, Text, TextInput, TouchableOpacity, View, Modal, Platform, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { addBrandFood, addFoodToLog, searchFoods, getFoodById, getFoodByBarcode } from '../services/api';


type FoodItem = {
  _id: string;
  name?: string;
  brand?: string;
  origin?: string;
  servingSize?: string;
  barcode?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  ingredients?: string;
  image?: string;
  source?: string;
  supplementFacts?: any;
};

export default function FoodDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ barcode?: string; id?: string }>();
  const barcode = typeof params.barcode === 'string' ? params.barcode : '';
  const idParam = typeof params.id === 'string' ? params.id : '';

  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [food, setFood] = useState<FoodItem | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creatingCustomFood, setCreatingCustomFood] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customBrand, setCustomBrand] = useState('');
  const [customCalories, setCustomCalories] = useState('');
  const [customProtein, setCustomProtein] = useState('');
  const [customCarbs, setCustomCarbs] = useState('');
  const [customFat, setCustomFat] = useState('');
  const [servingAmountText, setServingAmountText] = useState('100');
  const [servingUnit, setServingUnit] = useState<'g' | 'ml'>('g');

  // Meal type picker state
  const [mealPickerVisible, setMealPickerVisible] = useState(false);

  const goBackSafe = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/calories');
  };

  useEffect(() => {
    const loadFood = async () => {
      try {
        setLoading(true);
        setLoadError(false);

        if (idParam) {
          const res = await getFoodById(idParam);
          setFood(res?.data?.food || res?.data || null);
          return;
        }

        if (!barcode) {
          setFood(null);
          return;
        }

        // Try barcode endpoint first (new format: { food, source })
        try {
          const byCode = await getFoodByBarcode(barcode);
          const data = byCode?.data;
          const found = data?.food || data || null;
          if (found && (found._id || found.name || found.calories !== undefined)) {
            setFood(found);
            return;
          }
        } catch (err: any) {
          if (err?.response?.status !== 404) {
            // Only fallback to search if it's not a real server error
          }
        }

        // Fallback to search
        const res = await searchFoods(barcode);
        if (res.data && res.data.length > 0) {
          setFood(res.data[0]);
        } else {
          setFood(null);
        }
      } catch (error) {
        setFood(null);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    loadFood();
  }, [barcode, idParam]);

  const parseServing = (servingSize?: string, fallbackName?: string) => {
    const source = `${servingSize || ''}`.trim();
    const lower = source.toLowerCase();
    const drinkHint = `${fallbackName || ''}`.toLowerCase();

    const valueMatch = lower.match(/(\d+(?:\.\d+)?)/);
    const parsedValue = valueMatch ? parseFloat(valueMatch[1]) : 100;

    let parsedUnit: 'g' | 'ml' = 'g';
    if (/(ml|milliliter|millilitre)/.test(lower)) {
      parsedUnit = 'ml';
    } else if (/(g|gram)/.test(lower)) {
      parsedUnit = 'g';
    } else if (/(energy drink|drink|juice|soda|cola|water|beverage)/.test(drinkHint)) {
      parsedUnit = 'ml';
    }

    return {
      amount: Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 100,
      unit: parsedUnit,
    };
  };

  useEffect(() => {
    if (!food) return;
    const serving = parseServing(food.servingSize, food.name);
    setServingAmountText(String(serving.amount));
    setServingUnit(serving.unit);
  }, [food]);

  const servingAmount = useMemo(() => {
    const value = parseFloat(servingAmountText);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value;
  }, [servingAmountText]);

  const baseServingAmount = useMemo(() => {
    const serving = parseServing(food?.servingSize, food?.name);
    return serving.amount;
  }, [food?.servingSize, food?.name]);

  const servingMultiplier = useMemo(() => {
    if (!baseServingAmount || !servingAmount) return 1;
    return servingAmount / baseServingAmount;
  }, [baseServingAmount, servingAmount]);

  const nutritionBlocks = useMemo(() => {
    const adjustedCalories = Math.round((food?.calories ?? 0) * servingMultiplier);
    const adjustedProtein = Number(((food?.protein ?? 0) * servingMultiplier).toFixed(1));
    const adjustedCarbs = Number(((food?.carbs ?? 0) * servingMultiplier).toFixed(1));
    const adjustedFat = Number(((food?.fat ?? 0) * servingMultiplier).toFixed(1));

    return [
      { label: 'Calories', value: adjustedCalories, unit: 'kcal', icon: 'fire', color: '#FF6B6B' },
      { label: 'Protein', value: adjustedProtein, unit: 'g', icon: 'bolt', color: '#00E676' },
      { label: 'Carbs', value: adjustedCarbs, unit: 'g', icon: 'leaf', color: '#FFB74D' },
      { label: 'Fat', value: adjustedFat, unit: 'g', icon: 'tint', color: '#42A5F5' },
      { label: 'Fiber', value: Math.round((food?.fiber ?? 0) * servingMultiplier), unit: 'g', icon: 'pagelines', color: '#66BB6A' },
      { label: 'Sugar', value: Math.round((food?.sugar ?? 0) * servingMultiplier), unit: 'g', icon: 'cube', color: '#EC407A' },
      { label: 'Sodium', value: Number(((food?.sodium ?? 0) * servingMultiplier).toFixed(2)), unit: 'g', icon: 'diamond', color: '#AB47BC' },
    ];
  }, [food, servingMultiplier]);

  const handleAddFood = () => {
    if (!food?._id) return;
    if (!servingAmount || servingAmount <= 0) {
      Alert.alert('Invalid Serving', 'Please enter a valid serving amount.');
      return;
    }
    setMealPickerVisible(true);
  };

  const handleMealTypeSelected = async (mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack') => {
    setMealPickerVisible(false);
    if (!food?._id) return;
    try {
      setAdding(true);
      await addFoodToLog({
        foodId: food._id,
        quantity: servingMultiplier,
        meal: mealType,
        mealType,
        servingText: `${servingAmount}${servingUnit}`,
        servingUnit,
      });

      Alert.alert('Added', `${food.name || 'Food'} added to your log.`, [
        { text: 'OK', onPress: () => router.replace('/(tabs)/calories') },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to add food to log.');
    } finally {
      setAdding(false);
    }
  };

  const handleCreateCustomFood = async () => {
    const safeName = customName.trim();
    const safeBrand = customBrand.trim();
    const caloriesValue = Number(customCalories);
    const proteinValue = customProtein.trim() === '' ? 0 : Number(customProtein);
    const carbsValue = customCarbs.trim() === '' ? 0 : Number(customCarbs);
    const fatValue = customFat.trim() === '' ? 0 : Number(customFat);

    if (!safeName) {
      Alert.alert('Missing Name', 'Please enter a food name.');
      return;
    }

    if (!Number.isFinite(caloriesValue) || caloriesValue <= 0) {
      Alert.alert('Invalid Calories', 'Please enter valid calories.');
      return;
    }

    if (!Number.isFinite(proteinValue) || proteinValue < 0) {
      Alert.alert('Invalid Protein', 'Protein must be 0 or more.');
      return;
    }

    if (!Number.isFinite(carbsValue) || carbsValue < 0) {
      Alert.alert('Invalid Carbs', 'Carbs must be 0 or more.');
      return;
    }

    if (!Number.isFinite(fatValue) || fatValue < 0) {
      Alert.alert('Invalid Fat', 'Fat must be 0 or more.');
      return;
    }

    try {
      setCreatingCustomFood(true);
      const res = await addBrandFood({
        name: safeName,
        brand: safeBrand || undefined,
        calories: Math.round(caloriesValue),
        protein: Number(proteinValue.toFixed(1)),
        carbs: Number(carbsValue.toFixed(1)),
        fat: Number(fatValue.toFixed(1)),
        barcode: barcode || undefined,
      });

      const createdFood = res?.data?.food;
      if (!createdFood?._id) {
        Alert.alert('Error', 'Custom food was not created correctly.');
        return;
      }

      setFood(createdFood);
      setCustomName('');
      setCustomBrand('');
      setCustomCalories('');
      setCustomProtein('');
      setCustomCarbs('');
      setCustomFat('');
      setLoadError(false);
      Alert.alert('Created', 'Custom food created. You can now add it to today log.');
    } catch (error) {
      Alert.alert('Error', 'Failed to create custom food.');
    } finally {
      setCreatingCustomFood(false);
    }
  };

  // Theme constants for meal picker (matching calories tab theme)
  const C = {
    bg: '#050505',
    card: 'rgba(25,25,25,1)',
    cardBorder: 'rgba(255,255,255,0.06)',
    glass: 'rgba(20,22,24,0.92)',
    accent: '#1FA463',
    accentSoft: 'rgba(31,164,99,0.14)',
    text: '#F4F6F5',
    subtext: 'rgba(255,255,255,0.62)',
    muted: 'rgba(255,255,255,0.4)',
    border: 'rgba(255,255,255,0.06)',
  };

  const inputStyle = {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontSize: 14,
  } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Top-right radial glow — same as Calories tab */}
      <View style={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(0,230,118,0.06)' }} />
      <View style={{ position: 'absolute', top: -20, right: -20, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(0,230,118,0.04)' }} />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
        <TouchableOpacity onPress={goBackSafe} activeOpacity={0.7} style={{
          width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder,
          justifyContent: 'center', alignItems: 'center',
        }}>
          <FontAwesome name="chevron-left" size={14} color={C.text} />
        </TouchableOpacity>
        <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 }}>Nutrition Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 20, paddingBottom: 32 }}>
        {loading ? (
          <View style={{ minHeight: 320, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={C.accent} />
          </View>
        ) : !food ? (
          <View style={{ minHeight: 320, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <FontAwesome name="search" size={22} color={C.accent} />
            </View>
            <Text style={{ color: C.text, fontSize: 22, fontWeight: '800', marginTop: 4 }}>No food found</Text>
            {loadError ? (
              <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 18 }}>
                Could not reach food database. Please check server connection and try again.
              </Text>
            ) : (
              <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 18 }}>
                Barcode {barcode || '-'} is not available in our food database yet.
              </Text>
            )}

            {!loadError ? (
              <View style={{ marginTop: 20, width: '100%', backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                    <FontAwesome name="plus" size={13} color={C.accent} />
                  </View>
                  <View>
                    <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>Create Custom Food</Text>
                    <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>Barcode: {barcode || '-'}</Text>
                  </View>
                </View>

                <TextInput style={inputStyle} value={customName} onChangeText={setCustomName} placeholder="Food name" placeholderTextColor={C.muted} />
                <TextInput style={[inputStyle, { marginTop: 10 }]} value={customBrand} onChangeText={setCustomBrand} placeholder="Brand (optional)" placeholderTextColor={C.muted} />
                <TextInput style={[inputStyle, { marginTop: 10 }]} value={customCalories} onChangeText={setCustomCalories} keyboardType="numeric" placeholder="Calories per 100g" placeholderTextColor={C.muted} />
                <TextInput style={[inputStyle, { marginTop: 10 }]} value={customProtein} onChangeText={setCustomProtein} keyboardType="numeric" placeholder="Protein (g) per 100g" placeholderTextColor={C.muted} />
                <TextInput style={[inputStyle, { marginTop: 10 }]} value={customCarbs} onChangeText={setCustomCarbs} keyboardType="numeric" placeholder="Carbs (g) per 100g" placeholderTextColor={C.muted} />
                <TextInput style={[inputStyle, { marginTop: 10 }]} value={customFat} onChangeText={setCustomFat} keyboardType="numeric" placeholder="Fat (g) per 100g" placeholderTextColor={C.muted} />

                <TouchableOpacity
                  onPress={handleCreateCustomFood}
                  disabled={creatingCustomFood}
                  activeOpacity={0.8}
                  style={{ marginTop: 14, alignItems: 'center', borderRadius: 14, paddingVertical: 13, backgroundColor: C.accent }}
                >
                  <Text style={{ color: '#000', fontSize: 14, fontWeight: '800' }}>{creatingCustomFood ? 'Creating...' : 'Create & Continue'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity onPress={goBackSafe} activeOpacity={0.8} style={{ marginTop: 12, alignItems: 'center', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}>
              <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>Scan Another</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ═══ PRODUCT INFO CARD ═══ */}
            <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16, overflow: 'hidden' }}>
              {food.image ? (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, marginBottom: 14, padding: 8 }}>
                  <Image source={{ uri: food.image }} style={{ width: '100%', height: 180, borderRadius: 12 }} resizeMode="contain" />
                </View>
              ) : null}

              <Text style={{ color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 }}>{food.name || 'Unknown Food'}</Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
                {food.brand ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.glass, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: C.cardBorder }}>
                    <FontAwesome name="tag" size={10} color={C.accent} style={{ marginRight: 5 }} />
                    <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '600' }}>{food.brand}</Text>
                  </View>
                ) : null}
                {food.origin ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.glass, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: C.cardBorder }}>
                    <FontAwesome name="globe" size={10} color="#42A5F5" style={{ marginRight: 5 }} />
                    <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '600' }}>{food.origin}</Text>
                  </View>
                ) : null}
                {food.source ? (() => {
                  const trust = food.source === 'usda'
                    ? { icon: 'shield' as const, label: 'Verified', color: '#00E676', bg: 'rgba(0,230,118,0.14)' }
                    : food.source === 'openfoodfacts'
                    ? { icon: 'users' as const, label: 'Community', color: '#42A5F5', bg: 'rgba(66,165,245,0.14)' }
                    : { icon: 'user' as const, label: 'Self-added', color: C.muted, bg: 'rgba(255,255,255,0.08)' };
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: trust.bg, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, gap: 4 }}>
                      <FontAwesome name={trust.icon} size={9} color={trust.color} />
                      <Text style={{ color: trust.color, fontSize: 9, fontWeight: '700', letterSpacing: 0.2 }}>{trust.label}</Text>
                    </View>
                  );
                })() : null}
              </View>

              {barcode ? (
                <Text style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>Barcode: {barcode}</Text>
              ) : null}

              {/* ── Serving Editor ── */}
              <View style={{ marginTop: 14, backgroundColor: C.glass, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <FontAwesome name="balance-scale" size={11} color={C.accent} style={{ marginRight: 6 }} />
                  <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>SERVING SIZE</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TextInput
                    style={{
                      flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, borderWidth: 1, borderColor: C.border,
                      paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 16, fontWeight: '700',
                    }}
                    value={servingAmountText}
                    onChangeText={setServingAmountText}
                    keyboardType="decimal-pad"
                    placeholder="100"
                    placeholderTextColor={C.muted}
                  />
                  <View style={{ marginLeft: 8, flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 3 }}>
                    <TouchableOpacity
                      onPress={() => setServingUnit('g')}
                      style={{
                        borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
                        backgroundColor: servingUnit === 'g' ? C.accent : 'transparent',
                      }}
                    >
                      <Text style={{ color: servingUnit === 'g' ? '#000' : C.text, fontWeight: '700', fontSize: 13 }}>g</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setServingUnit('ml')}
                      style={{
                        borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 2,
                        backgroundColor: servingUnit === 'ml' ? C.accent : 'transparent',
                      }}
                    >
                      <Text style={{ color: servingUnit === 'ml' ? '#000' : C.text, fontWeight: '700', fontSize: 13 }}>ml</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={{ color: C.muted, fontSize: 10, marginTop: 6 }}>
                  Base serving: {food.servingSize || `${baseServingAmount}${servingUnit}`}
                </Text>
              </View>
            </View>

            {/* ═══ NUTRITION GRID ═══ */}
            <View style={{ marginTop: 14, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: C.accentSoft, justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                  <FontAwesome name="pie-chart" size={12} color={C.accent} />
                </View>
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>Nutrition for {servingAmount || 0}{servingUnit}</Text>
              </View>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                {nutritionBlocks.map((block) => (
                  <View key={block.label} style={{
                    width: '48%', backgroundColor: C.glass, borderRadius: 16, padding: 14, marginBottom: 10,
                    borderWidth: 1, borderColor: C.cardBorder,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <FontAwesome name={block.icon as any} size={11} color={block.color} style={{ marginRight: 6 }} />
                      <Text style={{ color: C.subtext, fontSize: 12, fontWeight: '600' }}>{block.label}</Text>
                    </View>
                    <Text style={{ color: C.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 }}>{block.value}</Text>
                    <Text style={{ color: C.muted, fontSize: 10, marginTop: 2, fontWeight: '500' }}>{block.unit}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ═══ INGREDIENTS / SUPPLEMENT FACTS ═══ */}
            {(food?.ingredients || food?.supplementFacts) && (
              <View style={{ marginTop: 14, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16 }}>
                {food?.ingredients ? (
                  <View style={{ marginBottom: food?.supplementFacts ? 14 : 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <FontAwesome name="list-ul" size={12} color="#FFB74D" style={{ marginRight: 8 }} />
                      <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>Ingredients</Text>
                    </View>
                    <Text style={{ color: C.subtext, fontSize: 12, lineHeight: 18 }}>{food.ingredients}</Text>
                  </View>
                ) : null}

                {food?.supplementFacts ? (
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <FontAwesome name="flask" size={12} color="#AB47BC" style={{ marginRight: 8 }} />
                      <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>Supplement Facts</Text>
                    </View>
                    {Array.isArray(food.supplementFacts) ? (
                      <View>
                        {food.supplementFacts.map((sf: any, idx: number) => (
                          <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: idx < food.supplementFacts.length - 1 ? 1 : 0, borderBottomColor: C.cardBorder }}>
                            <Text style={{ color: C.subtext, fontSize: 12 }}>{sf.name}</Text>
                            <Text style={{ color: C.text, fontSize: 12, fontWeight: '600' }}>{sf.amount || ''}</Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={{ color: C.subtext, fontSize: 12, lineHeight: 18 }}>{typeof food.supplementFacts === 'string' ? food.supplementFacts : JSON.stringify(food.supplementFacts)}</Text>
                    )}
                  </View>
                ) : null}
              </View>
            )}

            {/* ═══ ADD BUTTON ═══ */}
            <TouchableOpacity
              onPress={handleAddFood}
              disabled={adding}
              activeOpacity={0.8}
              style={{
                marginTop: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
                borderRadius: 16, paddingVertical: 16, backgroundColor: C.accent,
              }}
            >
              <FontAwesome name="plus-circle" size={16} color="#000" style={{ marginRight: 8 }} />
              <Text style={{ color: '#000', fontSize: 15, fontWeight: '800' }}>{adding ? 'Adding...' : 'Add To Today Log'}</Text>
            </TouchableOpacity>
          </>
        )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* ═══ MEAL TYPE PICKER MODAL ═══ */}
      <Modal visible={mealPickerVisible} transparent animationType="fade" onRequestClose={() => setMealPickerVisible(false)}>
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
              <TouchableOpacity onPress={() => setMealPickerVisible(false)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: C.glass, justifyContent: 'center', alignItems: 'center' }}>
                <FontAwesome name="times" size={14} color={C.text} />
              </TouchableOpacity>
            </View>

            {([
              { key: 'breakfast' as const, label: 'Breakfast', icon: 'coffee', desc: 'Morning meal', iconColor: '#FFB74D' },
              { key: 'lunch' as const, label: 'Lunch', icon: 'sun-o', desc: 'Afternoon meal', iconColor: '#FFD54F' },
              { key: 'dinner' as const, label: 'Dinner', icon: 'moon-o', desc: 'Evening meal', iconColor: '#42A5F5' },
              { key: 'snack' as const, label: 'Snacks', icon: 'apple', desc: 'Between meals', iconColor: '#66BB6A' },
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
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: `${item.iconColor}18`, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                  <FontAwesome name={item.icon as any} size={15} color={item.iconColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>{item.label}</Text>
                  <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{item.desc}</Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color={C.muted} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity onPress={() => setMealPickerVisible(false)} activeOpacity={0.8} style={{ marginTop: 4, alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ color: C.muted, fontSize: 12, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
