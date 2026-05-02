import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { calculateBMB, generateBMBPlan } from '../services/api';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';

const C = { bg: '#060D09', card: '#0F1A13', cardBorder: 'rgba(31,164,99,0.12)', accent: '#1FA463', white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)' };

const GOALS = [
  { key: 'lose', label: 'Lose Weight', icon: 'trending-down-outline' as const, color: '#FF6B6B' },
  { key: 'maintain', label: 'Maintain', icon: 'remove-outline' as const, color: '#1FA463' },
  { key: 'gain', label: 'Gain Weight', icon: 'trending-up-outline' as const, color: '#60A5FA' },
];

const getTips = (goal: string) => {
  const tips: { [key: string]: string[] } = {
    lose: [
      '🥗 Eat lean proteins to stay full longer',
      '💧 Drink plenty of water throughout the day',
      '🥕 Choose high-fiber vegetables for satiety',
      '⏰ Avoid eating late at night',
    ],
    maintain: [
      '⚖️ Keep meals consistent and balanced',
      '🏃 Combine nutrition with regular exercise',
      '🍎 Focus on whole, unprocessed foods',
      '📊 Monitor your weight weekly',
    ],
    gain: [
      '🍗 Increase protein with each meal',
      '🥜 Add calorie-dense healthy snacks',
      '💪 Pair nutrition with strength training',
      '📈 Track progress consistently',
    ],
  };
  return tips[goal] || tips.maintain;
};

const getGoalColor = (goal: string) => {
  if (goal === 'lose') return '#FF6B6B';
  if (goal === 'gain') return '#60A5FA';
  return '#1FA463';
};

const getGoalLabel = (goal: string) => {
  if (goal === 'lose') return 'Lose Weight';
  if (goal === 'gain') return 'Gain Weight';
  return 'Maintain Weight';
};

export default function BMBScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'setup' | 'meter'>('setup');
  
  // Setup mode state (for BMB plan generation)
  const [calories, setCalories] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [goal, setGoal] = useState('maintain');
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult, setSetupResult] = useState<any>(null);
  
  // Meter mode state (for meal balance)
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [meterResult, setMeterResult] = useState<any>(null);
  const [meterLoading, setMeterLoading] = useState(false);

  // BMB Setup Handler
  const handleGeneratePlan = async () => {
    if (!calories || !weight || !height) {
      Alert.alert('Missing Fields', 'Please fill in all fields');
      return;
    }
    if (Number(calories) <= 0) {
      Alert.alert('Invalid Calories', 'Enter a positive calorie value');
      return;
    }
    if (Number(weight) <= 0 || Number(height) <= 0) {
      Alert.alert('Invalid Input', 'Weight and height must be positive');
      return;
    }

    try {
      Keyboard.dismiss();
      setSetupLoading(true);
      const payload = { calories: Number(calories), weight: Number(weight), height: Number(height), goal };
      const res = await generateBMBPlan(payload);
      setSetupResult(res.data);
    } catch (e: any) {
      console.log('Error:', e);
      Alert.alert('Error', e?.response?.data?.message || e?.message || 'Failed to generate plan');
    } finally {
      setSetupLoading(false);
    }
  };

  // Meal Meter Handler
  const handleAnalyzeMeter = async () => {
    if (!protein && !carbs && !fat) {
      Alert.alert('Error', 'Enter at least one macro value');
      return;
    }
    try {
      Keyboard.dismiss();
      setMeterLoading(true);
      const res = await calculateBMB({ protein: Number(protein) || 0, carbs: Number(carbs) || 0, fat: Number(fat) || 0, fiber: Number(fiber) || 0 });
      setMeterResult(res.data);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Calculation failed');
    } finally {
      setMeterLoading(false);
    }
  };

  const col = (s: number) => s >= 80 ? '#1FA463' : s >= 50 ? '#FFA500' : '#FF4D4D';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ position: 'absolute', top: -80, right: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(31,164,99,0.06)' }} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
            
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 20 }}>
              <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center', marginRight: 14, borderWidth: 1, borderColor: C.cardBorder }}>
                <Ionicons name="chevron-back" size={20} color={C.white} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: C.white, letterSpacing: -0.3 }}>Balance Meal</Text>
                <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>Nutrition planner</Text>
              </View>
            </View>

            {/* ═══ SETUP MODE ═══ */}
            {mode === 'setup' && !setupResult && (
              <>
                <View style={{ backgroundColor: 'rgba(31,164,99,0.08)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(31,164,99,0.15)', padding: 14, marginBottom: 24, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(31,164,99,0.15)', justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name="information-circle-outline" size={18} color={C.accent} />
                  </View>
                  <Text style={{ fontSize: 11, color: C.label, flex: 1, lineHeight: 16 }}>Fill your details to get personalized daily macros</Text>
                </View>

                {/* Input Fields */}
                <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 18, marginBottom: 20 }}>
                  {[['Daily Calorie Target', calories, setCalories, '2000', 'flame', '#60A5FA'], ['Weight (kg)', weight, setWeight, '70', 'barbell', '#FFA500'], ['Height (cm)', height, setHeight, '175', 'resize', '#A6F7C2']].map(([l, v, s, p, icon, c]: any) => (
                    <View key={l} style={{ marginBottom: l === 'Height (cm)' ? 0 : 18 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                        <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: `${c}20`, justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                          <Ionicons name={icon as any} size={12} color={c} />
                        </View>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: C.white }}>{l}</Text>
                      </View>
                      <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(31,164,99,0.1)', paddingHorizontal: 14, height: 48, justifyContent: 'center' }}>
                        <TextInput style={{ color: C.white, fontSize: 16, fontWeight: '600' }} placeholder={p} placeholderTextColor={C.muted} keyboardType="numeric" value={v} onChangeText={s} />
                      </View>
                    </View>
                  ))}
                </View>

                {/* Goal Selection */}
                <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 12 }}>Select Your Goal</Text>
                <View style={{ marginBottom: 24 }}>
                  {GOALS.map((g) => (
                    <TouchableOpacity key={g.key} onPress={() => setGoal(g.key)} activeOpacity={0.7} style={{ marginBottom: 10 }}>
                      <View style={{ backgroundColor: goal === g.key ? 'rgba(31,164,99,0.15)' : C.card, borderRadius: 14, borderWidth: 2, borderColor: goal === g.key ? C.accent : C.cardBorder, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: `${g.color}20`, justifyContent: 'center', alignItems: 'center' }}>
                          <Ionicons name={g.icon} size={18} color={g.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: C.white }}>{g.label}</Text>
                        </View>
                        <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: goal === g.key ? C.accent : C.cardBorder, justifyContent: 'center', alignItems: 'center' }}>
                          {goal === g.key && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent }} />}
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Generate Button */}
                <TouchableOpacity onPress={handleGeneratePlan} disabled={setupLoading} activeOpacity={0.8} style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
                  <LinearGradient colors={['#1FA463', '#A6F7C2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 52, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: C.white, fontSize: 16, fontWeight: '700' }}>{setupLoading ? 'Generating...' : 'Generate Plan'}</Text>
                  </LinearGradient>
                </TouchableOpacity>

                {/* Switch to Meter */}
                <TouchableOpacity onPress={() => setMode('meter')} activeOpacity={0.8} style={{ borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, height: 48, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: C.accent, fontSize: 14, fontWeight: '700' }}>Or Analyze a Meal</Text>
                </TouchableOpacity>
              </>
            )}

            {/* ═══ SETUP RESULT ═══ */}
            {setupResult && (
              <>
                <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 20, alignItems: 'center', marginBottom: 24 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: C.label, marginBottom: 16, textTransform: 'uppercase' }}>📊 Your Daily Plan</Text>
                  <View style={{ gap: 12, width: '100%' }}>
                    {[
                      { label: 'Protein', value: setupResult.protein, unit: 'g', icon: 'nutrition-outline', color: '#1FA463', info: 'Muscle & recovery' },
                      { label: 'Carbs', value: setupResult.carbs, unit: 'g', icon: 'flame-outline', color: '#60A5FA', info: 'Energy source' },
                      { label: 'Fats', value: setupResult.fats, unit: 'g', icon: 'droplet-outline', color: '#FFA500', info: 'Hormones & absorption' },
                      { label: 'Fiber', value: setupResult.fiber, unit: 'g', icon: 'leaf-outline', color: '#A6F7C2', info: 'Digestive health' },
                    ].map((m) => (
                      <View key={m.label} style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: `${m.color}15`, justifyContent: 'center', alignItems: 'center' }}>
                          <Ionicons name={m.icon as any} size={20} color={m.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>{m.label}</Text>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: C.white }}>{m.value}{m.unit}</Text>
                          <Text style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{m.info}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Goal Tag */}
                <View style={{ backgroundColor: `${getGoalColor(setupResult.goal)}15`, borderRadius: 14, borderWidth: 1, borderColor: `${getGoalColor(setupResult.goal)}30`, padding: 12, marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: `${getGoalColor(setupResult.goal)}25`, justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name={setupResult.goal === 'lose' ? 'trending-down' : setupResult.goal === 'gain' ? 'trending-up' : 'remove'} size={16} color={getGoalColor(setupResult.goal)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>Goal</Text>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: C.white }}>{getGoalLabel(setupResult.goal)}</Text>
                  </View>
                </View>

                {/* Buttons */}
                <View style={{ gap: 12 }}>
                  <TouchableOpacity onPress={() => { setSetupResult(null); setCalories(''); setWeight(''); setHeight(''); }} activeOpacity={0.8} style={{ borderRadius: 14, overflow: 'hidden' }}>
                    <LinearGradient colors={['#1FA463', '#A6F7C2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 48, justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>Recalculate</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  
                  <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} style={{ borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, height: 48, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>Back to Home</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* ═══ METER MODE ═══ */}
            {mode === 'meter' && !meterResult && (
              <>
                <View style={{ backgroundColor: 'rgba(31,164,99,0.08)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(31,164,99,0.15)', padding: 14, marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(31,164,99,0.15)', justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name="nutrition-outline" size={18} color={C.accent} />
                  </View>
                  <Text style={{ fontSize: 11, color: C.label, flex: 1, lineHeight: 16 }}>Enter your meal macros to analyze balance</Text>
                </View>

                <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 18, marginBottom: 18 }}>
                  {[['Protein (g)', protein, setProtein, '30', '#1FA463'], ['Carbs (g)', carbs, setCarbs, '60', '#60A5FA'], ['Fat (g)', fat, setFat, '15', '#FFA500'], ['Fiber (g)', fiber, setFiber, '8', '#A6F7C2']].map(([l, v, s, p, c]: any) => (
                    <View key={l} style={{ marginBottom: l === 'Fiber (g)' ? 0 : 16 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                        <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: `${c}20`, justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: c }} />
                        </View>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: C.white }}>{l}</Text>
                      </View>
                      <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(31,164,99,0.1)', paddingHorizontal: 14, height: 48, justifyContent: 'center' }}>
                        <TextInput style={{ color: C.white, fontSize: 16, fontWeight: '600' }} placeholder={p} placeholderTextColor={C.muted} keyboardType="numeric" value={v} onChangeText={s} />
                      </View>
                    </View>
                  ))}
                </View>

                <TouchableOpacity onPress={handleAnalyzeMeter} disabled={meterLoading} activeOpacity={0.8} style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
                  <LinearGradient colors={['#1FA463', '#A6F7C2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 52, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: C.white, fontSize: 16, fontWeight: '700' }}>{meterLoading ? 'Analyzing...' : 'Analyze Balance'}</Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setMode('setup')} activeOpacity={0.8} style={{ borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, height: 48, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: C.accent, fontSize: 14, fontWeight: '700' }}>Or Generate a Plan</Text>
                </TouchableOpacity>
              </>
            )}

            {/* ═══ METER RESULT ═══ */}
            {meterResult && (
              <>
                <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 20, marginBottom: 24 }}>
                  <View style={{ alignItems: 'center', marginBottom: 24, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
                    <Text style={{ fontSize: 48, fontWeight: '800', color: col(meterResult.overallScore), marginBottom: 6 }}>{meterResult.overallScore}</Text>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: C.white, marginBottom: 4 }}>{meterResult.rating}</Text>
                    <Text style={{ fontSize: 12, color: C.muted }}>Total: {meterResult.totalCalories} kcal</Text>
                  </View>

                  {[
                    { l: 'Protein', pct: meterResult.macros.protein.percentage, ideal: meterResult.macros.protein.ideal, c: '#1FA463' },
                    { l: 'Carbs', pct: meterResult.macros.carbs.percentage, ideal: meterResult.macros.carbs.ideal, c: '#60A5FA' },
                    { l: 'Fat', pct: meterResult.macros.fat.percentage, ideal: meterResult.macros.fat.ideal, c: '#FFA500' },
                  ].map((m) => (
                    <View key={m.l} style={{ marginBottom: 16 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ width: 3, height: 18, borderRadius: 1.5, backgroundColor: m.c }} />
                          <Text style={{ color: C.white, fontSize: 13, fontWeight: '600' }}>{m.l}</Text>
                        </View>
                        <Text style={{ color: m.c, fontSize: 14, fontWeight: '700' }}>{m.pct}%</Text>
                      </View>
                      <View style={{ height: 8, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4 }}>
                        <LinearGradient colors={[m.c, `${m.c}80`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 8, borderRadius: 4, width: `${Math.min(m.pct, 100)}%` as any }} />
                      </View>
                      <Text style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Ideal: {m.ideal}</Text>
                    </View>
                  ))}

                  <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 16 }} />

                  <View>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>💡 Tips</Text>
                    {meterResult.tips.map((t: string, i: number) => (
                      <View key={i} style={{ flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' }}>
                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(31,164,99,0.15)', justifyContent: 'center', alignItems: 'center', marginRight: 10, marginTop: 2, flexShrink: 0 }}>
                          <Ionicons name="checkmark" size={12} color={C.accent} />
                        </View>
                        <Text style={{ color: C.white, fontSize: 12, flex: 1, lineHeight: 18 }}>{t}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <View style={{ gap: 12 }}>
                  <TouchableOpacity onPress={() => { setMeterResult(null); setProtein(''); setCarbs(''); setFat(''); setFiber(''); }} activeOpacity={0.8} style={{ borderRadius: 14, overflow: 'hidden' }}>
                    <LinearGradient colors={['#1FA463', '#A6F7C2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 48, justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>Analyze Another Meal</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                  
                  <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} style={{ borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, height: 48, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>Back to Home</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
