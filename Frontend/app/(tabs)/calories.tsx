import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getTodaysFoodLog, addBrandFood, getMe, updateProfile, generateActivityGoal } from '../../services/api';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function CaloriesScreen() {
  const router = useRouter();
  const [foodLog, setFoodLog] = useState<Array<{ _id: string; foodId?: { name?: string; source?: string }; quantity: number; caloriesConsumed: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [totalCalories, setTotalCalories] = useState(0);
  const [user, setUser] = useState<any | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<'checking' | 'active' | 'denied' | 'error'>('checking');
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [aiGoalLoading, setAiGoalLoading] = useState(false);
  const [aiGoalPlan, setAiGoalPlan] = useState<{ title: string; summary: string; goals: string[]; stepGoal?: number } | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);

  const [foodName, setFoodName] = useState('');
  const [foodCalories, setFoodCalories] = useState('');
  const [foodBrand, setFoodBrand] = useState('');
  const [foodProtein, setFoodProtein] = useState('');
  const [foodCarbs, setFoodCarbs] = useState('');
  const [foodFat, setFoodFat] = useState('');

  const [barcodeInput, setBarcodeInput] = useState('');

  const dailyGoal = 2200;

  useEffect(() => {
    loadTodaysFoodLog();
    loadProfile();
    loadTrackingPreference();
  }, []);

  const loadTrackingPreference = async () => {
    try {
      const saved = await AsyncStorage.getItem('locationTrackingEnabled');
      setTrackingEnabled(saved === 'true');
    } catch (err) {
      console.warn('Failed to load tracking preference', err);
    }
  };

  const toggleTracking = async (value: boolean) => {
    try {
      await AsyncStorage.setItem('locationTrackingEnabled', value.toString());
      setTrackingEnabled(value);
      if (value) {
        Alert.alert('Tracking Enabled', 'Location tracking is now active. Keep the app open to track your movement.');
      } else {
        Alert.alert('Tracking Disabled', 'Location tracking has been turned off.');
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to update tracking preference');
      console.warn(err);
    }
  };

  useFocusEffect(
    useCallback(() => {
      console.log('Calories tab focused - refreshing data');
      loadTodaysFoodLog();
      loadProfile();

      let cancelled = false;
      const checkPermission = async () => {
        try {
          const permission = await Location.getForegroundPermissionsAsync();
          if (!cancelled) {
            setTrackingStatus(permission.status === 'granted' ? 'active' : 'denied');
          }
        } catch {
          if (!cancelled) setTrackingStatus('error');
        }
      };

      checkPermission();

      return () => {
        cancelled = true;
      };
    }, [])
  );

  const loadTodaysFoodLog = async () => {
    try {
      setLoading(true);
      const res = await getTodaysFoodLog();
      setFoodLog(res.data.logs || []);
      setTotalCalories(res.data.totalCalories || 0);
    } catch (err) {
      console.warn('Failed to load food log', err);
    } finally {
      setLoading(false);
    }
  };

  const loadProfile = async () => {
    try {
      const res = await getMe();
      setUser(res.data);
    } catch (err) {
      console.warn('Failed to load profile', err);
    }
  };

  const loadAiActivityGoal = async () => {
    try {
      setAiGoalLoading(true);
      const res = await generateActivityGoal();
      const rawStepGoal = Number(res.data?.stepGoal);
      const normalizedStepGoal = Number.isFinite(rawStepGoal)
        ? Math.max(6000, Math.min(12000, Math.round(rawStepGoal)))
        : undefined;

      setAiGoalPlan({
        title: res.data?.title || 'AI Activity Goal',
        summary: res.data?.summary || '',
        goals: Array.isArray(res.data?.goals) ? res.data.goals : [],
        stepGoal: normalizedStepGoal,
      });
    } catch (err) {
      setAiGoalPlan(null);
      console.warn('Failed to generate AI activity goal', err);
    } finally {
      setAiGoalLoading(false);
    }
  };

  const handleAddBrandFood = async () => {
    try {
      if (!foodName || !foodCalories) {
        Alert.alert('Error', 'Food name and calories are required');
        return;
      }

      await addBrandFood({
        name: foodName,
        brand: foodBrand,
        calories: parseInt(foodCalories),
        protein: foodProtein ? parseInt(foodProtein) : undefined,
        carbs: foodCarbs ? parseInt(foodCarbs) : undefined,
        fat: foodFat ? parseInt(foodFat) : undefined,
      });

      Alert.alert('Success', 'Food added!');
      resetFoodForm();
      setShowAddModal(false);
    } catch (err) {
      Alert.alert('Error', 'Failed to add food');
      console.warn(err);
    }
  };

  const handleScanBarcode = async () => {
    if (!barcodeInput.trim()) {
      Alert.alert('Error', 'Enter a barcode');
      return;
    }

    const barcode = barcodeInput.trim();
    setBarcodeInput('');
    setShowBarcodeModal(false);
    router.push({ pathname: '/food-details', params: { barcode } });
  };

  const handleSeeFullTips = () => {
    if (!aiGoalPlan) {
      Alert.alert('AI Tips', 'Tips are not available yet. Please refresh first.');
      return;
    }

    const dietLabel = user?.dietPreference === 'veg' ? 'Veg' : user?.dietPreference === 'non_veg' ? 'Non-Veg' : 'Not set';
    const tips = aiGoalPlan.goals.length ? aiGoalPlan.goals.map((goal, index) => `${index + 1}. ${goal}`).join('\n') : 'No tips available.';

    Alert.alert('AI Tips + Diet Plan', `Diet: ${dietLabel}\n\n${aiGoalPlan.summary}\n\n${tips}`);
  };

  const resetFoodForm = () => {
    setFoodName('');
    setFoodCalories('');
    setFoodBrand('');
    setFoodProtein('');
    setFoodCarbs('');
    setFoodFat('');
  };

  const steps = user?.steps || 0;
  const stepDistanceKm = user?.stepDistanceKm || 0;
  const stepGoal = aiGoalPlan?.stepGoal || 10000;
  const stepProgress = Math.min(100, Math.round((steps / stepGoal) * 100));
  const recentFoodLogs = foodLog.slice(0, 3);

  useEffect(() => {
    if (user?.goal) {
      loadAiActivityGoal();
    } else {
      setAiGoalPlan(null);
    }
  }, [user?.goal]);

  return (
    <SafeAreaView className="flex-1 bg-[#0A0A0A]">
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1">
        
        <View className="px-6 pt-8 pb-4">
          <Text className="text-white text-4xl font-bold">Calories</Text>
          <Text className="text-gray-400 text-base mt-2">Track your nutrition</Text>
        </View>

        <View className="px-6 py-4">
          <View className="bg-[#141414] rounded-3xl p-4 border border-[#262626]">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-white text-lg font-bold">Activity</Text>
              <View className="flex-row items-center">
                <View className="flex-row items-center">
                  <Text className={`text-xs font-semibold mr-2 ${trackingEnabled ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {trackingEnabled ? 'ON' : 'OFF'}
                  </Text>
                  <Switch
                    value={trackingEnabled}
                    onValueChange={toggleTracking}
                    trackColor={{ false: '#374151', true: '#10b981' }}
                    thumbColor={trackingEnabled ? '#fff' : '#9ca3af'}
                  />
                </View>
              </View>
            </View>
            <View className="bg-[#111111] rounded-2xl p-4 border border-[#262626] mb-3">
              <View className="flex-row justify-between items-center mb-2">
                <Text className="text-white font-semibold">Steps Progress</Text>
                <Text className="text-sky-400 font-bold">{stepProgress}%</Text>
              </View>
              <View className="h-2 w-full bg-[#1f2937] rounded-full overflow-hidden">
                <View className="h-2 bg-sky-500 rounded-full" style={{ width: `${stepProgress}%` }} />
              </View>
              <Text className="text-gray-400 text-xs mt-2">Goal: {stepGoal} steps</Text>
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1">
                <View className="bg-[#111111] rounded-2xl p-3 border border-[#262626] mt-2">
                  <Text className="text-white font-semibold">Step Count</Text>
                  <Text className="text-gray-400 text-xs mt-1">Today</Text>
                  <Text className="text-sky-400 text-lg font-bold mt-2">{steps}</Text>
                </View>
              </View>

              <View className="flex-1">
                <View className="bg-[#111111] rounded-2xl p-3 border border-[#262626] mt-2">
                  <Text className="text-white font-semibold">Step Distance</Text>
                  <Text className="text-gray-400 text-xs mt-1">Today</Text>
                  <Text className="text-emerald-400 text-lg font-bold mt-2">{`${stepDistanceKm} KM`}</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Activity Suggestions based on Goal */}
        {user?.goal && (
          <View className="px-6 py-4">
            <View className="bg-[#151515] rounded-3xl p-5 border border-[#2E2E2E] mb-4">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-white text-lg font-semibold">AI Tips</Text>
                <TouchableOpacity
                  onPress={loadAiActivityGoal}
                  disabled={aiGoalLoading}
                  className={`w-8 h-8 rounded-full border items-center justify-center ${aiGoalLoading ? 'border-[#3A3A3A] bg-[#1E1E1E] opacity-70' : 'border-[#4A4A4A] bg-[#232323]'}`}
                  activeOpacity={0.8}
                >
                  <FontAwesome name={aiGoalLoading ? 'spinner' : 'refresh'} size={13} color="#D1D5DB" />
                </TouchableOpacity>
              </View>

              {aiGoalPlan ? (
                <>
                  <Text className="text-gray-300 text-sm mb-3">{aiGoalPlan.summary}</Text>
                  <View className="gap-2">
                    {aiGoalPlan.goals.map((goal, index) => (
                      <View key={`${goal}-${index}`} className="flex-row items-start">
                        <Text className="text-gray-300 mr-2">•</Text>
                        <Text className="text-gray-300 flex-1">{goal}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <Text className="text-gray-400 text-sm">AI plan not available right now.</Text>
              )}

              <TouchableOpacity
                onPress={handleSeeFullTips}
                className={`mt-4 rounded-2xl border px-4 py-3 items-center ${aiGoalLoading ? 'bg-[#1D1D1D] border-[#333333] opacity-60' : 'bg-[#232323] border-[#3A3A3A]'}`}
                activeOpacity={0.8}
              >
                <Text className="text-white font-semibold">See full tips with diet plan</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View className="px-6 py-6">
          <Text className="text-white text-lg font-bold mb-4">Count Calories</Text>
          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => setShowAddModal(true)}
              className="flex-1 bg-[#1C1C1C] rounded-3xl p-4 border border-[#323232]"
              activeOpacity={0.8}
            >
              <View className="w-10 h-10 rounded-xl bg-[#2A2A2A] border border-[#3B3B3B] items-center justify-center mb-3">
                <FontAwesome name="plus" size={18} color="#fff" />
              </View>
              <Text className="text-white font-bold text-base mb-1">Manual</Text>
              <Text className="text-gray-300 text-xs">Add food details yourself</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowBarcodeModal(true)}
              className="flex-1 bg-[#202020] rounded-3xl p-4 border border-[#3A3A3A]"
              activeOpacity={0.8}
            >
              <View className="w-10 h-10 rounded-xl bg-[#2D2D2D] border border-[#3F3F3F] items-center justify-center mb-3">
                <FontAwesome name="barcode" size={18} color="#fff" />
              </View>
              <Text className="text-white font-bold text-base mb-1">Scan</Text>
              <Text className="text-gray-300 text-xs">Scan barcode instantly</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View className="px-6 pb-4">
          <View className="bg-[#141414] rounded-3xl p-4 border border-[#2A2A2A]">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-white text-base font-semibold">Recent Foods</Text>
              <Text className="text-gray-400 text-xs">Last 3</Text>
            </View>

            {recentFoodLogs.length === 0 ? (
              <Text className="text-gray-400 text-sm">No recent manual or scanned foods yet.</Text>
            ) : (
              <View className="gap-2">
                {recentFoodLogs.map((entry) => {
                  const sourceLabel = entry.foodId?.source === 'openfoodfacts' ? 'Scan' : 'Manual';
                  return (
                    <View key={entry._id} className="bg-[#1C1C1C] rounded-2xl px-3 py-3 border border-[#323232] flex-row items-center justify-between">
                      <View className="flex-1 pr-3">
                        <Text className="text-white text-sm font-medium" numberOfLines={1}>
                          {entry.foodId?.name || 'Food Item'}
                        </Text>
                        <Text className="text-gray-400 text-xs mt-1">
                          {sourceLabel} • Qty {entry.quantity}
                        </Text>
                      </View>
                      <Text className="text-gray-200 text-sm font-semibold">{Math.round(entry.caloriesConsumed || 0)} kcal</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </View>

        <View className="h-8" />
      </ScrollView>

      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <SafeAreaView className="flex-1 bg-[#0A0A0A]">
          <ScrollView className="px-6 py-6 flex-1">
            <View className="flex-row justify-between items-center mb-8">
              <Text className="text-white text-2xl font-bold">Add Food</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <FontAwesome name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <View className="gap-4">
              <View>
                <Text className="text-white font-semibold mb-2">Food Name *</Text>
                <TextInput className="bg-slate-800 text-white p-3 rounded-xl border border-gray-600" placeholder="e.g., Chicken" placeholderTextColor="#666" value={foodName} onChangeText={setFoodName} />
              </View>

              <View>
                <Text className="text-white font-semibold mb-2">Brand</Text>
                <TextInput className="bg-slate-800 text-white p-3 rounded-xl border border-gray-600" placeholder="e.g., Organic" placeholderTextColor="#666" value={foodBrand} onChangeText={setFoodBrand} />
              </View>

              <View>
                <Text className="text-white font-semibold mb-2">Calories *</Text>
                <TextInput className="bg-slate-800 text-white p-3 rounded-xl border border-gray-600" placeholder="e.g., 165" placeholderTextColor="#666" keyboardType="numeric" value={foodCalories} onChangeText={setFoodCalories} />
              </View>

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Text className="text-white font-semibold mb-2 text-sm">Protein</Text>
                  <TextInput className="bg-slate-800 text-white p-3 rounded-xl border border-gray-600" placeholder="g" placeholderTextColor="#666" keyboardType="numeric" value={foodProtein} onChangeText={setFoodProtein} />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-semibold mb-2 text-sm">Carbs</Text>
                  <TextInput className="bg-slate-800 text-white p-3 rounded-xl border border-gray-600" placeholder="g" placeholderTextColor="#666" keyboardType="numeric" value={foodCarbs} onChangeText={setFoodCarbs} />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-semibold mb-2 text-sm">Fat</Text>
                  <TextInput className="bg-slate-800 text-white p-3 rounded-xl border border-gray-600" placeholder="g" placeholderTextColor="#666" keyboardType="numeric" value={foodFat} onChangeText={setFoodFat} />
                </View>
              </View>

              <TouchableOpacity className="bg-[#1F1F1F] border border-[#383838] p-4 rounded-2xl items-center mt-6" onPress={handleAddBrandFood} activeOpacity={0.8}>
                <Text className="text-white font-bold text-lg">Add Food</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={showBarcodeModal} transparent animationType="slide" onRequestClose={() => { setShowBarcodeModal(false); }}>
        <SafeAreaView className="flex-1 bg-[#0A0A0A]">
          <View className="px-6 py-6 flex-1 justify-between">
            <View>
              <View className="flex-row justify-between items-center mb-8">
                <Text className="text-white text-2xl font-bold">Scan Food</Text>
                <TouchableOpacity onPress={() => setShowBarcodeModal(false)}>
                  <FontAwesome name="close" size={24} color="#fff" />
                </TouchableOpacity>
              </View>

              <View className="bg-[#121212] p-8 rounded-3xl items-center border border-[#2E2E2E]">
                <FontAwesome name="barcode" size={64} color="#CFCFCF" style={{ marginBottom: 20 }} />
                <Text className="text-white font-semibold mb-3">Enter Barcode</Text>
                <TextInput className="bg-[#1B1B1B] text-white p-4 rounded-2xl w-full border border-[#3A3A3A] mb-4" placeholder="e.g., 8901662024521" placeholderTextColor="#7A7A7A" value={barcodeInput} onChangeText={setBarcodeInput} keyboardType="default" autoFocus={true} />

                <TouchableOpacity className="bg-[#242424] border border-[#3E3E3E] p-4 rounded-2xl items-center w-full" onPress={handleScanBarcode}>
                  <Text className="text-white font-bold">Search</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="bg-[#1F1F1F] border border-[#383838] p-4 rounded-2xl items-center w-full mt-3"
                  onPress={() => { setShowBarcodeModal(false); router.push('/scan'); }}
                >
                  <Text className="text-white font-bold">Open Camera Scanner</Text>
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity className="bg-[#1F1F1F] border border-[#383838] p-4 rounded-2xl items-center w-full" onPress={() => { setShowBarcodeModal(false); router.push('/scan'); }}>
              <FontAwesome name="camera" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text className="text-white font-bold">Camera Scanner</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

