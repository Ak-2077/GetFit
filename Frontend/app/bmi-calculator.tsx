import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { calculateBMI } from '../services/api';

const C = { bg: '#060D09', card: '#0F1A13', cardBorder: 'rgba(31,164,99,0.12)', accent: '#1FA463', white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)' };

export default function BMICalculatorScreen() {
  const router = useRouter();
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [gender, setGender] = useState('male');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleCalculate = async () => {
    if (!weight || !height) { Alert.alert('Error', 'Please enter weight and height'); return; }
    try {
      setLoading(true);
      const res = await calculateBMI({ age: Number(age) || 25, weight: Number(weight), height: Number(height), gender });
      setResult(res.data);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Calculation failed');
    } finally { setLoading(false); }
  };

  const getBMIPosition = (bmi: number) => Math.min(Math.max(((bmi - 10) / 35) * 100, 0), 100);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ position: 'absolute', top: -80, right: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(31,164,99,0.06)' }} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 20 }}>
              <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                <Ionicons name="chevron-back" size={20} color={C.white} />
              </TouchableOpacity>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white }}>BMI Calculator</Text>
            </View>

            {/* Gender Selection */}
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>Gender</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
              {(['male', 'female'] as const).map((g) => (
                <TouchableOpacity key={g} onPress={() => setGender(g)} activeOpacity={0.7}
                  style={{ flex: 1, backgroundColor: gender === g ? 'rgba(31,164,99,0.15)' : C.card, borderRadius: 14, borderWidth: 1.5, borderColor: gender === g ? C.accent : C.cardBorder, paddingVertical: 16, alignItems: 'center' }}>
                  <Ionicons name={g === 'male' ? 'male' : 'female'} size={28} color={gender === g ? C.accent : C.muted} />
                  <Text style={{ color: gender === g ? C.white : C.muted, fontSize: 13, fontWeight: '700', marginTop: 6 }}>{g === 'male' ? 'Male' : 'Female'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Input Fields */}
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

            {/* Calculate Button */}
            <TouchableOpacity onPress={handleCalculate} disabled={loading} activeOpacity={0.8} style={{ borderRadius: 14, overflow: 'hidden', marginTop: 8, marginBottom: 24 }}>
              <LinearGradient colors={[C.accent, '#178A52']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 52, justifyContent: 'center', alignItems: 'center', borderRadius: 14 }}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{loading ? 'Calculating...' : 'Calculate BMI'}</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Result */}
            {result && (
              <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 20 }}>
                {/* BMI Value */}
                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <Text style={{ fontSize: 48, fontWeight: '800', color: result.color }}>{result.bmi}</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: C.white, marginTop: 4 }}>{result.category}</Text>
                </View>

                {/* Color Meter */}
                <View style={{ marginBottom: 20 }}>
                  <View style={{ height: 8, borderRadius: 4, overflow: 'hidden' }}>
                    <LinearGradient colors={['#FF4D4D', '#FFA500', '#1FA463', '#FFA500', '#FF4D4D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 4 }} />
                  </View>
                  {/* Indicator */}
                  <View style={{ position: 'absolute', top: -6, left: `${getBMIPosition(result.bmi)}%` as any, marginLeft: -8 }}>
                    <View style={{ width: 16, height: 20, borderRadius: 8, backgroundColor: result.color, borderWidth: 2, borderColor: C.white }} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                    <Text style={{ color: C.muted, fontSize: 9 }}>Underweight</Text>
                    <Text style={{ color: C.muted, fontSize: 9 }}>Normal</Text>
                    <Text style={{ color: C.muted, fontSize: 9 }}>Overweight</Text>
                    <Text style={{ color: C.muted, fontSize: 9 }}>Obese</Text>
                  </View>
                </View>

                {/* Extra Info */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, backgroundColor: 'rgba(31,164,99,0.08)', borderRadius: 14, padding: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>BMR</Text>
                    <Text style={{ color: C.white, fontSize: 18, fontWeight: '800' }}>{result.bmr}</Text>
                    <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>kcal/day</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: 'rgba(31,164,99,0.08)', borderRadius: 14, padding: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>Ideal Weight</Text>
                    <Text style={{ color: C.white, fontSize: 16, fontWeight: '800' }}>{result.idealWeightRange?.min}-{result.idealWeightRange?.max}</Text>
                    <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>kg</Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
