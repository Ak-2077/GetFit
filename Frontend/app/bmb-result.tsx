import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';

const C = { bg: '#060D09', card: '#0F1A13', cardBorder: 'rgba(31,164,99,0.12)', accent: '#1FA463', white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)' };

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

export default function BMBResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  
  const result = useMemo(() => {
    try {
      return JSON.parse(params.data as string);
    } catch {
      return { protein: 0, carbs: 0, fats: 0, fiber: 0, goal: 'maintain' };
    }
  }, [params.data]);

  const totalMacros = result.protein * 4 + result.carbs * 4 + result.fats * 9;
  const proteinPct = Math.round((result.protein * 4 / totalMacros) * 100);
  const carbsPct = Math.round((result.carbs * 4 / totalMacros) * 100);
  const fatsPct = Math.round((result.fats * 9 / totalMacros) * 100);

  const goalColor = getGoalColor(result.goal);
  const goalLabel = getGoalLabel(result.goal);
  const tips = getTips(result.goal);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Background glow */}
      <View style={{ position: 'absolute', top: -80, right: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(31,164,99,0.06)' }} />
      
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
          
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 20 }}>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center', marginRight: 14, borderWidth: 1, borderColor: C.cardBorder }}>
              <Ionicons name="chevron-back" size={20} color={C.white} />
            </TouchableOpacity>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white, letterSpacing: -0.3 }}>Your Daily Plan</Text>
              <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>Personalized nutrition guide</Text>
            </View>
          </View>

          {/* Circular Meter */}
          <View style={{ backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, padding: 20, alignItems: 'center', marginBottom: 24 }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <Svg width={200} height={200} viewBox="0 0 200 200">
                {/* Background circle */}
                <Circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                
                {/* Protein segment */}
                <Circle cx="100" cy="100" r="90" fill="none" stroke="#1FA463" strokeWidth="8" strokeDasharray={`${(proteinPct / 100) * 565} 565`} strokeLinecap="round" rotation="-90" origin="100,100" />
                
                {/* Carbs segment */}
                <Circle cx="100" cy="100" r="90" fill="none" stroke="#60A5FA" strokeWidth="8" strokeDasharray={`${(carbsPct / 100) * 565} 565`} strokeLinecap="round" rotation={`${(proteinPct / 100) * 360 - 90}`} origin="100,100" />
                
                {/* Fats segment */}
                <Circle cx="100" cy="100" r="90" fill="none" stroke="#FFA500" strokeWidth="8" strokeDasharray={`${(fatsPct / 100) * 565} 565`} strokeLinecap="round" rotation={`${((proteinPct + carbsPct) / 100) * 360 - 90}`} origin="100,100" />
                
                {/* Center circle */}
                <Circle cx="100" cy="100" r="60" fill={C.bg} />
                
                {/* Center text */}
                <SvgText x="100" y="95" fontSize="24" fontWeight="700" fill={goalColor} textAnchor="middle">100%</SvgText>
                <SvgText x="100" y="115" fontSize="12" fill={C.label} textAnchor="middle">Balanced</SvgText>
              </Svg>
            </View>

            {/* Legend */}
            <View style={{ width: '100%', gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                <View style={{ alignItems: 'center' }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#1FA463', marginBottom: 4 }} />
                  <Text style={{ fontSize: 10, color: C.muted }}>Protein</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: C.white }}>{proteinPct}%</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#60A5FA', marginBottom: 4 }} />
                  <Text style={{ fontSize: 10, color: C.muted }}>Carbs</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: C.white }}>{carbsPct}%</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFA500', marginBottom: 4 }} />
                  <Text style={{ fontSize: 10, color: C.muted }}>Fats</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: C.white }}>{fatsPct}%</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Goal Tag */}
          <View style={{ backgroundColor: `${goalColor}15`, borderRadius: 14, borderWidth: 1, borderColor: `${goalColor}30`, padding: 12, marginBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: `${goalColor}25`, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name={result.goal === 'lose' ? 'trending-down' : result.goal === 'gain' ? 'trending-up' : 'remove'} size={16} color={goalColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>Goal</Text>
              <Text style={{ fontSize: 14, fontWeight: '700', color: C.white }}>{goalLabel}</Text>
            </View>
          </View>

          {/* Macro Cards Grid */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 14 }}>Daily Macros</Text>
          <View style={{ gap: 12, marginBottom: 24 }}>
            {[
              { label: 'Protein', value: result.protein, unit: 'g', icon: 'nutrition-outline', color: '#1FA463', info: 'Muscle & recovery' },
              { label: 'Carbs', value: result.carbs, unit: 'g', icon: 'flame-outline', color: '#60A5FA', info: 'Energy source' },
              { label: 'Fats', value: result.fats, unit: 'g', icon: 'droplet-outline', color: '#FFA500', info: 'Hormones & absorption' },
              { label: 'Fiber', value: result.fiber, unit: 'g', icon: 'leaf-outline', color: '#A6F7C2', info: 'Digestive health' },
            ].map((m) => (
              <View key={m.label} style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
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

          {/* Tips Section */}
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 14 }}>Tips & Recommendations</Text>
          <View style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, padding: 16, marginBottom: 20 }}>
            {tips.map((tip, i) => (
              <View key={i} style={{ flexDirection: 'row', marginBottom: i === tips.length - 1 ? 0 : 12, alignItems: 'flex-start' }}>
                <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: 'rgba(31,164,99,0.15)', justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 2, flexShrink: 0 }}>
                  <Ionicons name="checkmark" size={12} color={C.accent} />
                </View>
                <Text style={{ color: C.white, fontSize: 12, flex: 1, lineHeight: 18 }}>{tip}</Text>
              </View>
            ))}
          </View>

          {/* Buttons */}
          <View style={{ gap: 12 }}>
            <TouchableOpacity onPress={() => router.push('/bmb-setup' as any)} activeOpacity={0.8} style={{ borderRadius: 14, overflow: 'hidden' }}>
              <LinearGradient colors={['#1FA463', '#A6F7C2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 48, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>Recalculate</Text>
              </LinearGradient>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={() => router.push('/(tabs)' as any)} activeOpacity={0.8} style={{ borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, height: 48, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>Back to Home</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
