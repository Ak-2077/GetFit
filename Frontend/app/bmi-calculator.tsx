import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, Animated, Easing, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop, Circle, Line, Text as SvgText } from 'react-native-svg';
import { calculateBMI } from '../services/api';

const C = { bg: '#060D09', card: 'rgba(25,25,25,1)', cardBorder: 'rgba(255,255,255,0.07)', accent: '#1FA463', white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)' };

const BMI_MIN = 16;
const BMI_MAX = 40;
const BMI_THRESHOLDS = { underweight: 18.5, normal: 25, overweight: 30 };

const AnimatedLine = Animated.createAnimatedComponent(Line);

const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
  const angleRad = (angleDeg * Math.PI) / 180.0;
  return { x: cx + r * Math.sin(angleRad), y: cy - r * Math.cos(angleRad) };
};

const describeArc = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
};

const getBMIStatus = (bmiValue: number) => {
  if (bmiValue < BMI_THRESHOLDS.underweight) return { label: 'Underweight', color: '#FF8A65' };
  if (bmiValue < BMI_THRESHOLDS.normal) return { label: 'Normal', color: '#00E676' };
  if (bmiValue < BMI_THRESHOLDS.overweight) return { label: 'Overweight', color: '#FFD600' };
  return { label: 'Obesity', color: '#FF4D4D' };
};

function BMIMeter({ bmi }: { bmi: number }) {
  const { width } = Dimensions.get('window');
  const gaugeWidth = Math.min(340, Math.max(260, width - 72));
  const strokeWidth = 16;
  const padding = 26;
  const radius = (gaugeWidth - padding * 2 - strokeWidth) / 2;
  const cx = gaugeWidth / 2;
  const cy = padding + radius;
  const gaugeHeight = Math.round(cy + 64);
  const arcGapDeg = 1.4;
  const labelRadius = radius + 18;
  const needleLength = radius - strokeWidth / 2 - 4;

  const bmiToAngle = (bmiValue: number) => {
    const clamped = Math.min(Math.max(bmiValue, BMI_MIN), BMI_MAX);
    const normalized = (clamped - BMI_MIN) / (BMI_MAX - BMI_MIN);
    return -90 + normalized * 180;
  };

  const segments = [
    { start: BMI_MIN, end: BMI_THRESHOLDS.underweight, stroke: 'url(#underweight-grad)' },
    { start: BMI_THRESHOLDS.underweight, end: BMI_THRESHOLDS.normal, stroke: '#00E676' },
    { start: BMI_THRESHOLDS.normal, end: BMI_THRESHOLDS.overweight, stroke: '#FFD600' },
    { start: BMI_THRESHOLDS.overweight, end: BMI_MAX, stroke: '#FF4D4D' },
  ];

  // Animate the needle along the arc by interpolating the angle and computing the tip.
  const targetAngle = bmiToAngle(bmi);
  const sweep = useRef(new Animated.Value(-90)).current;
  const tipX = useRef(new Animated.Value(polarToCartesian(cx, cy, needleLength, -90).x)).current;
  const tipY = useRef(new Animated.Value(polarToCartesian(cx, cy, needleLength, -90).y)).current;

  useEffect(() => {
    const id = sweep.addListener(({ value }) => {
      const p = polarToCartesian(cx, cy, needleLength, value);
      tipX.setValue(p.x);
      tipY.setValue(p.y);
    });
    sweep.setValue(-90);
    Animated.timing(sweep, {
      toValue: targetAngle,
      duration: 850,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    return () => sweep.removeListener(id);
  }, [bmi]);

  const labels = [16, 18.5, 25, 30, 40];
  const status = getBMIStatus(bmi);

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={gaugeWidth} height={gaugeHeight}>
        <Defs>
          <SvgGradient id="underweight-grad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor="#FF5252" />
            <Stop offset="100%" stopColor="#FF8A65" />
          </SvgGradient>
        </Defs>

        {/* Colored segments */}
        {segments.map((segment, index) => {
          const startAngle = bmiToAngle(segment.start) + arcGapDeg / 2;
          const endAngle = bmiToAngle(segment.end) - arcGapDeg / 2;
          return (
            <Path key={`seg-${index}`} d={describeArc(cx, cy, radius, startAngle, endAngle)} stroke={segment.stroke} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
          );
        })}

        {/* Tick labels */}
        {labels.map((value) => {
          const pos = polarToCartesian(cx, cy, labelRadius, bmiToAngle(value));
          return (
            <SvgText key={`lbl-${value}`} x={pos.x} y={pos.y + 3} fill="rgba(255,255,255,0.55)" fontSize="10" fontWeight="600" textAnchor="middle">{value}</SvgText>
          );
        })}

        {/* Needle (drawn from hub to tip — exact polar positioning) */}
        <AnimatedLine x1={cx} y1={cy} x2={tipX as any} y2={tipY as any} stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" />
        {/* Hub */}
        <Circle cx={cx} cy={cy} r={8} fill="#FFFFFF" />
        <Circle cx={cx} cy={cy} r={4} fill={status.color} />
      </Svg>

      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <Text style={{ fontSize: 30, fontWeight: '800', color: '#FFFFFF' }}>{bmi.toFixed(1)}</Text>
        <Text style={{ color: status.color, fontSize: 15, fontWeight: '700', marginTop: 2 }}>{status.label}</Text>
      </View>
    </View>
  );
}

export default function BMICalculatorScreen() {
  const router = useRouter();
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [gender, setGender] = useState('male');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);

  const handleCalculate = async () => {
    if (!weight || !height) { Alert.alert('Missing info', 'Please enter weight and height'); return; }
    try {
      setLoading(true);
      const res = await calculateBMI({ age: Number(age) || 25, weight: Number(weight), height: Number(height), gender });
      setResult(res.data);
      setShowResult(true);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Calculation failed');
    } finally { setLoading(false); }
  };

  const bmiValue = Number(result?.bmi || 0);
  const goal = result?.weightGoal;

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

            {!showResult && (
              <>
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
              </>
            )}

            {showResult && result && (
              <>
                {/* Hero gauge card */}
                <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, paddingVertical: 22, paddingHorizontal: 16, alignItems: 'center', marginBottom: 14 }}>
                  <BMIMeter bmi={bmiValue} />
                </View>

                {/* Guidance banner */}
                {result.advice && (
                  <View style={{ backgroundColor: 'rgba(31,164,99,0.08)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(31,164,99,0.2)', padding: 14, marginBottom: 14, flexDirection: 'row', gap: 12 }}>
                    <Ionicons name="bulb-outline" size={18} color={C.accent} style={{ marginTop: 1 }} />
                    <Text style={{ color: C.white, fontSize: 12.5, lineHeight: 18, flex: 1 }}>{result.advice}</Text>
                  </View>
                )}

                {/* Stat grid */}
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                  <View style={{ flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 14, padding: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>BMR</Text>
                    <Text style={{ color: C.white, fontSize: 18, fontWeight: '800' }}>{result.bmr}</Text>
                    <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>kcal/day</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 14, padding: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>Body Fat</Text>
                    <Text style={{ color: C.white, fontSize: 18, fontWeight: '800' }}>{result.bodyFat != null ? `${result.bodyFat}%` : '—'}</Text>
                    <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>estimate</Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 14, padding: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>Healthy Weight</Text>
                    <Text style={{ color: C.white, fontSize: 16, fontWeight: '800' }}>{result.idealWeightRange?.min}–{result.idealWeightRange?.max}</Text>
                    <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>kg</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, borderRadius: 14, padding: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.muted, fontSize: 10, marginBottom: 4 }}>{goal?.direction === 'gain' ? 'To Gain' : goal?.direction === 'lose' ? 'To Lose' : 'Goal'}</Text>
                    <Text style={{ color: goal?.direction === 'maintain' ? C.accent : C.white, fontSize: 16, fontWeight: '800' }}>{goal?.direction === 'maintain' ? 'On track' : `${goal?.deltaKg} kg`}</Text>
                    <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>{goal?.direction === 'maintain' ? 'healthy' : 'to reach range'}</Text>
                  </View>
                </View>

                <TouchableOpacity onPress={() => setShowResult(false)} activeOpacity={0.8} style={{ marginTop: 16, borderRadius: 14, overflow: 'hidden' }}>
                  <View style={{ height: 48, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>Edit Inputs</Text>
                  </View>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
