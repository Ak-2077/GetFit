import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { getSubscriptionPlans, upgradeSubscription, setAuthToken } from '../services/api';


const C = {
  bg: '#060D09', card: '#0F1A13', cardBorder: 'rgba(31,164,99,0.12)', accent: '#1FA463',
  white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)',
  purple: '#6A0DAD', gold: '#C8A84E',
};

const VIBGYOR: [string, string, ...string[]] = ['#8B00FF', '#4B0082', '#0000FF', '#00FF00', '#FFFF00', '#FF7F00', '#FF0000'];

const FALLBACK_PLANS = [
  {
    key: 'free', name: 'Free Plan', price: '₹0', period: 'forever',
    features: [
      { name: 'Basic Food Logging', included: true },
      { name: 'Step Tracking', included: true },
      { name: 'BMI Calculator', included: true },
      { name: 'Weekly Workout Plan', included: true },
      { name: 'Balance Meal Meter', included: false },
      { name: 'AI Diet Plans', included: false },
      { name: 'Priority Support', included: false },
    ],
  },
  {
    key: 'pro', name: 'AI Trainer Pro', price: '₹199', period: '/month', badge: 'Most Popular',
    features: [
      { name: 'Basic Food Logging', included: true },
      { name: 'Step Tracking', included: true },
      { name: 'BMI Calculator', included: true },
      { name: 'Weekly Workout Plan', included: true },
      { name: 'Balance Meal Meter', included: true },
      { name: 'AI Diet Plans', included: true },
      { name: 'Priority Support', included: false },
    ],
  },
  {
    key: 'pro_plus', name: 'AI Trainer Pro+', price: '₹399', period: '/month', badge: 'Best Value',
    features: [
      { name: 'Basic Food Logging', included: true },
      { name: 'Step Tracking', included: true },
      { name: 'BMI Calculator', included: true },
      { name: 'Weekly Workout Plan', included: true },
      { name: 'Balance Meal Meter', included: true },
      { name: 'AI Diet Plans', included: true },
      { name: 'Priority Support', included: true },
    ],
  },
];

export default function UpgradeScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<any[]>(FALLBACK_PLANS);
  const [currentPlan, setCurrentPlan] = useState('free');
  const [upgrading, setUpgrading] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);
      const res = await getSubscriptionPlans();
      const fetched = res.data?.plans;
      if (fetched && fetched.length > 0) setPlans(fetched);
      setCurrentPlan(res.data?.currentPlan || 'free');
    } catch (err) {
      console.warn('Failed to fetch plans, using fallback', err);
    }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleUpgrade = async (planKey: string) => {
    if (planKey === currentPlan) return;
    const planRank: Record<string, number> = { free: 0, pro: 1, pro_plus: 2 };
    if (planRank[planKey] <= planRank[currentPlan]) {
      Alert.alert('Info', 'You already have this plan or a higher one.');
      return;
    }
    try {
      setUpgrading(planKey);
      await upgradeSubscription(planKey);
      setCurrentPlan(planKey);
      Alert.alert('Success', 'Plan upgraded successfully!');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Upgrade failed');
    } finally { setUpgrading(''); }
  };

  const getCardStyle = (key: string) => {
    if (key === 'pro_plus') return { borderColor: '#FF7F00', bg: ['rgba(139,0,255,0.08)', 'rgba(255,0,0,0.04)'] as [string, string] };
    if (key === 'pro') return { borderColor: C.purple, bg: ['rgba(106,13,173,0.08)', 'rgba(106,13,173,0.02)'] as [string, string] };
    return { borderColor: C.cardBorder, bg: [C.card, C.card] as [string, string] };
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: '#060D09', justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#1FA463" /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 16 }}>
            <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
              <Ionicons name="chevron-back" size={20} color={C.white} />
            </TouchableOpacity>
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white }}>Choose Your Plan</Text>
              <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>Unlock premium fitness features</Text>
            </View>
          </View>

          {/* Plans */}
          {plans.map((plan) => {
            const isCurrent = plan.key === currentPlan;
            const style = getCardStyle(plan.key);
            return (
              <View key={plan.key} style={{ marginBottom: 16, borderRadius: 20, borderWidth: 1.5, borderColor: isCurrent ? C.accent : style.borderColor, overflow: 'hidden' }}>
                <LinearGradient colors={style.bg} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 20, borderRadius: 18 }}>
                  {/* Badge */}
                  {plan.badge && (
                    <View style={{ alignSelf: 'flex-start', marginBottom: 12 }}>
                      <LinearGradient
                        colors={plan.key === 'pro_plus' ? VIBGYOR.slice(0, 3) as [string, string, ...string[]] : [C.purple, '#9B59B6']}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 }}>
                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{plan.badge}</Text>
                      </LinearGradient>
                    </View>
                  )}

                  {/* Title + Price */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
                    <View>
                      <Text style={{ color: C.white, fontSize: 20, fontWeight: '800' }}>{plan.name}</Text>
                      {isCurrent && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' }} />
                          <Text style={{ color: '#22C55E', fontSize: 11, fontWeight: '600' }}>Current Plan</Text>
                        </View>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: C.white, fontSize: 28, fontWeight: '800' }}>{plan.price}</Text>
                      <Text style={{ color: C.muted, fontSize: 11 }}>{plan.period}</Text>
                    </View>
                  </View>

                  {/* Features */}
                  {plan.features.map((feat: any, i: number) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: feat.included ? 'rgba(31,164,99,0.12)' : 'rgba(255,255,255,0.04)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                        <Ionicons name={feat.included ? 'checkmark' : 'close'} size={12} color={feat.included ? C.accent : 'rgba(255,255,255,0.15)'} />
                      </View>
                      <Text style={{ color: feat.included ? C.white : C.muted, fontSize: 13, fontWeight: feat.included ? '500' : '400' }}>{feat.name}</Text>
                    </View>
                  ))}

                  {/* CTA */}
                  {isCurrent ? (
                    <View style={{ height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', justifyContent: 'center', alignItems: 'center', marginTop: 8 }}>
                      <Text style={{ color: C.muted, fontSize: 14, fontWeight: '600' }}>Current Plan</Text>
                    </View>
                  ) : (
                    <TouchableOpacity activeOpacity={0.8} onPress={() => handleUpgrade(plan.key)} disabled={!!upgrading} style={{ borderRadius: 14, overflow: 'hidden', marginTop: 8 }}>
                      <LinearGradient
                        colors={plan.key === 'pro_plus' ? ['#FF7F00', '#FF0000'] : plan.key === 'pro' ? [C.purple, '#9B59B6'] : [C.accent, '#178A52']}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={{ height: 46, justifyContent: 'center', alignItems: 'center', borderRadius: 14 }}>
                        {upgrading === plan.key ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Upgrade to {plan.name}</Text>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  )}
                </LinearGradient>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
