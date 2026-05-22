import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  Animated, RefreshControl, StyleSheet, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserProfile, setAuthToken } from '../../services/api';
import { AITrainerSkeleton } from '../../components/SkeletonScreens';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Design tokens ──
const C = {
  bg: '#060D09',
  card: 'rgba(25,25,25,1)',
  cardBorder: 'rgba(255,255,255,0.08)',
  accent: '#1FA463',
  accentBg: 'rgba(31,164,99,0.14)',
  accentGlow: 'rgba(31,164,99,0.06)',
  cyan: '#64e7f1',
  purple: '#6A0DAD',
  orange: '#FF7F00',
  pink: '#EC407A',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.50)',
  muted: 'rgba(255,255,255,0.30)',
};

// ── Interaction Modes (2x2 grid) ──
const MODES = [
  { key: 'chat', icon: 'sparkles' as const, label: 'Kyro', sub: 'Ask anything', color: C.accent, bg: 'rgba(31,164,99,0.12)', ready: true },
  { key: 'video', icon: 'videocam' as const, label: 'Video Feedback', sub: 'Form check', color: C.cyan, bg: 'rgba(100,231,241,0.10)', ready: false },
  { key: 'diet', icon: 'chatbubbles' as const, label: 'Chat Diet Plan', sub: 'Kyro meal planner', color: '#FFB74D', bg: 'rgba(255,183,77,0.10)', ready: true },
  { key: 'program', icon: 'calendar' as const, label: 'Smart Program', sub: 'Adaptive plans', color: '#42A5F5', bg: 'rgba(66,165,245,0.10)', ready: false },
];

// ── Upcoming Features (horizontal scroll) ──
const UPCOMING = [
  { key: 'video', title: 'Video Feedback', sub: 'Record any exercise and get frame-by-frame AI analysis with correction overlays', icon: 'videocam' as const, color: C.cyan, gradient: ['rgba(100,231,241,0.14)', 'rgba(100,231,241,0.03)'] as [string, string] },
  { key: 'program', title: 'Smart Program', sub: 'Multi-week periodized plans that adapt to your progress and recovery', icon: 'calendar' as const, color: '#42A5F5', gradient: ['rgba(66,165,245,0.14)', 'rgba(66,165,245,0.03)'] as [string, string] },
];

// ── Animated press wrapper ──
function PressableCard({ children, onPress, style }: any) {
  const scale = useRef(new Animated.Value(1)).current;
  const onIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const onOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  return (
    <TouchableOpacity activeOpacity={1} onPress={onPress} onPressIn={onIn} onPressOut={onOut} style={style}>
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

export default function AITrainerScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userPlan, setUserPlan] = useState('free');

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true); else setRefreshing(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) { router.replace('/auth' as any); return; }
      setAuthToken(token);
      const res = await getUserProfile();
      setUserPlan(res.data?.subscriptionPlan || 'free');
    } catch (e) {
      console.warn('AITrainer load error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, []));

  if (loading) return <AITrainerSkeleton />;

  const isUnlocked = userPlan === 'pro_plus';

  // ═══════════════════════════════════════
  // LOCKED VIEW
  // ═══════════════════════════════════════
  if (!isUnlocked) {
    return (
      <View style={s.root}>
        <View style={{ position: 'absolute', top: -100, right: -100, width: 300, height: 300, borderRadius: 150, backgroundColor: C.accentGlow }} />
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>

            <View style={{ paddingTop: 8, paddingBottom: 8 }}>
              <Text style={{ fontSize: 28, fontWeight: '800', color: C.white, letterSpacing: -0.5 }}>
                <Text style={{ color: C.accent }}>Ky</Text>ro
              </Text>
              <Text style={{ fontSize: 14, color: C.label, marginTop: 4 }}>Your personal AI trainer</Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 24 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: 'rgba(255,127,0,0.12)' }}>
                <Ionicons name="shield-checkmark" size={14} color={C.orange} />
                <Text style={{ fontSize: 11, fontWeight: '700', color: C.orange, marginLeft: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>Pro Plus Exclusive</Text>
              </View>
            </View>

            {/* Hero motivation */}
            <LinearGradient
              colors={['rgba(31,164,99,0.14)', 'rgba(31,164,99,0.02)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ borderRadius: 18, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(31,164,99,0.10)' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: C.accentBg, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                  <Ionicons name="sparkles" size={22} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: C.white }}>Kyro-powered coaching</Text>
                  <Text style={{ fontSize: 11, color: C.label, marginTop: 2, lineHeight: 16 }}>Kyro trainer, video feedback, diet plans & smart programs</Text>
                </View>
              </View>
            </LinearGradient>

            {/* Feature preview grid */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
              {MODES.map((m) => (
                <View key={m.key} style={{ flex: 1, backgroundColor: C.card, borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: C.cardBorder }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: m.bg, justifyContent: 'center', alignItems: 'center', marginBottom: 8 }}>
                    <Ionicons name={m.icon as any} size={18} color={m.color} />
                  </View>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: C.white }}>{m.label}</Text>
                  <Ionicons name="lock-closed" size={10} color={C.muted} style={{ marginTop: 4 }} />
                </View>
              ))}
            </View>

            {/* Feature list */}
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.muted, marginBottom: 12, letterSpacing: 0.8 }}>EVERYTHING INCLUDED</Text>
            <View style={{ backgroundColor: C.card, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: C.cardBorder }}>
              {[
                { icon: 'sparkles-outline', label: 'Unlimited Kyro conversations' },
                { icon: 'videocam-outline', label: 'Video feedback & form analysis' },
                { icon: 'chatbubbles-outline', label: 'Chat-based diet planning' },
                { icon: 'calendar-outline', label: 'Smart adaptive programs' },
              ].map((f, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: i < 3 ? 14 : 0 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: C.accentBg, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                    <Ionicons name={f.icon as any} size={16} color={C.accent} />
                  </View>
                  <Text style={{ fontSize: 13, color: C.label, flex: 1 }}>{f.label}</Text>
                  <Ionicons name="checkmark-circle" size={18} color={C.accent} />
                </View>
              ))}
            </View>

            {/* Upgrade CTA */}
            <TouchableOpacity activeOpacity={0.8} onPress={() => router.push('/upgrade' as any)} style={{ marginTop: 24 }}>
              <LinearGradient
                colors={['#FF7F00', '#FF9F40']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ paddingVertical: 16, borderRadius: 16, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: 0.5 }}>Upgrade to Pro Plus</Text>
              </LinearGradient>
            </TouchableOpacity>
            <Text style={{ fontSize: 11, color: C.muted, marginTop: 10, textAlign: 'center' }}>Unlock all AI features</Text>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ═══════════════════════════════════════
  // UNLOCKED VIEW
  // ═══════════════════════════════════════
  const handleMode = (key: string) => {
    switch (key) {
      case 'chat': router.push('/ai-chat' as any); break;
      case 'diet': router.push('/ai-diet' as any); break;
      case 'video': break; // Coming soon
      case 'program': break; // Coming soon
    }
  };

  return (
    <View style={s.root}>
      <View style={{ position: 'absolute', top: -100, right: -100, width: 300, height: 300, borderRadius: 150, backgroundColor: C.accentGlow }} />
      <View style={{ position: 'absolute', bottom: -80, left: -80, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(100,231,241,0.03)' }} />

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.card} />}
        >

          {/* ═══ HEADER ═══ */}
          <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
            <Text style={{ fontSize: 28, fontWeight: '800', color: C.white, letterSpacing: -0.5 }}>
              <Text style={{ color: C.accent }}>Ky</Text>ro
            </Text>
            <Text style={{ fontSize: 14, color: C.label, marginTop: 4 }}>Your personal AI trainer</Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: 'rgba(255,127,0,0.12)', marginRight: 8 }}>
                <Ionicons name="shield-checkmark" size={12} color={C.orange} />
                <Text style={{ fontSize: 10, fontWeight: '700', color: C.orange, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pro Plus</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, backgroundColor: C.accentBg }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent, marginRight: 5 }} />
                <Text style={{ fontSize: 10, fontWeight: '600', color: C.accent }}>Online</Text>
              </View>
            </View>
          </View>

          {/* ═══ KYRO HERO — Gradient Border ═══ */}
          <View style={{ paddingHorizontal: 20 }}>
            <PressableCard onPress={() => router.push('/ai-chat' as any)}>
              <LinearGradient
                colors={['rgba(31,164,99,0.5)', 'rgba(100,231,241,0.3)', 'rgba(106,13,173,0.3)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ borderRadius: 23, padding: 1.5 }}
              >
                <View style={{ backgroundColor: '#0D1510', borderRadius: 22, padding: 20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                    <View style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: C.accentBg, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                      <Ionicons name="sparkles" size={22} color={C.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 17, fontWeight: '800', color: C.white }}>Kyro</Text>
                      <Text style={{ fontSize: 11, color: C.label, marginTop: 2 }}>Your AI fitness coach • Nutrition • Form</Text>
                    </View>
                  </View>

                  <View style={s.searchBar}>
                    <Ionicons name="chatbubble-ellipses-outline" size={17} color={C.muted} style={{ marginRight: 10 }} />
                    <Text style={{ flex: 1, fontSize: 13, color: C.muted }}>Ask Kyro anything...</Text>
                    <LinearGradient
                      colors={[C.accent, '#00C96B']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{ width: 34, height: 34, borderRadius: 11, justifyContent: 'center', alignItems: 'center' }}
                    >
                      <Ionicons name="arrow-forward" size={16} color="#fff" />
                    </LinearGradient>
                  </View>
                </View>
              </LinearGradient>
            </PressableCard>
          </View>

          {/* ═══ HOW IT WORKS ═══ */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 4, paddingHorizontal: 20 }}>
            {[
              { icon: 'chatbubble-outline', label: 'You ask' },
              { icon: 'hardware-chip-outline', label: 'AI thinks' },
              { icon: 'checkmark-done-outline', label: 'Expert answer' },
            ].map((step, i) => (
              <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Ionicons name={step.icon as any} size={16} color={C.accent} />
                  <Text style={{ fontSize: 9, color: C.muted, marginTop: 4, fontWeight: '600' }}>{step.label}</Text>
                </View>
                {i < 2 && <Ionicons name="chevron-forward" size={10} color={C.muted} style={{ marginHorizontal: 2 }} />}
              </View>
            ))}
          </View>

          {/* ═══ INTERACTION MODES — 2×2 Grid ═══ */}
          <Text style={{ fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 0.8, marginTop: 24, marginBottom: 12, paddingHorizontal: 20 }}>INTERACTION MODES</Text>
          <View style={{ paddingHorizontal: 20 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {MODES.slice(0, 2).map((m) => (
                <PressableCard key={m.key} onPress={() => m.ready && handleMode(m.key)} style={{ flex: 1 }}>
                  <View style={{ backgroundColor: C.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.cardBorder, minHeight: 130, justifyContent: 'space-between', overflow: 'hidden' }}>
                    <View style={{ position: 'absolute', top: -20, right: -20, width: 56, height: 56, borderRadius: 28, backgroundColor: m.bg }} />
                    <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: m.bg, justifyContent: 'center', alignItems: 'center' }}>
                      <Ionicons name={m.icon as any} size={20} color={m.color} />
                    </View>
                    <View style={{ marginTop: 14 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: C.white }}>{m.label}</Text>
                      <Text style={{ fontSize: 10, color: C.label, marginTop: 2 }}>{m.sub}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: m.ready ? m.bg : 'rgba(255,255,255,0.04)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginTop: 10 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: m.ready ? m.color : C.muted, marginRight: 5 }} />
                      <Text style={{ fontSize: 9, fontWeight: '700', color: m.ready ? m.color : C.muted }}>{m.ready ? 'READY' : 'SOON'}</Text>
                    </View>
                  </View>
                </PressableCard>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              {MODES.slice(2, 4).map((m) => (
                <PressableCard key={m.key} onPress={() => m.ready && handleMode(m.key)} style={{ flex: 1 }}>
                  <View style={{ backgroundColor: C.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.cardBorder, minHeight: 130, justifyContent: 'space-between', overflow: 'hidden' }}>
                    <View style={{ position: 'absolute', top: -20, right: -20, width: 56, height: 56, borderRadius: 28, backgroundColor: m.bg }} />
                    <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: m.bg, justifyContent: 'center', alignItems: 'center' }}>
                      <Ionicons name={m.icon as any} size={20} color={m.color} />
                    </View>
                    <View style={{ marginTop: 14 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: C.white }}>{m.label}</Text>
                      <Text style={{ fontSize: 10, color: C.label, marginTop: 2 }}>{m.sub}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: m.ready ? m.bg : 'rgba(255,255,255,0.04)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginTop: 10 }}>
                      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: m.ready ? m.color : C.muted, marginRight: 5 }} />
                      <Text style={{ fontSize: 9, fontWeight: '700', color: m.ready ? m.color : C.muted }}>{m.ready ? 'READY' : 'SOON'}</Text>
                    </View>
                  </View>
                </PressableCard>
              ))}
            </View>
          </View>

          {/* ═══ UPCOMING FEATURES — Horizontal Scroll ═══ */}
          <Text style={{ fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 0.8, marginTop: 28, marginBottom: 12, paddingHorizontal: 20 }}>COMING NEXT</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingLeft: 20, paddingRight: 40 }}
          >
            {UPCOMING.map((item) => (
              <View key={item.key} style={{ width: SCREEN_W * 0.65, marginRight: 12 }}>
                <LinearGradient
                  colors={item.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ borderRadius: 18, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', minHeight: 150 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                      <Ionicons name={item.icon as any} size={18} color={item.color} />
                    </View>
                    <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: item.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>Coming Soon</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: C.white, marginBottom: 6 }}>{item.title}</Text>
                  <Text style={{ fontSize: 11, color: C.label, lineHeight: 16 }}>{item.sub}</Text>
                </LinearGradient>
              </View>
            ))}
          </ScrollView>

          {/* ═══ AI EXPERTISE — What the coach knows ═══ */}
          <Text style={{ fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 0.8, marginTop: 28, marginBottom: 12, paddingHorizontal: 20 }}>AI EXPERTISE</Text>
          <View style={{ paddingHorizontal: 20 }}>
            <View style={{ backgroundColor: C.card, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: C.cardBorder }}>
              {[
                { icon: 'barbell-outline', label: 'Exercise science & programming', color: C.accent },
                { icon: 'medkit-outline', label: 'Injury prevention & rehab', color: C.pink },
                { icon: 'restaurant-outline', label: 'Nutrition & supplementation', color: '#FFB74D' },
                { icon: 'body-outline', label: 'Biomechanics & form analysis', color: C.cyan },
                { icon: 'trending-up-outline', label: 'Periodization & progression', color: '#42A5F5' },
              ].map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: i < 4 ? 14 : 0 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.04)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                    <Ionicons name={item.icon as any} size={14} color={item.color} />
                  </View>
                  <Text style={{ fontSize: 12, color: C.label, flex: 1 }}>{item.label}</Text>
                  <Ionicons name="checkmark" size={14} color={C.accent} />
                </View>
              ))}
            </View>
          </View>

          {/* ═══ BOTTOM TIP ═══ */}
          <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
            <LinearGradient
              colors={['rgba(100,231,241,0.08)', 'rgba(31,164,99,0.06)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(100,231,241,0.08)', flexDirection: 'row', alignItems: 'center' }}
            >
              <Ionicons name="information-circle-outline" size={16} color={C.cyan} />
              <Text style={{ fontSize: 11, color: C.label, marginLeft: 10, flex: 1, lineHeight: 16 }}>AI responses are based on general fitness knowledge. Always consult a professional for medical concerns.</Text>
            </LinearGradient>
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Styles ──
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
});
