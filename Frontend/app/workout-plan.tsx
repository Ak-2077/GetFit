import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWorkoutPlan, setAuthToken } from '../services/api';
import GFLoader from '../components/GFLoader';

const C = { bg: '#060D09', card: '#0F1A13', cardBorder: 'rgba(31,164,99,0.12)', accent: '#1FA463', white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)' };

export default function WorkoutPlanScreen() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDay, setExpandedDay] = useState(0);

  const fetchPlan = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);
      const res = await getWorkoutPlan();
      setData(res.data);
    } catch (e) { console.warn('Workout plan error', e); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { fetchPlan(); }, [fetchPlan]));

  if (loading) return <GFLoader message="Building workout plan..." />;
  if (!data) return <GFLoader message="No plan available" />;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 16 }}>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center', marginRight: 14, borderWidth: 1, borderColor: C.cardBorder }}>
              <Ionicons name="chevron-back" size={20} color={C.white} />
            </TouchableOpacity>
            <View><Text style={{ fontSize: 22, fontWeight: '800', color: C.white }}>Weekly Plan</Text>
              <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>{data.userName}'s schedule</Text></View>
          </View>

          {/* Stats */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
            <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 14, alignItems: 'center' }}>
              <Text style={{ color: C.accent, fontSize: 18, fontWeight: '800' }}>{data.level}</Text>
              <Text style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>Level</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 14, alignItems: 'center' }}>
              <Text style={{ color: C.white, fontSize: 18, fontWeight: '800' }}>{data.workoutDays}</Text>
              <Text style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>Workout Days</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 14, alignItems: 'center' }}>
              <Text style={{ color: '#60A5FA', fontSize: 18, fontWeight: '800' }}>{data.totalWeeklyDuration}</Text>
              <Text style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>Total</Text>
            </View>
          </View>

          {/* Days */}
          {data.schedule.map((d: any, i: number) => {
            const isOpen = expandedDay === i;
            return (
              <TouchableOpacity key={d.day} onPress={() => setExpandedDay(isOpen ? -1 : i)} activeOpacity={0.8}
                style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: isOpen ? C.accent : C.cardBorder, padding: 16, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isOpen ? 'rgba(31,164,99,0.15)' : 'rgba(255,255,255,0.04)', justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ color: isOpen ? C.accent : C.muted, fontSize: 12, fontWeight: '800' }}>{d.day.slice(0, 2)}</Text>
                    </View>
                    <View>
                      <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>{d.focus}</Text>
                      <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{d.duration} • {d.exerciseCount} exercises • Rest: {d.restBetween}</Text>
                    </View>
                  </View>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
                </View>
                {isOpen && (
                  <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
                    {d.exercises.map((ex: string, j: number) => (
                      <TouchableOpacity key={j} onPress={() => router.push(`/home-workout-player?mode=home&bodyPart=${d.focus.split(' ')[0].toLowerCase()}` as any)}
                        style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(31,164,99,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                          <Text style={{ color: C.accent, fontSize: 10, fontWeight: '800' }}>{j + 1}</Text>
                        </View>
                        <Text style={{ color: C.label, fontSize: 13, flex: 1 }}>{ex}</Text>
                        <Ionicons name="play-circle-outline" size={18} color={C.accent} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
