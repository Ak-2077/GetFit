import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { addBrandFood, addFoodToLog, searchFoods } from '../services/api';

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
};

export default function FoodDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ barcode?: string }>();
  const barcode = typeof params.barcode === 'string' ? params.barcode : '';

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

        if (!barcode) {
          setFood(null);
          return;
        }

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
  }, [barcode]);

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
      {
        label: 'Calories',
        value: adjustedCalories,
        unit: 'kcal',
        cardClass: 'bg-rose-950 border border-rose-800',
        valueClass: 'text-rose-300',
      },
      {
        label: 'Protein',
        value: adjustedProtein,
        unit: 'g',
        cardClass: 'bg-emerald-950 border border-emerald-800',
        valueClass: 'text-emerald-300',
      },
      {
        label: 'Carbs',
        value: adjustedCarbs,
        unit: 'g',
        cardClass: 'bg-amber-950 border border-amber-800',
        valueClass: 'text-amber-300',
      },
      {
        label: 'Fat',
        value: adjustedFat,
        unit: 'g',
        cardClass: 'bg-sky-950 border border-sky-800',
        valueClass: 'text-sky-300',
      },
    ];
  }, [food, servingMultiplier]);

  const handleAddFood = async () => {
    if (!food?._id) return;
    if (!servingAmount || servingAmount <= 0) {
      Alert.alert('Invalid Serving', 'Please enter a valid serving amount.');
      return;
    }

    try {
      setAdding(true);
      await addFoodToLog({
        foodId: food._id,
        quantity: servingMultiplier,
        meal: 'snack',
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

  return (
    <SafeAreaView className="flex-1 bg-[#0A0A0A]">
      <View className="flex-row items-center justify-between px-4 py-3">
        <TouchableOpacity className="h-10 w-10 items-center justify-center rounded-full bg-gray-800" onPress={goBackSafe}>
          <FontAwesome name="chevron-left" size={18} color="#fff" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-white">Nutrition Details</Text>
        <View className="w-10" />
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 pb-8">
        {loading ? (
          <View className="min-h-[320px] items-center justify-center">
            <ActivityIndicator color="#fff" />
            <Text className="mt-3 text-gray-300">Loading food details...</Text>
          </View>
        ) : !food ? (
          <View className="min-h-[320px] items-center justify-center">
            <FontAwesome name="search" size={26} color="#9ca3af" />
            <Text className="mt-3 text-2xl font-bold text-white">No food found</Text>
            {loadError ? (
              <Text className="mt-2 text-center text-sm text-gray-400">
                Could not reach food database. Please check server connection and try again.
              </Text>
            ) : (
              <Text className="mt-2 text-center text-sm text-gray-400">
                Barcode {barcode || '-'} is not available in our food database yet.
              </Text>
            )}

            {!loadError ? (
              <View className="mt-5 w-full rounded-2xl border border-gray-700 bg-gray-900 p-4">
                <Text className="text-base font-bold text-white">Create Custom Food</Text>
                <Text className="mt-1 text-xs text-gray-400">Barcode: {barcode || '-'}</Text>

                <TextInput
                  className="mt-3 rounded-xl border border-gray-600 bg-gray-800 px-3 py-3 text-white"
                  value={customName}
                  onChangeText={setCustomName}
                  placeholder="Food name"
                  placeholderTextColor="#6b7280"
                />

                <TextInput
                  className="mt-3 rounded-xl border border-gray-600 bg-gray-800 px-3 py-3 text-white"
                  value={customBrand}
                  onChangeText={setCustomBrand}
                  placeholder="Brand (optional)"
                  placeholderTextColor="#6b7280"
                />

                <TextInput
                  className="mt-3 rounded-xl border border-gray-600 bg-gray-800 px-3 py-3 text-white"
                  value={customCalories}
                  onChangeText={setCustomCalories}
                  keyboardType="numeric"
                  placeholder="Calories per 100g"
                  placeholderTextColor="#6b7280"
                />

                <TextInput
                  className="mt-3 rounded-xl border border-gray-600 bg-gray-800 px-3 py-3 text-white"
                  value={customProtein}
                  onChangeText={setCustomProtein}
                  keyboardType="numeric"
                  placeholder="Protein (g) per 100g"
                  placeholderTextColor="#6b7280"
                />

                <TextInput
                  className="mt-3 rounded-xl border border-gray-600 bg-gray-800 px-3 py-3 text-white"
                  value={customCarbs}
                  onChangeText={setCustomCarbs}
                  keyboardType="numeric"
                  placeholder="Carbs (g) per 100g"
                  placeholderTextColor="#6b7280"
                />

                <TextInput
                  className="mt-3 rounded-xl border border-gray-600 bg-gray-800 px-3 py-3 text-white"
                  value={customFat}
                  onChangeText={setCustomFat}
                  keyboardType="numeric"
                  placeholder="Fat (g) per 100g"
                  placeholderTextColor="#6b7280"
                />

                <TouchableOpacity
                  className="mt-4 items-center rounded-xl bg-green-600 py-3"
                  onPress={handleCreateCustomFood}
                  disabled={creatingCustomFood}
                >
                  <Text className="font-bold text-white">{creatingCustomFood ? 'Creating...' : 'Create & Continue'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity className="mt-3 rounded-xl bg-gray-700 px-5 py-3" onPress={goBackSafe}>
              <Text className="font-bold text-white">Scan Another</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View className="rounded-2xl border border-gray-700 bg-gray-900 p-5">
              <Text className="text-2xl font-extrabold text-white">{food.name || 'Unknown Food'}</Text>
              <Text className="mt-2 text-sm text-slate-300">Brand: {food.brand || 'Unknown'}</Text>
              <Text className="mt-1 text-sm text-slate-300">Origin: {food.origin || 'Unknown'}</Text>
              <Text className="mt-1 text-sm text-slate-300">Barcode: {barcode || '-'}</Text>
              <View className="mt-3 rounded-xl border border-gray-700 bg-[#0B1220] p-3">
                <Text className="text-xs font-semibold text-gray-300">Serving (Editable)</Text>
                <View className="mt-2 flex-row items-center">
                  <TextInput
                    className="flex-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-white"
                    value={servingAmountText}
                    onChangeText={setServingAmountText}
                    keyboardType="decimal-pad"
                    placeholder="100"
                    placeholderTextColor="#6b7280"
                  />

                  <View className="ml-2 flex-row rounded-lg border border-gray-600 bg-gray-800 p-1">
                    <TouchableOpacity
                      className={`rounded-md px-3 py-2 ${servingUnit === 'g' ? 'bg-blue-600' : 'bg-transparent'}`}
                      onPress={() => setServingUnit('g')}
                    >
                      <Text className="font-bold text-white">g</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className={`ml-1 rounded-md px-3 py-2 ${servingUnit === 'ml' ? 'bg-blue-600' : 'bg-transparent'}`}
                      onPress={() => setServingUnit('ml')}
                    >
                      <Text className="font-bold text-white">ml</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text className="mt-2 text-xs text-slate-400">
                  Base serving: {food.servingSize || `${baseServingAmount}${servingUnit}`}
                </Text>
              </View>
            </View>

            <View className="mt-4 rounded-2xl border border-gray-700 bg-gray-900 p-4">
              <Text className="mb-3 text-lg font-bold text-white">Nutrition for {servingAmount || 0}{servingUnit}</Text>
              <View className="flex-row flex-wrap justify-between">
                {nutritionBlocks.map((block) => (
                  <View key={block.label} className={`mb-3 w-[48%] rounded-2xl p-4 ${block.cardClass}`}>
                    <Text className="text-sm font-semibold text-gray-200">{block.label}</Text>
                    <Text className={`mt-2 text-2xl font-extrabold ${block.valueClass}`}>{block.value}</Text>
                    <Text className="mt-1 text-xs text-gray-300">{block.unit}</Text>
                  </View>
                ))}
              </View>
            </View>

            <TouchableOpacity
              className="mt-5 items-center rounded-2xl bg-green-600 py-4"
              onPress={handleAddFood}
              disabled={adding}
            >
              <Text className="text-base font-extrabold text-white">{adding ? 'Adding...' : 'Add To Today Log'}</Text>
            </TouchableOpacity>
          </>
        )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
