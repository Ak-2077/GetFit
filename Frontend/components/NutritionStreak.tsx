import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Animated, Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getMonthlyStreak, getDayStreak } from '../services/api';

const { width: SCREEN_W } = Dimensions.get('window');

const C = {
  bg: '#060D09', card: 'rgba(25,25,25,1)', cardBorder: 'rgba(29,36,31,0.18)',
  accent: '#1FA463', white: '#F0F0F0', label: 'rgba(255,255,255,0.50)',
  muted: 'rgba(255,255,255,0.30)', burn: '#FF6B6B',
};

// ── Color system based on completion ──────────────────
const BOX_EMPTY = '#1A1A1A';         // 0% — dark grey
const BOX_LOW = '#1B5E20';           // 1–49% — light green
const BOX_MID = '#388E3C';           // 50–79% — medium green
const BOX_HIGH = '#4CAF50';          // 80–100% — dark green
const BOX_EXCEEDED = '#76FF03';      // 100%+ — glowing green

function getBoxColor(score: number): string {
  if (score <= 0) return BOX_EMPTY;
  if (score < 50) return BOX_LOW;
  if (score < 80) return BOX_MID;
  if (score <= 100) return BOX_HIGH;
  return BOX_EXCEEDED;
}

function getBoxGlow(score: number): object {
  if (score > 100) {
    return {
      shadowColor: BOX_EXCEEDED,
      shadowOpacity: 0.6,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    };
  }
  return {};
}

const MOTIVATIONAL: Record<string, string> = {
  perfect: ' Perfect day! You crushed every goal!',
  great: ' Great work! Almost there!',
  good: ' Good progress! Keep pushing!',
  low: ' Every step counts. Keep going!',
  none: ' No data yet. Start logging!',
};

function getMotivation(score: number): string {
  if (score >= 100) return MOTIVATIONAL.perfect;
  if (score >= 80) return MOTIVATIONAL.great;
  if (score >= 50) return MOTIVATIONAL.good;
  if (score > 0) return MOTIVATIONAL.low;
  return MOTIVATIONAL.none;
}

const DAYS_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface StreakDay {
  date: string;
  completionScore: number;
  streakQualified: boolean;
  calories?: { consumed: number; target: number };
  protein?: { consumed: number; target: number };
  water?: { consumed: number; target: number };
  fat?: { consumed: number; target: number };
}

interface Props {
  onStreakUpdate?: () => void;
}

export default function NutritionStreak({ onStreakUpdate }: Props) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<StreakDay[]>([]);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [monthlyCompletion, setMonthlyCompletion] = useState(0);

  // Day detail modal
  const [selectedDay, setSelectedDay] = useState<StreakDay | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const modalAnim = useRef(new Animated.Value(0)).current;

  const fetchMonth = useCallback(async (m: string) => {
    try {
      setLoading(true);
      const res = await getMonthlyStreak(m);
      const data = res.data;
      setDays(data.days || []);
      setCurrentStreak(data.currentStreak || 0);
      setLongestStreak(data.longestStreak || 0);
      setMonthlyCompletion(data.monthlyCompletion || 0);
    } catch {
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMonth(month); }, [month, fetchMonth]);

  // Build calendar grid
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  // getDay() returns 0=Sun ... 6=Sat. We want Mon=0.
  const firstDayOfWeek = (new Date(year, mon - 1, 1).getDay() + 6) % 7;

  // Map days data by date for O(1) lookup
  const dayMap: Record<string, StreakDay> = {};
  for (const d of days) {
    dayMap[d.date] = d;
  }

  const grid: (StreakDay | null)[] = [];
  // Leading empty cells
  for (let i = 0; i < firstDayOfWeek; i++) grid.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${month}-${String(d).padStart(2, '0')}`;
    grid.push(dayMap[dateStr] || { date: dateStr, completionScore: 0, streakQualified: false });
  }
  // Trailing empty cells to fill last row
  while (grid.length % 7 !== 0) grid.push(null);

  const rows: (StreakDay | null)[][] = [];
  for (let i = 0; i < grid.length; i += 7) {
    rows.push(grid.slice(i, i + 7));
  }

  // Navigate months
  const prevMonth = () => {
    const d = new Date(year, mon - 2, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const nextMonth = () => {
    const d = new Date(year, mon, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  // Day tap handler
  const handleDayTap = async (day: StreakDay) => {
    setSelectedDay(day);
    setModalVisible(true);
    Animated.spring(modalAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }).start();

    // Fetch fresh detail if needed
    if (!day.calories) {
      try {
        setDayLoading(true);
        const res = await getDayStreak(day.date);
        setSelectedDay({ ...day, ...res.data });
      } catch { /* keep what we have */ }
      finally { setDayLoading(false); }
    }
  };

  const closeModal = () => {
    Animated.timing(modalAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setModalVisible(false);
      setSelectedDay(null);
    });
  };

  // Today check
  const todayStr = new Date().toISOString().slice(0, 10);
  const isCurrentMonth = month === todayStr.slice(0, 7);
  const todayDate = new Date().getDate();

  // Responsive box size
  const cardPadding = 16;
  const gap = 4;
  const boxSize = Math.floor((SCREEN_W - cardPadding * 2 - 32 - gap * 6) / 7);

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
        Monthly Nutrition Streak
      </Text>

      <View style={{
        backgroundColor: C.card, borderRadius: 20, borderWidth: 1,
        borderColor: C.cardBorder, padding: cardPadding, overflow: 'hidden',
      }}>
        {/* Month header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={20} color={C.white} />
          </TouchableOpacity>
          <Text style={{ color: C.white, fontSize: 15, fontWeight: '700' }}>
            {MONTH_NAMES[mon - 1]} {year}
          </Text>
          <TouchableOpacity onPress={nextMonth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-forward" size={20} color={C.white} />
          </TouchableOpacity>
        </View>

        {/* Day headers */}
        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
          {DAYS_HEADER.map(d => (
            <View key={d} style={{ width: boxSize, marginRight: gap, alignItems: 'center' }}>
              <Text style={{ color: C.muted, fontSize: 9, fontWeight: '600' }}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Heatmap grid */}
        {loading ? (
          <View style={{ height: 120, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={C.accent} size="small" />
          </View>
        ) : (
          rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', marginBottom: gap }}>
              {row.map((cell, ci) => {
                if (!cell) {
                  return <View key={`e-${ci}`} style={{ width: boxSize, height: boxSize, marginRight: gap }} />;
                }
                const dayNum = parseInt(cell.date.split('-')[2], 10);
                const score = cell.completionScore || 0;
                const color = getBoxColor(score);
                const glow = getBoxGlow(score);
                const isToday = isCurrentMonth && dayNum === todayDate;
                const isFuture = isCurrentMonth && dayNum > todayDate;

                return (
                  <TouchableOpacity
                    key={cell.date}
                    activeOpacity={0.7}
                    onPress={() => !isFuture && handleDayTap(cell)}
                    style={[
                      {
                        width: boxSize, height: boxSize, borderRadius: 5,
                        backgroundColor: isFuture ? '#111' : color,
                        marginRight: gap, justifyContent: 'center', alignItems: 'center',
                        borderWidth: isToday ? 1.5 : 0,
                        borderColor: isToday ? C.accent : 'transparent',
                        opacity: isFuture ? 0.3 : 1,
                      },
                      glow,
                    ]}
                  >
                    {score <= 0 && !isFuture ? (
                      <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10, fontWeight: '700' }}>✕</Text>
                    ) : (
                      <Text style={{ color: score > 80 ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 8, fontWeight: '600' }}>
                        {dayNum}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}

        {/* Stats row */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#FF9800', fontSize: 18, fontWeight: '800' }}> {currentStreak}</Text>
            <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>Current</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: C.accent, fontSize: 18, fontWeight: '800' }}> {longestStreak}</Text>
            <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>Longest</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#42A5F5', fontSize: 18, fontWeight: '800' }}>{monthlyCompletion}%</Text>
            <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>Monthly</Text>
          </View>
        </View>

        {/* Color legend */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 10 }}>
          {[
            { c: BOX_EMPTY, l: '0%' }, { c: BOX_LOW, l: '<50%' },
            { c: BOX_MID, l: '50-79%' }, { c: BOX_HIGH, l: '80-100%' },
            { c: BOX_EXCEEDED, l: '100%+' },
          ].map(i => (
            <View key={i.l} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: i.c }} />
              <Text style={{ color: C.muted, fontSize: 7 }}>{i.l}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ═══ DAY DETAIL MODAL ═══ */}
      <Modal visible={modalVisible} transparent animationType="none" onRequestClose={closeModal}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={closeModal}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
        >
          <Animated.View
            style={{
              width: '100%', maxWidth: 340,
              backgroundColor: '#1A1A1A', borderRadius: 22, borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)', padding: 20,
              transform: [{ scale: modalAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
              opacity: modalAnim,
            }}
          >
            <TouchableOpacity activeOpacity={1}>
              {selectedDay && (
                <>
                  {/* Header */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <View>
                      <Text style={{ color: C.white, fontSize: 16, fontWeight: '800' }}>
                        {new Date(selectedDay.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}
                      </Text>
                      <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                        {new Date(selectedDay.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>
                    <View style={{
                      width: 44, height: 44, borderRadius: 22,
                      backgroundColor: getBoxColor(selectedDay.completionScore || 0),
                      justifyContent: 'center', alignItems: 'center',
                      ...getBoxGlow(selectedDay.completionScore || 0),
                    }}>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>
                        {selectedDay.completionScore || 0}%
                      </Text>
                    </View>
                  </View>

                  {dayLoading ? (
                    <ActivityIndicator color={C.accent} style={{ marginVertical: 20 }} />
                  ) : (
                    <>
                      {/* Breakdown */}
                      {[
                        { label: 'Calories', consumed: selectedDay.calories?.consumed || 0, target: selectedDay.calories?.target || 0, unit: 'kcal', color: '#4CAF50' },
                        { label: 'Protein', consumed: selectedDay.protein?.consumed || 0, target: selectedDay.protein?.target || 0, unit: 'g', color: '#FF9800' },
                        { label: 'Water', consumed: selectedDay.water?.consumed || 0, target: selectedDay.water?.target || 0, unit: 'L', color: '#42A5F5' },
                        { label: 'Fat', consumed: selectedDay.fat?.consumed || 0, target: selectedDay.fat?.target || 0, unit: 'g', color: '#FFB088' },
                      ].map(item => {
                        const pct = item.target > 0 ? Math.min((item.consumed / item.target) * 100, 100) : 0;
                        return (
                          <View key={item.label} style={{ marginBottom: 12 }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                              <Text style={{ color: C.white, fontSize: 12, fontWeight: '600' }}>{item.label}</Text>
                              <Text style={{ color: C.label, fontSize: 11 }}>
                                {item.label === 'Water'
                                  ? `${item.consumed.toFixed(1)} / ${item.target}${item.unit}`
                                  : `${Math.round(item.consumed)} / ${Math.round(item.target)} ${item.unit}`}
                              </Text>
                            </View>
                            <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                              <View style={{
                                height: 4, borderRadius: 2, backgroundColor: item.color,
                                width: `${pct}%` as any,
                              }} />
                            </View>
                          </View>
                        );
                      })}

                      {/* Streak status */}
                      <View style={{
                        backgroundColor: selectedDay.streakQualified ? 'rgba(31,164,99,0.1)' : 'rgba(255,107,107,0.08)',
                        borderRadius: 12, padding: 12, marginTop: 4,
                      }}>
                        <Text style={{
                          color: selectedDay.streakQualified ? C.accent : C.burn,
                          fontSize: 11, fontWeight: '700', textAlign: 'center',
                        }}>
                          {selectedDay.streakQualified ? '✓ Streak Qualified' : '✕ Not Qualified'}
                        </Text>
                      </View>

                      {/* Motivation */}
                      <Text style={{ color: C.label, fontSize: 11, textAlign: 'center', marginTop: 10 }}>
                        {getMotivation(selectedDay.completionScore || 0)}
                      </Text>
                    </>
                  )}
                </>
              )}
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
