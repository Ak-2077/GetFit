import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { calculateBMB } from '../services/api';

const C = { bg: '#060D09', card: '#0F1A13', cardBorder: 'rgba(31,164,99,0.12)', accent: '#1FA463', white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)' };

export default function BMBScreen() {
  const router = useRouter();
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleCalc = async () => {
    if (!protein && !carbs && !fat) { Alert.alert('Error', 'Enter at least one macro value'); return; }
    try {
      setLoading(true);
      const res = await calculateBMB({ protein: Number(protein) || 0, carbs: Number(carbs) || 0, fat: Number(fat) || 0, fiber: Number(fiber) || 0 });
      setResult(res.data);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Calculation failed');
    } finally { setLoading(false); }
  };

  const col = (s: number) => s >= 80 ? '#1FA463' : s >= 50 ? '#FFA500' : '#FF4D4D';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 20 }}>
              <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center', marginRight: 14, borderWidth: 1, borderColor: C.cardBorder }}>
                <Ionicons name="chevron-back" size={20} color={C.white} />
              </TouchableOpacity>
              <View><Text style={{ fontSize: 22, fontWeight: '800', color: C.white }}>Balance Meal Meter</Text>
              <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>Check your meal balance</Text></View>
            </View>
            {[['Protein (g)', protein, setProtein, '30'], ['Carbs (g)', carbs, setCarbs, '60'], ['Fat (g)', fat, setFat, '15'], ['Fiber (g)', fiber, setFiber, '8']].map(([l, v, s, p]: any) => (
              <View key={l} style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, marginBottom: 6 }}>{l}</Text>
                <View style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 16, height: 48, justifyContent: 'center' }}>
                  <TextInput style={{ color: C.white, fontSize: 16, fontWeight: '600' }} placeholder={p} placeholderTextColor={C.muted} keyboardType="numeric" value={v} onChangeText={s} />
                </View>
              </View>
            ))}
            <TouchableOpacity onPress={handleCalc} disabled={loading} activeOpacity={0.8} style={{ borderRadius: 14, overflow: 'hidden', marginVertical: 16 }}>
              <LinearGradient colors={['#60A5FA', '#3B82F6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 52, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{loading ? 'Analyzing...' : 'Analyze Balance'}</Text>
              </LinearGradient>
            </TouchableOpacity>
            {result && (
              <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 20 }}>
                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <Text style={{ fontSize: 48, fontWeight: '800', color: col(result.overallScore) }}>{result.overallScore}</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: C.white }}>{result.rating}</Text>
                  <Text style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{result.totalCalories} kcal total</Text>
                </View>
                {[
                  { l: 'Protein', pct: result.macros.protein.percentage, ideal: result.macros.protein.ideal, c: '#1FA463' },
                  { l: 'Carbs', pct: result.macros.carbs.percentage, ideal: result.macros.carbs.ideal, c: '#60A5FA' },
                  { l: 'Fat', pct: result.macros.fat.percentage, ideal: result.macros.fat.ideal, c: '#FFA500' },
                ].map((m) => (
                  <View key={m.l} style={{ marginBottom: 14 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ color: C.white, fontSize: 13, fontWeight: '600' }}>{m.l}: {m.pct}%</Text>
                      <Text style={{ color: C.muted, fontSize: 11 }}>Ideal: {m.ideal}</Text>
                    </View>
                    <View style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: m.c, width: `${Math.min(m.pct, 100)}%` as any }} />
                    </View>
                  </View>
                ))}
                <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, marginTop: 8, marginBottom: 10, textTransform: 'uppercase' }}>Tips</Text>
                {result.tips.map((t: string, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', marginBottom: 8 }}>
                    <Ionicons name="checkmark-circle" size={14} color={C.accent} style={{ marginRight: 8, marginTop: 2 }} />
                    <Text style={{ color: C.white, fontSize: 12, flex: 1, lineHeight: 18 }}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
