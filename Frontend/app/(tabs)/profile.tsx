import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { getUserProfile, setAuthToken } from '../../services/api';

// ─── HELPERS ────────────────────────────────────────────

function getBmiCategory(bmi: number) {
  if (bmi < 18.5) return { label: 'Underweight', color: '#60A5FA' };
  if (bmi <= 24.9) return { label: 'Normal', color: '#34D399' };
  if (bmi <= 29.9) return { label: 'Overweight', color: '#FBBF24' };
  return { label: 'Obese', color: '#F87171' };
}

function formatGoal(goal: string) {
  if (goal === 'lose') return 'Lose Weight';
  if (goal === 'gain') return 'Gain Weight';
  if (goal === 'maintain') return 'Maintain';
  if (goal === 'lose_fat') return 'Lose Fat';
  if (goal === 'gain_muscle') return 'Gain Muscle';
  return goal || '—';
}

function formatLevel(level: string) {
  if (level === 'beginner') return 'Beginner';
  if (level === 'intermediate') return 'Intermediate';
  if (level === 'advanced') return 'Advanced';
  return level || '—';
}

function formatDiet(diet: string) {
  if (diet === 'veg') return 'Vegetarian';
  if (diet === 'non_veg') return 'Non-Veg';
  return diet || '—';
}

function formatBodyType(bodyType: string) {
  if (bodyType === 'ectomorph') return 'Ectomorph';
  if (bodyType === 'mesomorph') return 'Mesomorph';
  if (bodyType === 'endomorph') return 'Endomorph';
  return bodyType || '—';
}

function formatSubscription(plan: string) {
  if (plan === 'pro') return 'AI Trainer Pro';
  if (plan === 'pro_plus') return 'AI Trainer Pro Plus';
  return 'AI Trainer (Free)';
}

// ─── MAIN COMPONENT ─────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      // Ensure auth token is set
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);

      const res = await getUserProfile();
      setUser(res.data);
    } catch (err: any) {
      console.warn('Failed to load profile', err?.response?.data || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadProfile();
    }, [loadProfile])
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const bmi = user?.bmi || null;
  const bmiInfo = bmi ? getBmiCategory(bmi) : null;
  const isProfileComplete = user?.onboardingCompleted === true;

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ─── HEADER ─── */}
        <Text style={styles.headerTitle}>Profile</Text>

        {/* ─── USER CARD ─── */}
        <View style={styles.userCard}>
          <View style={styles.userInfo}>
            <View>
              <Text style={styles.userName}>{user?.name || '—'}</Text>
              <Text style={styles.userSubtitle}>On a fitness journey 💪</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/auth/profile-settings' as any)}
            activeOpacity={0.8}
          >
            {user?.avatar ? (
              <Image source={{ uri: user.avatar }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.initialsAvatar]}>
                <Text style={styles.initialsText}>
                  {(user?.name || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.avatarBadge}>
              <FontAwesome name="cog" size={10} color="#000" />
            </View>
          </TouchableOpacity>
        </View>

        {/* ─── INCOMPLETE PROFILE BANNER ─── */}
        {!isProfileComplete && (
          <TouchableOpacity
            style={styles.incompleteBanner}
            onPress={() => router.push('/auth/onboarding' as any)}
            activeOpacity={0.8}
          >
            <View style={styles.incompleteBannerIcon}>
              <FontAwesome name="exclamation-circle" size={20} color="#FBBF24" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.incompleteBannerTitle}>Complete your profile</Text>
              <Text style={styles.incompleteBannerSub}>Tap to set up your fitness data</Text>
            </View>
            <FontAwesome name="chevron-right" size={14} color="#9CA3AF" />
          </TouchableOpacity>
        )}

        {/* ─── FITNESS DATA CARDS ─── */}
        <Text style={styles.sectionLabel}>Fitness Overview</Text>
        <View style={styles.cardsGrid}>
          {/* Goal */}
          <View style={styles.card}>
            <View style={[styles.cardIconBg, { backgroundColor: 'rgba(251,191,36,0.15)' }]}>
              <FontAwesome name="bullseye" size={18} color="#FBBF24" />
            </View>
            <Text style={styles.cardLabel}>Goal</Text>
            <Text style={styles.cardValue}>{formatGoal(user?.goal)}</Text>
          </View>

          {/* BMI */}
          <View style={styles.card}>
            <View style={[styles.cardIconBg, { backgroundColor: `${bmiInfo?.color || '#60A5FA'}20` }]}>
              <FontAwesome name="heartbeat" size={18} color={bmiInfo?.color || '#60A5FA'} />
            </View>
            <Text style={styles.cardLabel}>BMI</Text>
            <Text style={styles.cardValue}>{bmi ? bmi.toFixed(1) : '—'}</Text>
            {bmiInfo && (
              <View style={[styles.badge, { backgroundColor: `${bmiInfo.color}20` }]}>
                <Text style={[styles.badgeText, { color: bmiInfo.color }]}>{bmiInfo.label}</Text>
              </View>
            )}
          </View>

          {/* Body Type */}
          <View style={styles.card}>
            <View style={[styles.cardIconBg, { backgroundColor: 'rgba(167,139,250,0.15)' }]}>
              <FontAwesome name="male" size={18} color="#A78BFA" />
            </View>
            <Text style={styles.cardLabel}>Body Type</Text>
            <Text style={styles.cardValue}>{formatBodyType(user?.bodyType)}</Text>
          </View>

          {/* Level */}
          <View style={styles.card}>
            <View style={[styles.cardIconBg, { backgroundColor: 'rgba(96,165,250,0.15)' }]}>
              <FontAwesome name="signal" size={18} color="#60A5FA" />
            </View>
            <Text style={styles.cardLabel}>Level</Text>
            <Text style={styles.cardValue}>{formatLevel(user?.level)}</Text>
          </View>

          {/* Diet */}
          <View style={styles.card}>
            <View style={[styles.cardIconBg, { backgroundColor: 'rgba(52,211,153,0.15)' }]}>
              <FontAwesome name="leaf" size={18} color="#34D399" />
            </View>
            <Text style={styles.cardLabel}>Diet</Text>
            <Text style={styles.cardValue}>{formatDiet(user?.dietPreference)}</Text>
          </View>

          {/* Weight */}
          <View style={styles.card}>
            <View style={[styles.cardIconBg, { backgroundColor: 'rgba(248,113,113,0.15)' }]}>
              <FontAwesome name="dashboard" size={18} color="#F87171" />
            </View>
            <Text style={styles.cardLabel}>Weight</Text>
            <Text style={styles.cardValue}>{user?.weight ? `${user.weight} kg` : '—'}</Text>
          </View>
        </View>

        {/* ─── CALORIES SECTION ─── */}
        <Text style={styles.sectionLabel}>Daily Calories</Text>
        <View style={styles.caloriesCard}>
          <View style={styles.caloriesRow}>
            <View style={styles.caloriesItem}>
              <Text style={styles.caloriesNumber}>
                {user?.maintenanceCalories || '—'}
              </Text>
              <Text style={styles.caloriesLabel}>Maintenance</Text>
            </View>
            <View style={styles.caloriesDivider} />
            <View style={styles.caloriesItem}>
              <Text style={[styles.caloriesNumber, { color: '#34D399' }]}>
                {user?.goalCalories || '—'}
              </Text>
              <Text style={styles.caloriesLabel}>Goal ({formatGoal(user?.goal)})</Text>
            </View>
          </View>

          {user?.maintenanceCalories && user?.goalCalories && (
            <View style={styles.caloriesDiffRow}>
              <FontAwesome
                name={user.goalCalories < user.maintenanceCalories ? 'arrow-down' : user.goalCalories > user.maintenanceCalories ? 'arrow-up' : 'minus'}
                size={12}
                color={user.goalCalories < user.maintenanceCalories ? '#60A5FA' : user.goalCalories > user.maintenanceCalories ? '#FBBF24' : '#9CA3AF'}
              />
              <Text style={styles.caloriesDiffText}>
                {Math.abs(user.goalCalories - user.maintenanceCalories)} kcal
                {user.goalCalories < user.maintenanceCalories ? ' deficit' : user.goalCalories > user.maintenanceCalories ? ' surplus' : ''}
              </Text>
            </View>
          )}
        </View>

        {/* ─── SUBSCRIPTION SECTION ─── */}
        <Text style={styles.sectionLabel}>Subscription</Text>
        <View style={styles.subscriptionCard}>
          <View style={styles.subscriptionTop}>
            <View style={[styles.cardIconBg, { backgroundColor: 'rgba(251,191,36,0.15)' }]}>
              <FontAwesome name="star" size={18} color="#FBBF24" />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.subscriptionPlan}>
                {formatSubscription(user?.subscriptionPlan)}
              </Text>
              <Text style={styles.subscriptionStatus}>
                {user?.subscriptionPlan === 'free' ? 'Basic features included' : 'Premium features active'}
              </Text>
            </View>
          </View>

          {user?.subscriptionPlan === 'free' && (
            <TouchableOpacity style={styles.upgradeButton} activeOpacity={0.8}>
              <Text style={styles.upgradeButtonText}>Upgrade to Pro</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── STYLES ────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  // Header
  headerTitle: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
    paddingTop: 16,
    paddingBottom: 20,
  },

  // User Card
  userCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: 28,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  userSubtitle: {
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 4,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2D2D2D',
    borderWidth: 2,
    borderColor: '#3A3A3A',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1A1A1A',
  },

  // Initials Avatar
  initialsAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initialsText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },

  // Incomplete Banner
  incompleteBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.2)',
  },
  incompleteBannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(251,191,36,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  incompleteBannerTitle: {
    color: '#FBBF24',
    fontSize: 15,
    fontWeight: '700',
  },
  incompleteBannerSub: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 2,
  },

  // Section
  sectionLabel: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },

  // Fitness Cards Grid
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 28,
  },
  card: {
    width: '47%',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardIconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  cardValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Calories
  caloriesCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: 28,
  },
  caloriesRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  caloriesItem: {
    flex: 1,
    alignItems: 'center',
  },
  caloriesNumber: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
  },
  caloriesLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  caloriesDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#2A2A2A',
    marginHorizontal: 16,
  },
  caloriesDiffRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    gap: 6,
  },
  caloriesDiffText: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
  },

  // Subscription
  subscriptionCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  subscriptionTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subscriptionPlan: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  subscriptionStatus: {
    color: '#9CA3AF',
    fontSize: 13,
    marginTop: 2,
  },
  upgradeButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
  },
  upgradeButtonText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '700',
  },
});
