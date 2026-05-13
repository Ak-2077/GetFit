import React from 'react';
import { View, Dimensions, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SkeletonBox, SkeletonCircle, SkeletonText, SkeletonCard } from './SkeletonLoader';

const { width: SW } = Dimensions.get('window');

// ─── SHARED STYLES ─────────────────────────────────────
const BG = '#060D09';
const BG_DARK = '#050505';
const BG_BLACK = '#000000';

const row = { flexDirection: 'row' as const, alignItems: 'center' as const };
const gap = (n: number) => ({ gap: n });
const mb = (n: number) => ({ marginBottom: n });
const mt = (n: number) => ({ marginTop: n });
const ph = (n: number) => ({ paddingHorizontal: n });
const flex1 = { flex: 1 };

// ─── HOME SCREEN SKELETON ──────────────────────────────
export function HomeSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {/* Header: Avatar + Name + Icons */}
          <View style={[row, { paddingTop: 8, paddingBottom: 16 }]}>
            <SkeletonCircle size={46} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <SkeletonText width={80} height={10} style={mb(6)} />
              <SkeletonText width={130} height={16} />
            </View>
            <SkeletonCircle size={40} style={{ marginRight: 8 }} />
            <SkeletonCircle size={40} />
          </View>

          {/* Upgrade banner */}
          <SkeletonCard height={76} style={mb(20)} />

          {/* Tools label */}
          <SkeletonText width={50} height={10} style={mb(14)} />

          {/* 5 Tool circles */}
          <View style={[row, { justifyContent: 'space-between' }, mb(22)]}>
            {[...Array(5)].map((_, i) => (
              <View key={i} style={{ alignItems: 'center', width: 72 }}>
                <SkeletonCircle size={60} style={mb(8)} />
                <SkeletonText width={48} height={10} />
              </View>
            ))}
          </View>

          {/* Today's Summary label */}
          <SkeletonText width={110} height={10} style={mb(12)} />

          {/* 3 Summary cards */}
          <View style={[row, gap(10), mb(16)]}>
            {[...Array(3)].map((_, i) => (
              <View key={i} style={{ flex: 1, backgroundColor: 'rgba(25,25,25,1)', borderRadius: 18, padding: 14, alignItems: 'center' }}>
                <SkeletonBox width={38} height={38} borderRadius={12} style={mb(10)} />
                <SkeletonText width={50} height={18} style={mb(4)} />
                <SkeletonText width={36} height={8} style={mb(4)} />
                <SkeletonText width={60} height={8} />
              </View>
            ))}
          </View>

          {/* Today's Workout label */}
          <SkeletonText width={120} height={10} style={mb(12)} />

          {/* Workout card */}
          <View style={{ backgroundColor: 'rgba(25,25,25,1)', borderRadius: 18, padding: 18, ...mb(20) }}>
            <View style={[row, mb(14)]}>
              <SkeletonBox width={44} height={44} borderRadius={14} style={{ marginRight: 14 }} />
              <View style={flex1}>
                <SkeletonText width={140} height={14} style={mb(4)} />
                <SkeletonText width={100} height={10} />
              </View>
            </View>
            <SkeletonBox width="100%" height={46} borderRadius={14} />
          </View>

          {/* Quick Actions label */}
          <SkeletonText width={100} height={10} style={mb(12)} />

          {/* 3 Quick action cards */}
          <View style={[row, gap(10), mb(20)]}>
            {[...Array(3)].map((_, i) => (
              <View key={i} style={{ flex: 1, backgroundColor: 'rgba(25,25,25,1)', borderRadius: 18, paddingVertical: 18, alignItems: 'center' }}>
                <SkeletonCircle size={44} style={mb(10)} />
                <SkeletonText width={56} height={10} />
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── PROFILE SCREEN SKELETON ───────────────────────────
export function ProfileSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: BG_DARK }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={[row, { justifyContent: 'space-between', paddingTop: 8, paddingBottom: 16 }]}>
            <SkeletonText width={100} height={26} />
            <SkeletonCircle size={40} />
          </View>

          {/* Profile card */}
          <View style={{ backgroundColor: 'rgba(25,25,25,1)', borderRadius: 18, padding: 18, ...mb(24) }}>
            <View style={row}>
              <SkeletonCircle size={58} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <SkeletonText width={140} height={16} style={mb(6)} />
                <SkeletonText width={180} height={12} style={mb(6)} />
                <SkeletonBox width={80} height={20} borderRadius={8} />
              </View>
              <SkeletonCircle size={42} />
            </View>
          </View>

          {/* Fitness Overview label */}
          <SkeletonText width={130} height={10} style={mb(12)} />

          {/* 3 rows of 2 metric cards */}
          {[...Array(3)].map((_, i) => (
            <View key={i} style={[row, gap(10), mb(10)]}>
              {[...Array(2)].map((_, j) => (
                <View key={j} style={{ flex: 1, backgroundColor: 'rgba(25,25,25,1)', borderRadius: 18, padding: 14 }}>
                  <View style={row}>
                    <SkeletonBox width={50} height={50} borderRadius={14} style={{ marginRight: 12 }} />
                    <View style={flex1}>
                      <SkeletonText width={60} height={8} style={mb(4)} />
                      <SkeletonText width={80} height={14} style={mb(4)} />
                      <SkeletonBox width={50} height={16} borderRadius={6} />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ))}

          {/* Daily Calories label */}
          <SkeletonText width={110} height={10} style={[mb(12), mt(4)]} />

          {/* Calories card */}
          <View style={{ backgroundColor: 'rgba(25,25,25,1)', borderRadius: 18, padding: 20, ...mb(24) }}>
            <View style={[row, mb(16)]}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <SkeletonText width={80} height={28} style={mb(6)} />
                <SkeletonText width={90} height={10} />
              </View>
              <View style={{ width: 1, height: 50, backgroundColor: 'rgba(255,255,255,0.06)' }} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <SkeletonText width={80} height={28} style={mb(6)} />
                <SkeletonText width={90} height={10} />
              </View>
            </View>
            <SkeletonText width={160} height={12} style={{ alignSelf: 'center' }} />
          </View>

          {/* Subscription label */}
          <SkeletonText width={100} height={10} style={mb(12)} />

          {/* Subscription card */}
          <SkeletonCard height={90} style={mb(14)} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── CALORIES SCREEN SKELETON ──────────────────────────
export function CaloriesSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: BG_DARK }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={[row, { justifyContent: 'space-between', paddingTop: 8, paddingBottom: 10 }]}>
            <View>
              <SkeletonText width={120} height={28} style={mb(6)} />
              <SkeletonText width={170} height={12} />
            </View>
            <SkeletonCircle size={42} />
          </View>

          {/* Hero: Calorie Ring */}
          <View style={{ backgroundColor: 'rgba(25,25,25,1)', borderRadius: 24, padding: 20, ...mt(4) }}>
            <View style={{ alignItems: 'center', marginTop: 4, ...mb(16) }}>
              <SkeletonCircle size={204} />
            </View>

            {/* 3 Macro bars */}
            <View style={[row, gap(8)]}>
              {[...Array(3)].map((_, i) => (
                <View key={i} style={{ flex: 1, backgroundColor: 'rgba(22,33,25,0.78)', borderRadius: 14, padding: 12 }}>
                  <SkeletonText width={44} height={8} style={mb(4)} />
                  <SkeletonText width={50} height={14} style={mb(6)} />
                  <SkeletonBox width="100%" height={3} borderRadius={2} />
                </View>
              ))}
            </View>
          </View>

          {/* Burn + Steps row */}
          <View style={[row, gap(10), mt(12)]}>
            {[...Array(2)].map((_, i) => (
              <View key={i} style={{ flex: 1, backgroundColor: 'rgba(25,25,25,1)', borderRadius: 18, padding: 16 }}>
                <View style={[row, gap(10), mb(8)]}>
                  <SkeletonBox width={36} height={36} borderRadius={10} />
                  <SkeletonText width={80} height={10} />
                </View>
                <SkeletonText width={70} height={22} style={mb(4)} />
                <SkeletonText width={60} height={10} />
              </View>
            ))}
          </View>

          {/* Weekly Analytics label */}
          <SkeletonText width={130} height={10} style={[mt(20), mb(10)]} />

          {/* Chart card */}
          <SkeletonCard height={200} style={mb(0)} />

          {/* Quick Actions label */}
          <SkeletonText width={100} height={10} style={[mt(20), mb(10)]} />

          {/* Quick action card */}
          <SkeletonCard height={70} style={mb(0)} />

          {/* Food Log label */}
          <SkeletonText width={110} height={10} style={[mt(20), mb(10)]} />

          {/* Food log grid: 2×2 */}
          <View style={[row, { flexWrap: 'wrap' }, gap(10)]}>
            {[...Array(4)].map((_, i) => (
              <View key={i} style={{ width: (SW - 50) / 2, backgroundColor: 'rgba(25,25,25,1)', borderRadius: 18, padding: 14 }}>
                <View style={[row, gap(8), mb(8)]}>
                  <SkeletonBox width={40} height={40} borderRadius={10} />
                  <View style={flex1}>
                    <SkeletonText width={70} height={12} style={mb(4)} />
                    <SkeletonText width={50} height={8} />
                  </View>
                </View>
                <SkeletonBox width="100%" height={3} borderRadius={2} />
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── WORKOUT SCREEN SKELETON ───────────────────────────
export function WorkoutSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: BG_BLACK }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={{ paddingTop: 8, ...mb(20) }}>
            <SkeletonText width={140} height={28} style={mb(6)} />
            <SkeletonText width={200} height={12} />
          </View>

          {/* 3 Workout type cards */}
          {[...Array(3)].map((_, i) => (
            <View key={i} style={{ backgroundColor: 'rgba(25,25,25,1)', borderRadius: 22, padding: 20, ...mb(14) }}>
              <View style={row}>
                <SkeletonBox width={44} height={44} borderRadius={14} style={{ marginRight: 16 }} />
                <View style={flex1}>
                  <SkeletonText width={120} height={16} style={mb(6)} />
                  <SkeletonText width={180} height={10} style={mb(6)} />
                  <SkeletonBox width={60} height={18} borderRadius={6} />
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── AI TRAINER SCREEN SKELETON ────────────────────────
export function AITrainerSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: BG_BLACK }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={[ph(20), { paddingTop: 8 }]}>
            <SkeletonText width={160} height={28} style={mb(6)} />
            <SkeletonText width={200} height={12} />
          </View>

          {/* Coach card */}
          <View style={{ marginHorizontal: 20, marginTop: 50, backgroundColor: '#121212', borderRadius: 20, padding: 20, ...mb(0) }}>
            <SkeletonBox width={140} height={28} borderRadius={12} style={mb(12)} />
            <SkeletonText width="90%" height={18} style={mb(6)} />
            <SkeletonText width="70%" height={18} style={mb(6)} />
            <SkeletonText width="80%" height={12} style={mb(16)} />
            <SkeletonBox width="100%" height={44} borderRadius={14} />
          </View>

          {/* Today's AI Plan label */}
          <View style={[ph(20), mt(28), mb(14)]}>
            <SkeletonText width={120} height={10} />
          </View>

          {/* AI Plan card */}
          <View style={{ marginHorizontal: 20, backgroundColor: '#121212', borderRadius: 20, padding: 16, ...mb(0) }}>
            <View style={row}>
              <SkeletonBox width={100} height={120} borderRadius={16} style={{ marginRight: 14 }} />
              <View style={flex1}>
                <SkeletonText width={130} height={10} style={mb(8)} />
                <SkeletonText width={150} height={16} style={mb(8)} />
                <SkeletonText width={110} height={10} style={mb(8)} />
                <SkeletonText width="90%" height={10} style={mb(4)} />
                <SkeletonText width="70%" height={10} />
              </View>
            </View>
            <View style={{ alignSelf: 'flex-end', ...mt(10) }}>
              <SkeletonBox width={120} height={36} borderRadius={12} />
            </View>
          </View>

          {/* Quick Actions label */}
          <View style={[ph(20), mt(28), mb(14)]}>
            <SkeletonText width={110} height={10} />
          </View>

          {/* 4 Quick action cards */}
          <View style={[row, ph(20), { justifyContent: 'space-between' }]}>
            {[...Array(4)].map((_, i) => (
              <View key={i} style={{ width: (SW - 52) / 4, backgroundColor: '#121212', borderRadius: 16, padding: 12, alignItems: 'center' }}>
                <SkeletonBox width={44} height={44} borderRadius={14} style={mb(8)} />
                <SkeletonText width={40} height={10} style={mb(4)} />
                <SkeletonText width={36} height={10} />
              </View>
            ))}
          </View>

          {/* AI Insights label */}
          <View style={[ph(20), mt(28), mb(14)]}>
            <SkeletonText width={90} height={10} />
          </View>

          {/* Horizontal insight cards */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ph(20)}>
            {[...Array(4)].map((_, i) => (
              <View key={i} style={{ width: 150, backgroundColor: '#121212', borderRadius: 16, padding: 14, marginRight: 12 }}>
                <View style={[row, mb(8)]}>
                  <SkeletonCircle size={8} style={{ marginRight: 6 }} />
                  <SkeletonText width={80} height={8} />
                </View>
                <SkeletonText width={70} height={18} style={mb(4)} />
                <SkeletonText width={60} height={8} style={mb(10)} />
                <SkeletonBox width="100%" height={4} borderRadius={2} />
              </View>
            ))}
          </ScrollView>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── WORKOUT LIST SCREEN SKELETON ──────────────────────
export function WorkoutListSkeleton() {
  return (
    <View style={{ flex: 1, backgroundColor: '#050505' }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {/* Header + Back */}
          <View style={[row, { paddingTop: 8, paddingBottom: 16 }]}>
            <SkeletonCircle size={40} style={{ marginRight: 12 }} />
            <View style={flex1}>
              <SkeletonText width={140} height={20} style={mb(4)} />
              <SkeletonText width={100} height={10} />
            </View>
          </View>

          {/* Tab bar */}
          <View style={[row, gap(8), mb(16)]}>
            {[...Array(3)].map((_, i) => (
              <SkeletonBox key={i} width={(SW - 56) / 3} height={40} borderRadius={12} />
            ))}
          </View>

          {/* AI Coach banner */}
          <SkeletonCard height={70} style={mb(16)} />

          {/* 5 Exercise cards */}
          {[...Array(5)].map((_, i) => (
            <View key={i} style={{ backgroundColor: 'rgba(25,25,25,1)', borderRadius: 20, padding: 18, ...mb(12) }}>
              <View style={row}>
                <SkeletonBox width={48} height={48} borderRadius={14} style={{ marginRight: 14 }} />
                <View style={flex1}>
                  <SkeletonText width={160} height={14} style={mb(6)} />
                  <SkeletonText width={100} height={10} style={mb(6)} />
                  <View style={[row, gap(8)]}>
                    <SkeletonBox width={60} height={20} borderRadius={8} />
                    <SkeletonBox width={50} height={20} borderRadius={8} />
                  </View>
                </View>
                <SkeletonBox width={38} height={38} borderRadius={12} />
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
