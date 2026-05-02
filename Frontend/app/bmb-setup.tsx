import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { generateBMBPlan } from '../services/api';

const C = { bg: '#060D09', card: '#0F1A13', cardBorder: 'rgba(31,164,99,0.12)', accent: '#1FA463', white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)' };

const GOALS = [
  { key: 'lose', label: 'Lose Weight', icon: 'trending-down-outline' as const, color: '#FF6B6B' },
  { key: 'maintain', label: 'Maintain', icon: 'remove-outline' as const, color: '#1FA463' },
  { key: 'gain', label: 'Gain Weight', icon: 'trending-up-outline' as const, color: '#60A5FA' },
];

export default function BMBSetupScreen() {
  const router = useRouter();
  const [calories, setCalories] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [goal, setGoal] = useState('maintain');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    // Validation
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
      setLoading(true);
      const payload = {
        calories: Number(calories),
        weight: Number(weight),
        height: Number(height),
        goal,
      };

      // Call backend
      const res = await generateBMBPlan(payload);
      
      // Navigate to result with data
      router.push({
        pathname: '/bmb-result',
        params: {
          data: JSON.stringify(res.data),
        },
      } as any);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Failed to generate plan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Background glow */}
      <View style={{ position: 'absolute', top: -80, right: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(31,164,99,0.06)' }} />
      
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
            
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 20 }}>
              <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center', marginRight: 14, borderWidth: 1, borderColor: C.cardBorder }}>
                <Ionicons name="chevron-back" size={20} color={C.white} />
              </TouchableOpacity>
              <View>
                <Text style={{ fontSize: 22, fontWeight: '800', color: C.white, letterSpacing: -0.3 }}>Balance Meal Setup</Text>
                <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>Create your nutrition plan</Text>
              </View>
            </View>

            {/* Info Card */}
            <View style={{ backgroundColor: 'rgba(31,164,99,0.08)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(31,164,99,0.15)', padding: 14, marginBottom: 24, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(31,164,99,0.15)', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="information-circle-outline" size={18} color={C.accent} />
              </View>
              <Text style={{ fontSize: 11, color: C.label, flex: 1, lineHeight: 16 }}>Fill your details to get a personalized daily macro plan</Text>
            </View>

            {/* Input Fields */}
            <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 18, marginBottom: 20 }}>
              
              {/* Daily Calories */}
              <View style={{ marginBottom: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: 'rgba(96,165,250,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                    <Ionicons name="flame" size={12} color="#60A5FA" />
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: C.white }}>Daily Calorie Target</Text>
                </View>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(31,164,99,0.1)', paddingHorizontal: 14, height: 48, justifyContent: 'center' }}>
                  <TextInput style={{ color: C.white, fontSize: 16, fontWeight: '600' }} placeholder="e.g., 2000" placeholderTextColor={C.muted} keyboardType="numeric" value={calories} onChangeText={setCalories} />
                </View>
              </View>

              {/* Weight */}
              <View style={{ marginBottom: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: 'rgba(255,127,0,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                    <Ionicons name="barbell" size={12} color="#FFA500" />
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: C.white }}>Weight (kg)</Text>
                </View>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(31,164,99,0.1)', paddingHorizontal: 14, height: 48, justifyContent: 'center' }}>
                  <TextInput style={{ color: C.white, fontSize: 16, fontWeight: '600' }} placeholder="e.g., 70" placeholderTextColor={C.muted} keyboardType="numeric" value={weight} onChangeText={setWeight} />
                </View>
              </View>

              {/* Height */}
              <View style={{ marginBottom: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: 'rgba(166,247,194,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                    <Ionicons name="resize-outline" size={12} color="#A6F7C2" />
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: C.white }}>Height (cm)</Text>
                </View>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(31,164,99,0.1)', paddingHorizontal: 14, height: 48, justifyContent: 'center' }}>
                  <TextInput style={{ color: C.white, fontSize: 16, fontWeight: '600' }} placeholder="e.g., 175" placeholderTextColor={C.muted} keyboardType="numeric" value={height} onChangeText={setHeight} />
                </View>
              </View>

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
            <TouchableOpacity onPress={handleGenerate} disabled={loading} activeOpacity={0.8} style={{ borderRadius: 14, overflow: 'hidden' }}>
              <LinearGradient colors={['#1FA463', '#A6F7C2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 52, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: C.white, fontSize: 16, fontWeight: '700' }}>{loading ? 'Generating...' : 'Generate Plan'}</Text>
              </LinearGradient>
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
