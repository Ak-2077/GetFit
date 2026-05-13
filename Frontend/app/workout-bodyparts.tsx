import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, Image,
  Animated, Easing, Platform, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Svg, { Line } from 'react-native-svg';

/* ── Design tokens ── */
const C = {
  bg: '#050505',
  white: '#F0F0F0',
  sub: 'rgba(255,255,255,0.50)',
  pillText: 'rgba(255,255,255,0.72)',
  pillTextAct: '#ffffff',
  pillBg: 'rgba(255,255,255,0.05)',
  pillBgAct: 'rgba(255,255,255,0.13)',
  pillBdr: 'rgba(255,255,255,0.08)',
  pillBdrAct: 'rgba(255,255,255,0.35)',
  lineDim: 'rgba(255,255,255,0.10)',
  lineAct: 'rgba(255,255,255,0.45)',
  dotDim: 'rgba(255,255,255,0.30)',
  dotAct: '#ffffff',
  glowDim: 'rgba(255,255,255,0.07)',
  glowAct: 'rgba(255,255,255,0.18)',
  hint: 'rgba(255,255,255,0.35)',
};

const IMG_ASPECT = 1.95;

/* ── Muscle spots ── */
type Spot = { id: string; label: string; apiKey: string; x: number; y: number; side: 'L' | 'R' };

const FRONT: Spot[] = [
  { id: 'shoulders', label: 'Shoulders', apiKey: 'shoulders', x: 24, y: 16, side: 'L' },
  { id: 'chest',     label: 'Chest',     apiKey: 'chest',     x: 50, y: 22, side: 'R' },
  { id: 'biceps',    label: 'Biceps',    apiKey: 'arms',      x: 21, y: 27, side: 'L' },
  { id: 'triceps',   label: 'Triceps',   apiKey: 'arms',      x: 79, y: 27, side: 'R' },
  { id: 'abs',       label: 'Abs',       apiKey: 'abs',       x: 50, y: 33, side: 'R' },
  { id: 'forearms',  label: 'Forearms',  apiKey: 'arms',      x: 17, y: 37, side: 'L' },
  { id: 'obliques',  label: 'Obliques',  apiKey: 'abs',       x: 38, y: 38, side: 'L' },
  { id: 'quads',     label: 'Quads',     apiKey: 'legs',      x: 40, y: 54, side: 'L' },
  { id: 'adductors', label: 'Adductors', apiKey: 'legs',      x: 50, y: 50, side: 'R' },
  { id: 'calves_f',  label: 'Calves',    apiKey: 'legs',      x: 58, y: 74, side: 'R' },
];

const BACK: Spot[] = [
  { id: 'traps',      label: 'Traps',      apiKey: 'shoulders', x: 42, y: 13, side: 'L' },
  { id: 'upper_back', label: 'Upper Back', apiKey: 'back',      x: 50, y: 21, side: 'R' },
  { id: 'triceps_b',  label: 'Triceps',    apiKey: 'arms',      x: 78, y: 27, side: 'R' },
  { id: 'lower_back', label: 'Lower Back', apiKey: 'back',      x: 50, y: 35, side: 'R' },
  { id: 'glutes',     label: 'Glutes',     apiKey: 'legs',      x: 50, y: 44, side: 'L' },
  { id: 'hamstrings', label: 'Hamstrings', apiKey: 'legs',      x: 42, y: 58, side: 'L' },
  { id: 'calves_b',   label: 'Calves',     apiKey: 'legs',      x: 58, y: 74, side: 'R' },
];

/* ── Pulsing dot component ── */
function PulseDot({ active }: { active: boolean }) {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const inner = active ? 11 : 7;
  const outer = inner + 14;

  return (
    <Animated.View style={{
      width: outer, height: outer, borderRadius: outer / 2,
      backgroundColor: active ? C.glowAct : C.glowDim,
      justifyContent: 'center', alignItems: 'center',
      opacity: active ? 1 : anim,
    }}>
      <View style={{
        width: inner, height: inner, borderRadius: inner / 2,
        backgroundColor: active ? C.dotAct : C.dotDim,
        ...(active && {
          shadowColor: '#fff', shadowRadius: 10,
          shadowOpacity: 0.8, shadowOffset: { width: 0, height: 0 },
          elevation: 6,
        }),
      }} />
    </Animated.View>
  );
}

/* ── Render data type ── */
type RenderItem = {
  spot: Spot; labelY: number;
  dotX: number; dotY: number;
  lx1: number; ly1: number; lx2: number; ly2: number;
};

/* ═══ Main screen ═══ */
export default function WorkoutBodyParts() {
  const router = useRouter();
  const { workoutType = 'home', userPlan = 'free' } = useLocalSearchParams();
  const { width: sw } = useWindowDimensions();
  const [view, setView] = useState<'front' | 'back'>('front');
  const [activeId, setActiveId] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const [areaH, setAreaH] = useState(0);

  const spots = view === 'front' ? FRONT : BACK;
  const bodyImg = view === 'front'
    ? require('../assets/images/FrontPart.png')
    : require('../assets/images/BackPart.png');

  /* ── All layout dimensions derived from screen width + measured height ── */
  const L = useMemo(() => {
    const pad = Math.round(sw * 0.02);
    const inner = sw - pad * 2;
    const labelW = Math.round(inner * 0.215);
    const gap = Math.round(inner * 0.015);
    const slotW = inner - (labelW + gap) * 2;
    const fs = Math.max(9, Math.min(13, Math.round(sw * 0.028)));
    const pillH = Math.round(fs * 2.7);

    let imgW = slotW;
    let imgH = imgW * IMG_ASPECT;
    if (areaH > 0 && imgH > areaH) {
      imgH = areaH;
      imgW = Math.round(imgH / IMG_ASPECT);
    }

    const imgX = pad + labelW + gap + Math.round((slotW - imgW) / 2);
    const rLblX = imgX + imgW + gap;

    return { pad, labelW, gap, fs, pillH, imgW, imgH, imgX, rLblX };
  }, [sw, areaH]);

  /* ── Split by side ── */
  const leftSpots = useMemo(() => spots.filter((s: Spot) => s.side === 'L'), [spots]);
  const rightSpots = useMemo(() => spots.filter((s: Spot) => s.side === 'R'), [spots]);

  /* ── Even vertical distribution (no overlap) ── */
  const spread = useCallback((n: number): number[] => {
    if (n === 0) return [];
    if (n === 1) return [Math.round((L.imgH - L.pillH) / 2)];
    const range = L.imgH - L.pillH;
    const step = range / (n - 1);
    return Array.from({ length: n }, (_, i) => Math.round(i * step));
  }, [L.imgH, L.pillH]);

  const leftYs = useMemo(() => spread(leftSpots.length), [spread, leftSpots.length]);
  const rightYs = useMemo(() => spread(rightSpots.length), [spread, rightSpots.length]);

  /* ── Pre-compute render data for all spots ── */
  const buildItems = useCallback(
    (sideSpots: Spot[], ys: number[], side: 'L' | 'R'): RenderItem[] =>
      sideSpots.map((spot, i) => {
        const dotX = L.imgX + (spot.x / 100) * L.imgW;
        const dotY = (spot.y / 100) * L.imgH;
        const lcy = ys[i] + L.pillH / 2;
        return {
          spot, labelY: ys[i], dotX, dotY,
          lx1: side === 'L' ? L.pad + L.labelW : dotX,
          ly1: side === 'L' ? lcy : dotY,
          lx2: side === 'L' ? dotX : L.rLblX,
          ly2: side === 'L' ? dotY : lcy,
        };
      }),
    [L],
  );

  const leftItems = useMemo(() => buildItems(leftSpots, leftYs, 'L'), [buildItems, leftSpots, leftYs]);
  const rightItems = useMemo(() => buildItems(rightSpots, rightYs, 'R'), [buildItems, rightSpots, rightYs]);
  const allItems = useMemo(() => [...leftItems, ...rightItems], [leftItems, rightItems]);

  /* ── Handlers ── */
  const toggleView = useCallback(() => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setView(v => (v === 'front' ? 'back' : 'front'));
      setActiveId(null);
      Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  }, [fadeAnim]);

  const handlePress = useCallback((spot: Spot) => {
    setActiveId(spot.id);
    setTimeout(() => {
      router.push(`/workout-list?workoutType=${workoutType}&bodyPart=${spot.apiKey}&userPlan=${userPlan}` as any);
    }, 250);
  }, [workoutType, userPlan, router]);

  /* ── Render a label pill ── */
  const renderLabel = (d: RenderItem, side: 'L' | 'R') => {
    const act = activeId === d.spot.id;
    return (
      <TouchableOpacity
        key={`lbl-${d.spot.id}`}
        activeOpacity={0.7}
        onPress={() => handlePress(d.spot)}
        style={{
          position: 'absolute',
          top: d.labelY,
          left: side === 'L' ? L.pad : L.rLblX,
          width: L.labelW,
          height: L.pillH,
          justifyContent: 'center',
          alignItems: side === 'L' ? 'flex-end' : 'flex-start',
          zIndex: 30,
        }}
      >
        <View style={{
          paddingHorizontal: Math.round(L.fs * 0.65),
          paddingVertical: Math.round(L.fs * 0.28),
          borderRadius: 8,
          backgroundColor: act ? C.pillBgAct : C.pillBg,
          borderWidth: 1,
          borderColor: act ? C.pillBdrAct : C.pillBdr,
        }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: L.fs, fontWeight: '700', letterSpacing: 0.3,
              color: act ? C.pillTextAct : C.pillText,
            }}
          >
            {d.spot.label}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ═══ HEADER ═══ */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 2 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ marginRight: 14 }}
          >
            <Ionicons name="arrow-back" size={22} color={C.white} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 19, fontWeight: '800', color: C.white, letterSpacing: -0.3 }}>
              Choose Body Part
            </Text>
            <Text style={{ fontSize: 11, color: C.sub, marginTop: 1 }}>
              Tap a muscle to explore exercises
            </Text>
          </View>
        </View>

        {/* ═══ TOGGLE ═══ */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10, marginBottom: 6 }}>
          <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 22, padding: 3 }}>
            {(['front', 'back'] as const).map(v => {
              const sel = view === v;
              return (
                <TouchableOpacity
                  key={v}
                  onPress={() => { if (!sel) toggleView(); }}
                  activeOpacity={0.8}
                  style={{
                    paddingHorizontal: 22, paddingVertical: 7, borderRadius: 18,
                    backgroundColor: sel ? '#fff' : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: sel ? '#000' : C.sub, letterSpacing: 0.2 }}>
                    {v === 'front' ? 'Front Body' : 'Back Body'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ═══ BODY MAP ═══ */}
        <Animated.View
          style={{ flex: 1, opacity: fadeAnim, justifyContent: 'center' }}
          onLayout={e => setAreaH(e.nativeEvent.layout.height)}
        >
          {areaH > 0 && (
            <View style={{ width: sw, height: L.imgH, alignSelf: 'center' }}>
              {/* Layer 1: Body image */}
              <Image
                source={bodyImg}
                style={{ position: 'absolute', left: L.imgX, top: 0, width: L.imgW, height: L.imgH }}
                resizeMode="contain"
              />

              {/* Layer 2: SVG connector lines (single overlay) */}
              <Svg
                width={sw}
                height={L.imgH}
                style={{ position: 'absolute', top: 0, left: 0 }}
                pointerEvents="none"
              >
                {allItems.map(d => (
                  <Line
                    key={`ln-${d.spot.id}`}
                    x1={d.lx1} y1={d.ly1}
                    x2={d.lx2} y2={d.ly2}
                    stroke={activeId === d.spot.id ? C.lineAct : C.lineDim}
                    strokeWidth={activeId === d.spot.id ? 1.2 : 0.6}
                  />
                ))}
              </Svg>

              {/* Layer 3: Touchable dots */}
              {allItems.map(d => {
                const act = activeId === d.spot.id;
                const hit = 34;
                return (
                  <TouchableOpacity
                    key={`dot-${d.spot.id}`}
                    activeOpacity={0.7}
                    onPress={() => handlePress(d.spot)}
                    style={{
                      position: 'absolute',
                      left: d.dotX - hit / 2,
                      top: d.dotY - hit / 2,
                      width: hit, height: hit,
                      justifyContent: 'center', alignItems: 'center',
                      zIndex: 20,
                    }}
                  >
                    <PulseDot active={act} />
                  </TouchableOpacity>
                );
              })}

              {/* Layer 4: Label pills */}
              {leftItems.map(d => renderLabel(d, 'L'))}
              {rightItems.map(d => renderLabel(d, 'R'))}
            </View>
          )}
        </Animated.View>

        {/* ═══ BOTTOM HINT ═══ */}
        <View style={{ paddingHorizontal: 20, paddingBottom: Platform.OS === 'ios' ? 4 : 12 }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            paddingVertical: 8, borderRadius: 12,
            backgroundColor: 'rgba(255,255,255,0.03)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
          }}>
            <Ionicons name="finger-print-outline" size={13} color={C.hint} />
            <Text style={{ fontSize: 10, color: C.hint, marginLeft: 6 }}>
              Tap any muscle point to view exercises
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
