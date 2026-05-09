           import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

const C = {
  bg: '#060D09',
  card: 'rgba(25,25,25,1)',
  cardBorder: 'rgba(29,36,31,0.18)',
  accent: '#00E676',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.50)',
  muted: 'rgba(255,255,255,0.30)',
};

const activityOptions = [
  { key: 'sedentary', label: 'Sedentary', desc: 'Little or no exercise', multiplier: 1.2 },
  { key: 'light', label: 'Light', desc: '1-3 days per week', multiplier: 1.375 },
  { key: 'moderate', label: 'Moderate', desc: '3-5 days per week', multiplier: 1.55 },
  { key: 'active', label: 'Active', desc: '6-7 days per week', multiplier: 1.725 },
  { key: 'very', label: 'Very Active', desc: 'Physical job or 2x training', multiplier: 1.9 },
];

const goalOptions = [
  { key: 'maintain', label: 'Maintain', desc: 'No change', adjust: 0 },
  { key: 'lose', label: 'Lose Weight', desc: '-500 kcal', adjust: -500 },
  { key: 'gain', label: 'Gain Weight', desc: '+500 kcal', adjust: 500 },
];

const calculateBmr = (gender: 'male' | 'female', age: number, weightKg: number, heightCm: number) => {
  if (gender === 'male') return 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  return 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
};

function CaloriesMeter({ total }: { total: number }) {
  const size = 170;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const maxCalories = 4000;
  const progress = Math.max(0, Math.min(total / maxCalories, 1));
  const offset = circumference * (1 - progress);

  return (
    <View style={{ alignItems: 'center', marginBottom: 16 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Defs>
            <SvgGradient id="calories-ring" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#00E676" />
              <Stop offset="100%" stopColor="#6CFFB0" />
            </SvgGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="transparent" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="url(#calories-ring)"
            strokeWidth={stroke}
            fill="transparent"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.white, fontSize: 22, fontWeight: '800' }}>{Math.round(total)}</Text>
          <Text style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>kcal/day</Text>
        </View>
      </View>
      <Text style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>Target scale {maxCalories} kcal</Text>
    </View>
  );
}

export default function CaloriesCalculatorScreen() {
  const router = useRouter();
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [activity, setActivity] = useState(activityOptions[0]);
  const [goal, setGoal] = useState(goalOptions[0]);
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState<{ bmr: number; tdee: number; total: number } | null>(null);

  const handleCalculate = () => {
    const ageNum = Number(age);
    const weightNum = Number(weight);
    const heightNum = Number(height);
    if (!ageNum || !weightNum || !heightNum) {
      Alert.alert('Error', 'Please enter age, weight, and height.');
      return;
    }
    const bmr = calculateBmr(gender, ageNum, weightNum, heightNum);
    const tdee = bmr * activity.multiplier;
    const total = tdee + goal.adjust;
    setResult({ bmr, tdee, total });
    setShowResult(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ position: 'absolute', top: -80, right: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(0,230,118,0.06)' }} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 20 }}>
              <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                <Ionicons name="chevron-back" size={20} color={C.white} />
              </TouchableOpacity>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white }}>Calories Calculator</Text>
            </View>

            {!showResult && (
              <>
                <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Gender</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                  {(['male', 'female'] as const).map((g) => (
                    <TouchableOpacity key={g} onPress={() => setGender(g)} activeOpacity={0.7}
                      style={{ flex: 1, backgroundColor: gender === g ? 'rgba(0,230,118,0.15)' : C.card, borderRadius: 14, borderWidth: 1.5, borderColor: gender === g ? C.accent : C.cardBorder, paddingVertical: 16, alignItems: 'center' }}>
                      <Ionicons name={g === 'male' ? 'male' : 'female'} size={28} color={gender === g ? C.accent : C.muted} />
                      <Text style={{ color: gender === g ? C.white : C.muted, fontSize: 13, fontWeight: '700', marginTop: 6 }}>{g === 'male' ? 'Male' : 'Female'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {[{ label: 'Age', value: age, set: setAge, placeholder: '25', unit: 'years' },
                  { label: 'Weight', value: weight, set: setWeight, placeholder: '70', unit: 'kg' },
                  { label: 'Height', value: height, set: setHeight, placeholder: '175', unit: 'cm' },
                ].map((field) => (
                  <View key={field.label} style={{ marginBottom: 16 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 0.5, marginBottom: 8 }}>{field.label}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 16, height: 50 }}>
                      <TextInput style={{ flex: 1, color: C.white, fontSize: 16, fontWeight: '600' }} placeholder={field.placeholder} placeholderTextColor={C.muted} keyboardType="numeric" value={field.value} onChangeText={field.set} />
                      <Text style={{ color: C.muted, fontSize: 13 }}>{field.unit}</Text>
                    </View>
                  </View>
                ))}

                <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Activity</Text>
                {activityOptions.map((option) => (
                  <TouchableOpacity key={option.key} activeOpacity={0.7} onPress={() => setActivity(option)}
                    style={{ backgroundColor: activity.key === option.key ? 'rgba(0,230,118,0.15)' : C.card, borderRadius: 14, borderWidth: 1, borderColor: activity.key === option.key ? C.accent : C.cardBorder, padding: 14, marginBottom: 10 }}>
                    <Text style={{ color: C.white, fontSize: 13, fontWeight: '700' }}>{option.label}</Text>
                    <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{option.desc}</Text>
                  </TouchableOpacity>
                ))}

                <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginTop: 6 }}>Goal</Text>
                {goalOptions.map((option) => (
                  <TouchableOpacity key={option.key} activeOpacity={0.7} onPress={() => setGoal(option)}
                    style={{ backgroundColor: goal.key === option.key ? 'rgba(0,230,118,0.15)' : C.card, borderRadius: 14, borderWidth: 1, borderColor: goal.key === option.key ? C.accent : C.cardBorder, padding: 14, marginBottom: 10 }}>
                    <Text style={{ color: C.white, fontSize: 13, fontWeight: '700' }}>{option.label}</Text>
                    <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{option.desc}</Text>
                  </TouchableOpacity>
                ))}

                <TouchableOpacity onPress={handleCalculate} activeOpacity={0.8} style={{ borderRadius: 14, overflow: 'hidden', marginTop: 8, marginBottom: 24 }}>
                  <LinearGradient colors={[C.accent, '#178A52']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 52, justifyContent: 'center', alignItems: 'center', borderRadius: 14 }}>
                    <Text style={{ color: '#050505', fontSize: 16, fontWeight: '700' }}>Calculate Calories</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}

            {showResult && result && (
              <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ color: C.white, fontSize: 16, fontWeight: '800' }}>Result</Text>
                  <Text style={{ color: C.muted, fontSize: 12 }}>Daily Calories</Text>
                </View>
                <CaloriesMeter total={result.total} />
                <Text style={{ color: C.accent, fontSize: 26, fontWeight: '800', marginBottom: 10 }}>{Math.round(result.total)} kcal</Text>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, backgroundColor: 'rgba(0,230,118,0.08)', borderRadius: 14, padding: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>BMR</Text>
                    <Text style={{ color: C.white, fontSize: 18, fontWeight: '800' }}>{Math.round(result.bmr)}</Text>
                    <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>kcal/day</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: 'rgba(0,230,118,0.08)', borderRadius: 14, padding: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>TDEE</Text>
                    <Text style={{ color: C.white, fontSize: 18, fontWeight: '800' }}>{Math.round(result.tdee)}</Text>
                    <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>kcal/day</Text>
                  </View>
                </View>
                <Text style={{ color: C.muted, fontSize: 11, marginTop: 10 }}>Goal adjustment: {goal.adjust > 0 ? `+${goal.adjust}` : goal.adjust} kcal</Text>
              </View>
            )}

            {showResult && (
              <TouchableOpacity onPress={() => setShowResult(false)} activeOpacity={0.8} style={{ marginTop: 16, borderRadius: 14, overflow: 'hidden' }}>
                <View style={{ height: 48, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>Edit Inputs</Text>
                </View>
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
