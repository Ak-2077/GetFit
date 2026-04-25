import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop, Circle, Text as SvgText, Line } from 'react-native-svg';
import { getUserProfile, getWeeklyCalories, setAuthToken } from '../../services/api';

// ─── THEME ──────────────────────────────────────────────
const THEME = {
  bg: '#f1f0ec',
  card: '#ffffff',
  textPrimary: '#111111',
  textSecondary: '#666666',
  accent: '#22c55e',
  accentLight: '#dcfce7',
  border: 'rgba(0,0,0,0.05)',
};

const SCREEN_WIDTH = Dimensions.get('window').width;

// ─── HELPERS ────────────────────────────────────────────

function getBmiCategory(bmi: number) {
  if (bmi < 18.5) return { label: 'Underweight', range: '< 18.5', color: '#60A5FA' };
  if (bmi < 25) return { label: 'Normal', range: '18.5 – 24.9', color: '#22c55e' };
  if (bmi < 30) return { label: 'Overweight', range: '25 – 29.9', color: '#f59e0b' };
  return { label: 'Obese', range: '≥ 30', color: '#ef4444' };
}

function formatSubscription(plan: string) {
  if (plan === 'pro') return 'Pro';
  if (plan === 'pro_plus') return 'Pro Plus';
  return 'Free';
}

// ─── WEEKLY CHART COMPONENT (REAL DATA) ─────────────────

interface WeeklyDataPoint {
  day: string;
  calories: number;
}

interface ChartProps {
  weeklyData: WeeklyDataPoint[];
  goalCalories: number;
  bmi: number | null;
  loading: boolean;
}

function WeeklyChart({ weeklyData, goalCalories, bmi, loading }: ChartProps) {
  const chartWidth = SCREEN_WIDTH - 72;
  const chartHeight = 140;

  if (loading) {
    return (
      <View style={{
        height: chartHeight + 50,
        justifyContent: 'center',
        alignItems: 'center',
      }}>
        <ActivityIndicator color={THEME.accent} size="small" />
        <Text style={{ fontSize: 12, color: THEME.textSecondary, marginTop: 8 }}>
          Loading chart…
        </Text>
      </View>
    );
  }

  const calorieValues = weeklyData.map(d => d.calories);
  const hasData = calorieValues.some(v => v > 0);

  if (!hasData) {
    return (
      <View style={{
        height: chartHeight + 50,
        justifyContent: 'center',
        alignItems: 'center',
      }}>
        <FontAwesome name="bar-chart" size={28} color="rgba(0,0,0,0.1)" />
        <Text style={{ fontSize: 13, color: THEME.textSecondary, marginTop: 8 }}>
          No calorie data this week
        </Text>
        <Text style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
          Log food to see your progress
        </Text>
      </View>
    );
  }

  const maxVal = Math.max(...calorieValues) * 1.15 || 100;
  const minVal = Math.min(...calorieValues.filter(v => v > 0)) * 0.7 || 0;
  const range = maxVal - minVal || 1;

  const points = calorieValues.map((val, i) => {
    const x = (i / (calorieValues.length - 1)) * chartWidth;
    const y = chartHeight - ((val - minVal) / range) * (chartHeight - 20) - 10;
    return { x, y: Math.max(5, Math.min(chartHeight - 5, y)) };
  });

  // Build smooth bezier curve
  let linePath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const cp1x = points[i].x + (points[i + 1].x - points[i].x) / 3;
    const cp1y = points[i].y;
    const cp2x = points[i + 1].x - (points[i + 1].x - points[i].x) / 3;
    const cp2y = points[i + 1].y;
    linePath += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${points[i + 1].x} ${points[i + 1].y}`;
  }

  const areaPath = linePath +
    ` L ${points[points.length - 1].x} ${chartHeight} L ${points[0].x} ${chartHeight} Z`;

  // Goal line position
  const goalY = goalCalories > 0
    ? chartHeight - ((goalCalories - minVal) / range) * (chartHeight - 20) - 10
    : -1;

  return (
    <View>
      <Svg width={chartWidth} height={chartHeight + 30}>
        <Defs>
          <SvgGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#22c55e" stopOpacity="0.35" />
            <Stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
          </SvgGradient>
        </Defs>

        {/* Area fill */}
        <Path d={areaPath} fill="url(#areaGrad)" />

        {/* Line */}
        <Path
          d={linePath}
          stroke="#22c55e"
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Goal dashed line */}
        {goalY >= 0 && goalY <= chartHeight && (
          <Line
            x1={0}
            y1={goalY}
            x2={chartWidth}
            y2={goalY}
            stroke="rgba(0,0,0,0.1)"
            strokeWidth={1}
            strokeDasharray="5,5"
          />
        )}

        {/* Dots */}
        {points.map((p, i) => (
          <React.Fragment key={i}>
            <Circle cx={p.x} cy={p.y} r={4} fill="#ffffff" stroke="#22c55e" strokeWidth={2} />
          </React.Fragment>
        ))}

        {/* X-axis labels */}
        {weeklyData.map((d, i) => {
          const x = (i / (weeklyData.length - 1)) * chartWidth;
          return (
            <SvgText
              key={d.day + i}
              x={x}
              y={chartHeight + 20}
              fontSize={11}
              fill="#999999"
              textAnchor="middle"
              fontWeight="500"
            >
              {d.day}
            </SvgText>
          );
        })}
      </Svg>

      {/* Legend row */}
      <View style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 8,
        paddingHorizontal: 4,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />
          <Text style={{ fontSize: 12, color: THEME.textSecondary }}>
            Surplus: {goalCalories ? `${goalCalories} kcal` : '—'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#60A5FA' }} />
          <Text style={{ fontSize: 12, color: THEME.textSecondary }}>
            BMI: {bmi ? bmi.toFixed(1) : '—'}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── MAIN COMPONENT ─────────────────────────────────────

export default function ProfileScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [weeklyData, setWeeklyData] = useState<WeeklyDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        router.replace('/auth' as any);
        return;
      }
      setAuthToken(token);

      // Fetch profile and weekly calories in parallel
      const [profileRes, weeklyRes] = await Promise.all([
        getUserProfile(),
        getWeeklyCalories().catch(() => ({ data: { data: [] } })),
      ]);

      setUser(profileRes.data);
      setWeeklyData(weeklyRes.data?.data || []);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        await AsyncStorage.removeItem('token');
        setAuthToken(null);
        router.replace('/auth' as any);
        return;
      }
      console.warn('Failed to load profile', err?.response?.data || err.message);
    } finally {
      setLoading(false);
      setChartLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      setChartLoading(true);
      loadProfile();
    }, [loadProfile])
  );

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: THEME.bg }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={THEME.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const bmi = user?.bmi || null;
  const bmiInfo = bmi ? getBmiCategory(bmi) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.bg }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ═══════════════ HEADER ═══════════════ */}
        <View style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 12,
          paddingBottom: 8,
        }}>
          <Text style={{
            fontSize: 28,
            fontWeight: '800',
            color: THEME.textPrimary,
            letterSpacing: -0.5,
          }}>
            Profile
          </Text>

          <TouchableOpacity
            onPress={() => router.push('/auth/profile-settings' as any)}
            activeOpacity={0.7}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: THEME.card,
              justifyContent: 'center',
              alignItems: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.06,
              shadowRadius: 8,
              elevation: 3,
            }}
          >
            <FontAwesome name="cog" size={18} color={THEME.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* ═══════════════ AVATAR SECTION ═══════════════ */}
        <View style={{ alignItems: 'center', marginTop: 12, marginBottom: 24 }}>
          <View style={{
            width: 100,
            height: 100,
            borderRadius: 50,
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: THEME.accent,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.35,
            shadowRadius: 20,
            elevation: 10,
          }}>
            <View style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              borderWidth: 3,
              borderColor: THEME.accent,
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: THEME.card,
            }}>
              {user?.avatar ? (
                <Image
                  source={{ uri: user.avatar }}
                  style={{ width: 86, height: 86, borderRadius: 43 }}
                />
              ) : (
                <View style={{
                  width: 86,
                  height: 86,
                  borderRadius: 43,
                  backgroundColor: THEME.accentLight,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                  <Text style={{
                    fontSize: 36,
                    fontWeight: '700',
                    color: THEME.accent,
                  }}>
                    {(user?.name || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
          </View>

          <Text style={{
            fontSize: 22,
            fontWeight: '700',
            color: THEME.textPrimary,
            marginTop: 14,
          }}>
            {user?.name || '—'}
          </Text>
          <Text style={{
            fontSize: 14,
            color: THEME.textSecondary,
            marginTop: 4,
          }}>
            On a fitness journey 💪
          </Text>
        </View>

        {/* ═══════════════ PROGRESS GRAPH CARD ═══════════════ */}
        <View style={{
          backgroundColor: THEME.card,
          borderRadius: 20,
          padding: 20,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: THEME.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.04,
          shadowRadius: 12,
          elevation: 3,
        }}>
          <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}>
            <Text style={{
              fontSize: 16,
              fontWeight: '700',
              color: THEME.textPrimary,
            }}>
              Weekly Calories
            </Text>
            <View style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 12,
              backgroundColor: THEME.accentLight,
            }}>
              <Text style={{
                fontSize: 11,
                fontWeight: '600',
                color: THEME.accent,
              }}>
                This Week
              </Text>
            </View>
          </View>

          <WeeklyChart
            weeklyData={weeklyData}
            goalCalories={user?.goalCalories || 0}
            bmi={bmi}
            loading={chartLoading}
          />
        </View>

        {/* ═══════════════ STATS CARDS (3 Grid) ═══════════════ */}
        <View style={{
          flexDirection: 'row',
          gap: 10,
          marginBottom: 20,
        }}>
          {/* Card 1 – Maintenance */}
          <View style={{
            flex: 1,
            backgroundColor: THEME.card,
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: THEME.border,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.03,
            shadowRadius: 8,
            elevation: 2,
          }}>
            <View style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: '#dcfce7',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 10,
            }}>
              <FontAwesome name="leaf" size={16} color="#22c55e" />
            </View>
            <Text style={{
              fontSize: 11,
              fontWeight: '600',
              color: THEME.textSecondary,
              marginBottom: 3,
            }}>
              Maintenance
            </Text>
            <Text style={{
              fontSize: 18,
              fontWeight: '800',
              color: THEME.textPrimary,
            }}>
              {user?.maintenanceCalories || '—'}
            </Text>
            <Text style={{
              fontSize: 10,
              color: THEME.textSecondary,
              marginTop: 2,
            }}>
              kcal/day
            </Text>
          </View>

          {/* Card 2 – Goal */}
          <View style={{
            flex: 1,
            backgroundColor: THEME.card,
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: THEME.border,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.03,
            shadowRadius: 8,
            elevation: 2,
          }}>
            <View style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: '#dbeafe',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 10,
            }}>
              <FontAwesome name="line-chart" size={14} color="#3b82f6" />
            </View>
            <Text style={{
              fontSize: 11,
              fontWeight: '600',
              color: THEME.textSecondary,
              marginBottom: 3,
            }}>
              Goal
            </Text>
            <Text style={{
              fontSize: 18,
              fontWeight: '800',
              color: THEME.textPrimary,
            }}>
              {user?.goalCalories || '—'}
            </Text>
            <Text style={{
              fontSize: 10,
              color: THEME.textSecondary,
              marginTop: 2,
            }}>
              kcal/day
            </Text>
          </View>

          {/* Card 3 – BMI Analysis */}
          <View style={{
            flex: 1,
            backgroundColor: THEME.card,
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: THEME.border,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.03,
            shadowRadius: 8,
            elevation: 2,
          }}>
            <View style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: bmiInfo ? `${bmiInfo.color}18` : '#f3e8ff',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 10,
            }}>
              <FontAwesome name="heartbeat" size={15} color={bmiInfo?.color || '#a855f7'} />
            </View>
            <Text style={{
              fontSize: 11,
              fontWeight: '600',
              color: THEME.textSecondary,
              marginBottom: 3,
            }}>
              BMI Analysis
            </Text>
            <Text style={{
              fontSize: 18,
              fontWeight: '800',
              color: bmiInfo?.color || THEME.textPrimary,
            }}>
              {bmiInfo?.label || '—'}
            </Text>
            <Text style={{
              fontSize: 10,
              color: THEME.textSecondary,
              marginTop: 2,
            }}>
              {bmiInfo?.range || '—'}
            </Text>
          </View>
        </View>

        {/* ═══════════════ SUBSCRIPTION SECTION ═══════════════ */}
        <View style={{
          backgroundColor: THEME.card,
          borderRadius: 20,
          padding: 20,
          borderWidth: 1,
          borderColor: THEME.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.04,
          shadowRadius: 12,
          elevation: 3,
          marginBottom: 20,
        }}>
          <View style={{ flexDirection: 'row' }}>
            {/* Left side */}
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={{
                fontSize: 11,
                fontWeight: '600',
                color: THEME.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
                marginBottom: 6,
              }}>
                Subscription
              </Text>
              <Text style={{
                fontSize: 18,
                fontWeight: '700',
                color: THEME.textPrimary,
                marginBottom: 12,
              }}>
                {formatSubscription(user?.subscriptionPlan)} Plan
              </Text>

              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    backgroundColor: '#dcfce7',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                    <FontAwesome name="trophy" size={12} color="#22c55e" />
                  </View>
                  <Text style={{ fontSize: 12, color: THEME.textSecondary }}>
                    Workout plans
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    backgroundColor: '#dbeafe',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                    <FontAwesome name="calendar" size={11} color="#3b82f6" />
                  </View>
                  <Text style={{ fontSize: 12, color: THEME.textSecondary }}>
                    Schedule plans
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    backgroundColor: '#fef3c7',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}>
                    <FontAwesome name="lock" size={12} color="#f59e0b" />
                  </View>
                  <Text style={{ fontSize: 12, color: THEME.textSecondary }}>
                    Access limits
                  </Text>
                </View>
              </View>
            </View>

            {/* Right side */}
            <View style={{
              alignItems: 'center',
              justifyContent: 'center',
              width: 120,
            }}>
              <View style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                backgroundColor: THEME.accentLight,
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 8,
                shadowColor: THEME.accent,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 8,
                elevation: 4,
              }}>
                <FontAwesome name="bolt" size={22} color={THEME.accent} />
              </View>
              <Text style={{
                fontSize: 14,
                fontWeight: '700',
                color: THEME.textPrimary,
                textAlign: 'center',
              }}>
                AI Trainer
              </Text>
              <Text style={{
                fontSize: 10,
                color: THEME.textSecondary,
                textAlign: 'center',
                marginTop: 2,
              }}>
                {user?.subscriptionPlan === 'free'
                  ? 'Basic features included'
                  : 'Premium active'}
              </Text>
            </View>
          </View>

          {user?.subscriptionPlan === 'free' && (
            <TouchableOpacity
              activeOpacity={0.85}
              style={{ marginTop: 18, borderRadius: 14, overflow: 'hidden' }}
            >
              <LinearGradient
                colors={['#22c55e', '#16a34a']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  height: 48,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 14,
                }}
              >
                <Text style={{
                  color: '#ffffff',
                  fontSize: 15,
                  fontWeight: '700',
                  letterSpacing: 0.3,
                }}>
                  Upgrade to Pro
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>

        {/* ═══════════════ INCOMPLETE PROFILE BANNER ═══════════════ */}
        {user?.onboardingCompleted === false && (
          <TouchableOpacity
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#fffbeb',
              borderRadius: 16,
              padding: 16,
              marginBottom: 20,
              borderWidth: 1,
              borderColor: '#fef3c7',
            }}
            onPress={() => router.push('/auth/onboarding' as any)}
            activeOpacity={0.8}
          >
            <View style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: '#fef3c7',
              justifyContent: 'center',
              alignItems: 'center',
              marginRight: 14,
            }}>
              <FontAwesome name="exclamation-circle" size={18} color="#f59e0b" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{
                fontSize: 14,
                fontWeight: '700',
                color: '#92400e',
              }}>
                Complete your profile
              </Text>
              <Text style={{
                fontSize: 12,
                color: '#b45309',
                marginTop: 2,
              }}>
                Tap to set up your fitness data
              </Text>
            </View>
            <FontAwesome name="chevron-right" size={13} color="#d97706" />
          </TouchableOpacity>
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
