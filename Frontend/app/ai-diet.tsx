import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDietPlan, setAuthToken } from '../services/api';
import GFLoader from '../components/GFLoader';

const C = { bg: '#060D09', card: '#0F1A13', cardBorder: 'rgba(31,164,99,0.12)', accent: '#1FA463', white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)', gold: '#C8A84E' };

export default function AIDietScreen() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedGoal, setSelectedGoal] = useState('');

  const fetchPlan = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);
      const res = await getDietPlan();
      setData(res.data);
      setSelectedGoal(res.data.currentGoal || 'maintain');
    } catch (e) { console.warn('Diet plan error', e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { fetchPlan(); }, [fetchPlan]));

  if (loading) return <GFLoader message="Generating diet plan..." />;
  if (!data) return <GFLoader message="No plan available" />;

  const plan = data.plan;
  const goalCal = data.goalCalories || 2000;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 16 }}>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center', marginRight: 14, borderWidth: 1, borderColor: C.cardBorder }}>
              <Ionicons name="chevron-back" size={20} color={C.white} />
            </TouchableOpacity>
            <View><Text style={{ fontSize: 22, fontWeight: '800', color: C.white }}>AI Diet Plan</Text>
            <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>Personalized for {data.userName}</Text></View>
          </View>

          {/* Diet preference badge */}
          <View style={{ flexDirection: 'row', marginBottom: 16 }}>
            <View style={{ backgroundColor: 'rgba(31,164,99,0.12)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}>
              <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>🥗 {data.dietPreference}</Text>
            </View>
          </View>

          {/* Summary */}
          <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16, marginBottom: 20, flexDirection: 'row', justifyContent: 'space-around' }}>
            <View style={{ alignItems: 'center' }}><Text style={{ color: C.accent, fontSize: 22, fontWeight: '800' }}>{plan.totalCalories}</Text><Text style={{ color: C.muted, fontSize: 10 }}>Plan kcal</Text></View>
            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
            <View style={{ alignItems: 'center' }}><Text style={{ color: C.gold, fontSize: 22, fontWeight: '800' }}>{goalCal}</Text><Text style={{ color: C.muted, fontSize: 10 }}>Your goal</Text></View>
            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
            <View style={{ alignItems: 'center' }}><Text style={{ color: C.white, fontSize: 22, fontWeight: '800' }}>{plan.mealsCount}</Text><Text style={{ color: C.muted, fontSize: 10 }}>Meals</Text></View>
          </View>

          {/* Plan title */}
          <Text style={{ fontSize: 16, fontWeight: '800', color: C.white, marginBottom: 4 }}>{plan.title}</Text>
          <Text style={{ fontSize: 12, color: C.label, marginBottom: 16 }}>{plan.description}</Text>

          {/* Meals */}
          {plan.meals.map((meal: any, i: number) => (
            <View key={i} style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, padding: 16, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>{meal.time}</Text>
                <View style={{ backgroundColor: 'rgba(31,164,99,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                  <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>{meal.total} kcal</Text>
                </View>
              </View>
              {meal.items.map((item: string, j: number) => (
                <View key={j} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.accent, marginRight: 10 }} />
                  <Text style={{ color: C.label, fontSize: 12, flex: 1 }}>{item}</Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
