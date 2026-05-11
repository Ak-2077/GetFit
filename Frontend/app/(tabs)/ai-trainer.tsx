import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Image,
  TextInput, Animated, Dimensions, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserProfile, setAuthToken } from '../../services/api';
import GFLoader from '../../components/GFLoader';

const { width: SW } = Dimensions.get('window');

const C = {
  bg: '#000000',
  card: '#121212',
  cardLight: '#181818',
  border: 'rgba(255,255,255,0.06)',
  accent: '#1FA463',
  accentDim: 'rgba(31,164,99,0.15)',
  accentGlow: 'rgba(255,255,255,0.02)',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.50)',
  muted: 'rgba(255,255,255,0.30)',
};

const QUICK_ACTIONS = [
  { key: 'generate', title: 'Generate\nWorkout', sub: 'AI built workouts', icon: 'barbell-outline' as const, color: '#1FA463' },
  { key: 'diet', title: 'Build\nDiet Plan', sub: 'Personalized diet', icon: 'restaurant-outline' as const, color: '#1FA463' },
  { key: 'bmi', title: 'Analyze\nBMI', sub: 'Know your body', icon: 'body-outline' as const, color: '#6366F1' },
  { key: 'calories', title: 'Smart\nCalories', sub: 'Calorie insights', icon: 'flame-outline' as const, color: '#F97316' },
];

const AI_INSIGHTS = [
  { label: 'Recovery Score', value: '82%', sub: 'Ready to train', progress: 0.82, color: '#1FA463' },
  { label: 'Calories Suggestion', value: '2100 kcal', sub: 'Daily target', progress: 0.7, color: '#1FA463' },
  { label: 'Protein Target', value: '120 g', sub: "Today's target", progress: 0.6, color: '#22D3EE' },
  { label: 'Hydration', value: '2.4 L', sub: 'Keep going', progress: 0.75, color: '#6366F1' },
];

const PREMIUM_FEATURES = [
  { title: 'Voice Coach', sub: 'Get voice guidance', icon: 'mic-outline' as const },
  { title: 'Form Detection', sub: 'Real-time form correction', icon: 'videocam-outline' as const },
  { title: 'Meal Scanner', sub: 'Scan food & get nutrition info', icon: 'scan-outline' as const },
];

const CHAT_MESSAGES = [
  { role: 'user', text: 'Build a chest workout for mass.', time: '12:35 PM' },
  { role: 'ai', text: "Here's your 45 min chest workout:", detail: '4 exercises • 12 sets • 45 min', time: '12:35 PM' },
];

export default function AITrainerScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userPlan, setUserPlan] = useState('free');
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
      ]),
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2000, useNativeDriver: false }),
      ]),
    ).start();
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) { router.replace('/auth' as any); return; }
      setAuthToken(token);
      const res = await getUserProfile();
      setUserPlan(res.data?.subscriptionPlan || 'free');
    } catch (e) {
      console.warn('AITrainer load error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => { load(); }, [])
  );

  if (loading) return <GFLoader message="Loading AI Trainer..." />;

  const isUnlocked = userPlan === 'pro_plus';

  // ═══════════════════════════════════════
  // LOCKED VIEW — upgrade prompt
  // ═══════════════════════════════════════
  if (!isUnlocked) {
    return (
      <View style={s.root}>
        <View style={{ position: 'absolute', top: -80, right: -80, width: 280, height: 280, borderRadius: 140, backgroundColor: C.accentGlow }} />
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, alignItems: 'center' }} showsVerticalScrollIndicator={false}>
            {/* Robot image */}
            <Image
              source={require('../../assets/icons/ai-robot.png')}
              style={{ width: 200, height: 200, marginTop: 30 }}
              resizeMode="contain"
            />

            {/* Title */}
            <Text style={{ fontSize: 36, fontWeight: '900', color: C.white, marginTop: 20, textAlign: 'center' }}>
              <Text style={{ color: C.accent }}>AI </Text>Trainer
            </Text>
            <Text style={{ fontSize: 15, color: C.label, marginTop: 8, textAlign: 'center', lineHeight: 22 }}>
              Your personal AI-powered fitness coach
            </Text>

            {/* Pro Plus badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,127,0,0.12)' }}>
              <Ionicons name="shield-checkmark" size={16} color="#FF7F00" />
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#FF7F00', marginLeft: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
                Pro Plus Exclusive
              </Text>
            </View>

            {/* Feature list */}
            <View style={{ marginTop: 32, width: '100%', backgroundColor: C.card, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: C.border }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: C.white, marginBottom: 16 }}>Unlock AI Features</Text>
              {[
                'AI-generated personalized workouts',
                'Smart calorie & nutrition insights',
                'Real-time form detection',
                'Voice coaching during workouts',
                'Chat with your AI fitness coach',
                'Recovery & performance analytics',
              ].map((f, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <Ionicons name="checkmark-circle" size={20} color={C.accent} />
                  <Text style={{ fontSize: 14, color: C.label, marginLeft: 12, flex: 1 }}>{f}</Text>
                </View>
              ))}
            </View>

            {/* Upgrade button */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push('/upgrade' as any)}
              style={{ marginTop: 28, width: '100%' }}
            >
              <LinearGradient
                colors={['#FF7F00', '#FF9F40']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ paddingVertical: 16, borderRadius: 16, alignItems: 'center', shadowColor: '#FF7F00', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 }}
              >
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.5 }}>
                  Upgrade to Pro Plus
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <Text style={{ fontSize: 12, color: C.muted, marginTop: 12, textAlign: 'center' }}>
              Get unlimited access to all AI-powered features
            </Text>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ═══════════════════════════════════════
  // UNLOCKED VIEW — full AI Trainer UI
  // ═══════════════════════════════════════
  const handleQuickAction = (key: string) => {
    switch (key) {
      case 'generate': router.push('/workout-bodyparts?workoutType=ai&userPlan=pro_plus' as any); break;
      case 'diet': router.push('/ai-diet' as any); break;
      case 'bmi': router.push('/bmi-calculator' as any); break;
      case 'calories': router.push('/(tabs)/calories' as any); break;
    }
  };

  const glowBorder = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(31,164,99,0.15)', 'rgba(31,164,99,0.45)'],
  });

  return (
    <View style={s.root}>
      {/* Ambient glows */}
      <View style={{ position: 'absolute', top: -100, right: -100, width: 300, height: 300, borderRadius: 150, backgroundColor: C.accentGlow }} />
      <View style={{ position: 'absolute', bottom: -60, left: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(99,102,241,0.03)' }} />

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >

          {/* ═══ HEADER ═══ */}
          <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 34, fontWeight: '900', color: C.white }}>
                  <Text style={{ color: C.accent }}>AI </Text>Trainer
                </Text>
                <Text style={{ fontSize: 14, color: C.label, marginTop: 4, lineHeight: 20 }}>
                  Your personal AI-powered{'\n'}fitness coach
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <TouchableOpacity style={{ marginRight: 16 }}>
                  <Ionicons name="search-outline" size={24} color={C.label} />
                </TouchableOpacity>
                <TouchableOpacity>
                  <Ionicons name="notifications-outline" size={24} color={C.label} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Robot image */}
            <View style={{ position: 'absolute', right: 10, top: -10, opacity: 0.85 }}>
              <Image
                source={require('../../assets/icons/ai-robot.png')}
                style={{ width: 140, height: 140 }}
                resizeMode="contain"
              />
            </View>
          </View>

          {/* ═══ AI COACH CARD ═══ */}
          <Animated.View style={[s.coachCard, { borderColor: glowBorder }]}>
            {/* Active badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ backgroundColor: 'rgba(31,164,99,0.15)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, flexDirection: 'row', alignItems: 'center' }}>
                <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, marginRight: 8, opacity: pulseAnim }} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: C.accent }}>AI Coach Active</Text>
              </View>
            </View>

            <Text style={{ fontSize: 20, fontWeight: '800', color: C.white, lineHeight: 26, marginBottom: 6 }}>
              I'm here to help you{'\n'}achieve your goals.
            </Text>
            <Text style={{ fontSize: 13, color: C.label, lineHeight: 19, marginBottom: 16 }}>
              Get personalized plans, real-time insights and smart recommendations.
            </Text>

            {/* Search input */}
            <View style={s.searchBar}>
              <Ionicons name="sparkles" size={20} color={C.muted} style={{ marginRight: 10 }} />
              <TextInput
                placeholder="Ask your AI coach..."
                placeholderTextColor={C.muted}
                style={{ flex: 1, fontSize: 14, color: C.white }}
              />
              <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="mic" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* ═══ TODAY'S AI PLAN ═══ */}
          <SectionHeader title="TODAY'S AI PLAN" action="View all" />
          <View style={{ marginHorizontal: 20, backgroundColor: C.card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: C.border }}>
            <View style={{ flexDirection: 'row' }}>
              {/* Workout image */}
              <View style={{ width: 100, height: 120, borderRadius: 16, overflow: 'hidden', marginRight: 14 }}>
                <Image
                  source={require('../../assets/icons/Homeworkout/Chest.png')}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              </View>

              <View style={{ flex: 1 }}>
                {/* Recommended badge */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <Ionicons name="sparkles" size={12} color={C.accent} />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: C.accent, marginLeft: 4 }}>Recommended for you</Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: C.white }}>Chest + Triceps</Text>
                  {/* Progress circle */}
                  <View style={{ width: 42, height: 42, borderRadius: 21, borderWidth: 3, borderColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: C.muted }}>0%</Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                  <Ionicons name="time-outline" size={14} color={C.label} />
                  <Text style={{ fontSize: 12, color: C.label, marginLeft: 4, marginRight: 12 }}>45 min</Text>
                  <Ionicons name="bar-chart-outline" size={14} color={C.label} />
                  <Text style={{ fontSize: 12, color: C.label, marginLeft: 4 }}>Intermediate</Text>
                </View>

                <Text style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 16 }}>
                  AI generated workout based on your performance and goals.
                </Text>
              </View>
            </View>

            {/* Start workout button */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push('/workout-bodyparts?workoutType=ai&userPlan=pro_plus' as any)}
              style={{ alignSelf: 'flex-end', marginTop: 10 }}
            >
              <LinearGradient
                colors={['#00C96B', '#00A85A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 }}
              >
                <Text style={{ fontSize: 13, fontWeight: '800', color: '#fff' }}>Start Workout</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* ═══ QUICK ACTIONS ═══ */}
          <SectionHeader title="QUICK ACTIONS" />
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, justifyContent: 'space-between' }}>
            {QUICK_ACTIONS.map((a) => (
              <TouchableOpacity
                key={a.key}
                activeOpacity={0.8}
                onPress={() => handleQuickAction(a.key)}
                style={{ width: (SW - 52) / 4, backgroundColor: C.card, borderRadius: 16, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: C.border }}
              >
                <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}>
                  <Ionicons name={a.icon} size={22} color={a.color} />
                </View>
                <Text style={{ fontSize: 12, fontWeight: '800', color: C.white, textAlign: 'center', lineHeight: 16 }}>{a.title}</Text>
                <Text style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 4 }}>{a.sub}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ═══ AI INSIGHTS ═══ */}
          <SectionHeader title="AI INSIGHTS" action="View more" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20 }}
          >
            {AI_INSIGHTS.map((item, i) => (
              <View key={i} style={{ width: 150, backgroundColor: C.card, borderRadius: 16, padding: 14, marginRight: 12, borderWidth: 1, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color, marginRight: 6 }} />
                  <Text style={{ fontSize: 11, color: C.label, flex: 1 }} numberOfLines={1}>{item.label}</Text>
                </View>
                <Text style={{ fontSize: 20, fontWeight: '900', color: C.white, marginBottom: 2 }}>{item.value}</Text>
                <Text style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>{item.sub}</Text>
                {/* Progress bar */}
                <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(126, 8, 223, 0.06)' }}>
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: item.color, width: `${item.progress * 100}%` }} />
                </View>
              </View>
            ))}
          </ScrollView>

          {/* ═══ CHAT WITH AI COACH  will be added ═══ */}


          {/* ═══ PREMIUM AI FEATURES ═══ */}
          <SectionHeader title="PREMIUM AI FEATURES" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20 }}
          >
            {PREMIUM_FEATURES.map((f, i) => (
              <View key={i} style={{ width: 140, backgroundColor: C.card, borderRadius: 16, padding: 16, marginRight: 12, borderWidth: 1, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.accentDim, justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name={f.icon} size={20} color={C.accent} />
                  </View>
                  <Ionicons name="lock-closed" size={14} color={C.muted} />
                </View>
                <Text style={{ fontSize: 13, fontWeight: '800', color: C.white, marginBottom: 4 }}>{f.title}</Text>
                <Text style={{ fontSize: 11, color: C.muted, lineHeight: 16, marginBottom: 10 }}>{f.sub}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="shield-checkmark" size={12} color={C.accent} />
                  <Text style={{ fontSize: 11, fontWeight: '700', color: C.accent, marginLeft: 4 }}>PRO</Text>
                </View>
              </View>
            ))}
          </ScrollView>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Section Header component ──
function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginTop: 28, marginBottom: 14 }}>
      <Text style={{ fontSize: 13, fontWeight: '800', color: C.label, letterSpacing: 0.8 }}>{title}</Text>
      {action && (
        <TouchableOpacity>
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.accent }}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Styles ──
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  coachCard: {
    marginHorizontal: 20,
    marginTop: 50,
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '1A1A1A',
    borderRadius: 14,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
});
