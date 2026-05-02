import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, KeyboardAvoidingView, Platform, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Dimensions } from 'react-native';
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { calculateBMI } from '../services/api';

const C = { bg: '#060D09', card: 'rgba(25,25,25,1)', cardBorder: 'rgba(29,36,31,0.18)', accent: '#1FA463', white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)' };

const BMI_MIN = 16;
const BMI_MAX = 40;
const BMI_THRESHOLDS = {
  underweight: 18.5,
  normal: 25,
  overweight: 30,
};

const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
  const angleRad = (angleDeg * Math.PI) / 180.0;
  return {
    x: cx + r * Math.sin(angleRad),
    y: cy - r * Math.cos(angleRad),
  };
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
  return { label: 'Obesity', color: '#D50000' };
};

function BMIMeter({ bmi }: { bmi: number }) {
  const needleAnim = useRef(new Animated.Value(-90)).current;
  const { width } = Dimensions.get('window');
  const gaugeWidth = Math.min(360, Math.max(260, width - 64));
  const strokeWidth = 18;
  const padding = 20;
  const radius = (gaugeWidth - padding * 2 - strokeWidth) / 2;
  const cx = gaugeWidth / 2;
  const cy = padding + radius;
  const gaugeHeight = Math.round(cy + 72);
  const arcGapDeg = 1.6;
  const labelRadius = radius + 20;
  const needleLength = Math.round(radius - strokeWidth / 2);
  const needleWidth = 10;

  const bmiToAngle = (bmiValue: number) => {
    const clamped = Math.min(Math.max(bmiValue, BMI_MIN), BMI_MAX);
    const normalized = (clamped - BMI_MIN) / (BMI_MAX - BMI_MIN);
    return -90 + normalized * 180;
  };

  const segments = [
    { start: BMI_MIN, end: BMI_THRESHOLDS.underweight, stroke: 'url(#underweight-grad)' },
    { start: BMI_THRESHOLDS.underweight, end: BMI_THRESHOLDS.normal, stroke: '#00E676' },
    { start: BMI_THRESHOLDS.normal, end: BMI_THRESHOLDS.overweight, stroke: '#FFD600' },
    { start: BMI_THRESHOLDS.overweight, end: BMI_MAX, stroke: '#D50000' },
  ];

  useEffect(() => {
    const angle = bmiToAngle(bmi) - 2;
    needleAnim.setValue(-90);
    Animated.timing(needleAnim, {
      toValue: angle,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [bmi, needleAnim]);

  const needleRotation = needleAnim.interpolate({
    inputRange: [-90, 90],
    outputRange: ['-90deg', '90deg'],
  });

  const labels = [16, 18.5, 25, 30, 40];
  const labelPositions = labels.map(value => {
    const angle = bmiToAngle(value);
    const pos = polarToCartesian(cx, cy, labelRadius, angle);
    const yAdjust = value <= 18.5 ? 4 : value === 30 ? -2 : 0;
    return { value, x: pos.x, y: pos.y + yAdjust };
  });

  const status = getBMIStatus(bmi);

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: gaugeWidth, height: gaugeHeight }}>
        <Svg width={gaugeWidth} height={gaugeHeight}>
          <Defs>
            <SvgGradient id="underweight-grad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor="#FF5252" />
              <Stop offset="100%" stopColor="#FF8A65" />
            </SvgGradient>
          </Defs>
          {segments.map((segment, index) => {
            const startAngle = bmiToAngle(segment.start) + arcGapDeg / 2;
            const endAngle = bmiToAngle(segment.end) - arcGapDeg / 2;
            const arc = describeArc(cx, cy, radius, startAngle, endAngle);
            return (
              <Path
                key={`seg-${index}`}
                d={arc}
                stroke={segment.stroke}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="none"
              />
            );
          })}
          {labelPositions.map(label => (
            <SvgText
              key={`lbl-${label.value}`}
              x={label.x}
              y={label.y}
              fill="rgba(255,255,255,0.6)"
              fontSize="10"
              fontWeight="600"
              textAnchor="middle"
            >
              {label.value}
            </SvgText>
          ))}
        </Svg>
        <View style={{ position: 'absolute', left: cx - radius, top: cy - radius, width: radius * 2, height: radius * 2, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View
            style={{
              position: 'absolute',
              bottom: radius,
              alignSelf: 'center',
              width: needleWidth,
              height: needleLength,
              alignItems: 'center',
              transform: [
                { translateX: -10 },
                { translateY: needleLength },
                { rotate: needleRotation },
                { translateY: -needleLength },
              ],
            }}
          >
            <View style={{ width: 2, height: needleLength - 10, backgroundColor: '#FFFFFF', borderRadius: 1 }} />
            <View style={{ position: 'absolute', top: -6, left: needleWidth / 2 - 4, width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#FFFFFF' }} />
          </Animated.View>
        </View>
        <View style={{ position: 'absolute', left: cx - 5, top: cy - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#00E676', opacity: 0.6 }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: cy + 34, alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#FFFFFF' }}>BMI = {bmi.toFixed(1)}</Text>
        </View>
      </View>
      <Text style={{ color: status.color, fontSize: 16, fontWeight: '700', marginTop: 8 }}>{status.label}</Text>
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
    if (!weight || !height) { Alert.alert('Error', 'Please enter weight and height'); return; }
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
              <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 20 }}>
                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ color: C.white, fontSize: 16, fontWeight: '800' }}>Result</Text>
                  <Text style={{ color: C.muted, fontSize: 12 }}>BMI = {Number(result.bmi).toFixed(1)} kg/m2</Text>
                </View>
                {/* BMI Meter */}
                <View style={{ alignItems: 'center', marginBottom: 18 }}>
                  <BMIMeter bmi={bmiValue} />
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
