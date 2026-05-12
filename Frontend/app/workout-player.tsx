import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Animated, Easing, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import GLBViewer from '../components/GLBViewer';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Design tokens ──
const C = {
  bg: '#060D09',
  card: '#0F1A13',
  cardBorder: 'rgba(31,164,99,0.12)',
  accent: '#1FA463',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.50)',
  muted: 'rgba(255,255,255,0.30)',
  danger: '#EF4444',
};

/**
 * ── GLB Model → require() mapping ──
 *
 * HOW IT WORKS:
 * When you click "Start" on a workout, the key is auto-generated as:
 *   `{workoutType}_{workout_name_in_snake_case}`
 *
 * Examples of auto-generated keys:
 *   Workout: "Push-ups"     type: "home"  →  key: "home_push_ups"
 *   Workout: "Bench Press"  type: "gym"   →  key: "gym_bench_press"
 *   Workout: "Sit-ups"      type: "home"  →  key: "home_sit_ups"
 *   Workout: "Deadlift"     type: "gym"   →  key: "gym_deadlift"
 *
 * TO ADD A NEW ANIMATION:
 *   1. Export your GLB from Blender (Principled BSDF materials only)
 *   2. Drop the .glb file in: assets/models/{category}/{name}.glb
 *   3. Add one line below:  'key': require('../assets/models/path/file.glb'),
 *   4. Done! The workout will auto-play the animation when started.
 *
 * NOTE: If a workout navigates with `bodyPart` param (e.g. "core"),
 * the key becomes `{type}_{bodyPart}` instead (e.g. "home_core").
 */
const MODEL_MAP: Record<string, number> = {
  // ═══════════════════════════════════════════
  // HOME WORKOUTS (type: "home")
  // ═══════════════════════════════════════════

  // ── Body Part shortcuts (used by home-workout flow) ──
  'home_core': require('../assets/models/HomeWorkout/body-parts/abs/situps.glb'),
  'home_abs': require('../assets/models/HomeWorkout/body-parts/abs/situps.glb'),
  'home_legs': require('../assets/models/HomeWorkout/body-parts/legs/situps.glb'),

  // ── Individual exercises ──
  'home_sit_ups': require('../assets/models/HomeWorkout/body-parts/abs/situps.glb'),
  // 'home_push_ups':             require('../assets/models/home/push_ups.glb'),
  // 'home_bodyweight_squats':    require('../assets/models/home/squats.glb'),
  // 'home_lunges':               require('../assets/models/home/lunges.glb'),
  // 'home_plank':                require('../assets/models/home/plank.glb'),
  // 'home_incline_push_ups':     require('../assets/models/home/incline_push_ups.glb'),
  // 'home_burpees':              require('../assets/models/home/burpees.glb'),
  // 'home_mountain_climbers':    require('../assets/models/home/mountain_climbers.glb'),
  // 'home_jumping_jacks':        require('../assets/models/home/jumping_jacks.glb'),
  // 'home_pull_ups':             require('../assets/models/home/pull_ups.glb'),
  // 'home_dips':                 require('../assets/models/home/dips.glb'),
  // 'home_decline_push_ups':     require('../assets/models/home/decline_push_ups.glb'),
  // 'home_pistol_squats':        require('../assets/models/home/pistol_squats.glb'),
  // 'home_handstand_push_ups':   require('../assets/models/home/handstand_push_ups.glb'),
  // 'home_muscle_ups':           require('../assets/models/home/muscle_ups.glb'),

  // ═══════════════════════════════════════════
  // GYM WORKOUTS (type: "gym")
  // ═══════════════════════════════════════════
  // 'gym_bench_press':           require('../assets/models/gym/bench_press.glb'),
  // 'gym_deadlift':              require('../assets/models/gym/deadlift.glb'),
  // 'gym_barbell_rows':          require('../assets/models/gym/barbell_rows.glb'),
  // 'gym_overhead_press':        require('../assets/models/gym/overhead_press.glb'),
  // 'gym_lat_pulldown':          require('../assets/models/gym/lat_pulldown.glb'),
  // 'gym_cable_flyes':           require('../assets/models/gym/cable_flyes.glb'),
  // 'gym_leg_press':             require('../assets/models/gym/leg_press.glb'),
  // 'gym_barbell_curls':         require('../assets/models/gym/barbell_curls.glb'),
  // 'gym_hack_squat':            require('../assets/models/gym/hack_squat.glb'),
  // 'gym_front_squats':          require('../assets/models/gym/front_squats.glb'),
};

/**
 * Generate a model key from workout data.
 * Convention: `{type}_{name_in_snake_case}`
 */
function getModelKey(workoutType: string, workoutName: string): string {
  const slug = workoutName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `${workoutType}_${slug}`;
}

// ── Timer display component ──
function TimerDisplay({ seconds }: { seconds: number }) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return (
    <Text style={{ fontSize: 48, fontWeight: '800', color: C.white, fontVariant: ['tabular-nums'] }}>
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
    </Text>
  );
}

export default function WorkoutPlayerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    workoutName?: string;
    workoutType?: string;
    workoutDuration?: string;
    workoutDifficulty?: string;
    workoutId?: string;
  }>();

  const workoutName = params.workoutName || 'Workout';
  const workoutType = params.workoutType || 'home';
  const workoutDuration = params.workoutDuration || '15 min';
  const workoutDifficulty = params.workoutDifficulty || 'medium';
  const selectedBodyPart = (params as any).bodyPart || '';

  const [isPlaying, setIsPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [modelError, setModelError] = useState('');

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pulse animation for the timer
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  // ── Timer ──
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Toggle play/pause ──
  const togglePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  // ── End workout ──
  const endWorkout = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    router.back();
  }, [router]);

  // ── Difficulty colors ──
  const diffColors: Record<string, { bg: string; text: string }> = {
    easy: { bg: 'rgba(34,197,94,0.12)', text: '#22C55E' },
    medium: { bg: 'rgba(251,191,36,0.12)', text: '#FBBF24' },
    hard: { bg: 'rgba(239,68,68,0.12)', text: '#EF4444' },
  };
  const diff = diffColors[workoutDifficulty] || diffColors.medium;

  // Prefer a bodyPart-specific model key when provided (e.g. 'home_core')
  const modelKey = selectedBodyPart ? `${workoutType}_${String(selectedBodyPart).toLowerCase()}` : getModelKey(workoutType, workoutName);
  const modelModule = MODEL_MAP[modelKey];
  const hasModel = !!modelModule;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* ═══ HEADER ═══ */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 12,
          }}
        >
          <TouchableOpacity
            onPress={endWorkout}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: C.card,
              borderWidth: 1,
              borderColor: C.cardBorder,
              justifyContent: 'center',
              alignItems: 'center',
              marginRight: 14,
            }}
          >
            <Ionicons name="chevron-back" size={20} color={C.white} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: C.white }} numberOfLines={1}>
              {workoutName}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="time-outline" size={12} color={C.label} />
                <Text style={{ fontSize: 11, color: C.label, marginLeft: 4 }}>{workoutDuration}</Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 6,
                  backgroundColor: diff.bg,
                }}
              >
                <Text style={{ fontSize: 9, fontWeight: '800', color: diff.text, textTransform: 'uppercase' }}>
                  {workoutDifficulty}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* ═══ 3D MODEL VIEWPORT ═══ */}
        <View
          style={{
            flex: 1,
            marginHorizontal: 20,
            borderRadius: 24,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: C.cardBorder,
            backgroundColor: C.card,
          }}
        >
          {hasModel ? (
            <GLBViewer
              modelModule={modelModule}
              isPlaying={isPlaying}
              onError={(msg) => setModelError(msg)}
              onDebugInfo={(info) => {
                console.log('[WorkoutPlayer] Model debug:', info);
              }}
            />
          ) : (
            // ── Placeholder when no GLB file is mapped ──
            <View
              style={{
                flex: 1,
                justifyContent: 'center',
                alignItems: 'center',
                paddingHorizontal: 30,
              }}
            >
              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: 'rgba(31,164,99,0.08)',
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: 20,
                }}
              >
                <Ionicons name="cube-outline" size={36} color={C.accent} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: C.white, textAlign: 'center', marginBottom: 8 }}>
                3D Animation
              </Text>
              <Text style={{ fontSize: 13, color: C.label, textAlign: 'center', lineHeight: 20 }}>
                No GLB model mapped for this exercise yet.{'\n'}
                Add the .glb file to the MODEL_MAP in{'\n'}
                <Text style={{ color: C.accent, fontWeight: '600' }}>workout-player.tsx</Text>
              </Text>
              <Text style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 12 }}>
                Model key: {modelKey}
              </Text>
            </View>
          )}

          {modelError ? (
            <View
              style={{
                position: 'absolute',
                bottom: 20,
                left: 20,
                right: 20,
                padding: 12,
                borderRadius: 12,
                backgroundColor: 'rgba(239,68,68,0.12)',
                borderWidth: 1,
                borderColor: 'rgba(239,68,68,0.2)',
              }}
            >
              <Text style={{ fontSize: 12, color: C.danger, textAlign: 'center' }}>{modelError}</Text>
            </View>
          ) : null}
        </View>

        {/* ═══ TIMER + CONTROLS ═══ */}
        <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 }}>
          {/* Timer */}
          <Animated.View
            style={{
              alignItems: 'center',
              marginBottom: 20,
              transform: [{ scale: pulseAnim }],
            }}
          >
            <Text style={{ fontSize: 11, color: C.label, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
              Elapsed Time
            </Text>
            <TimerDisplay seconds={elapsed} />
          </Animated.View>

          {/* Control buttons */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {/* Play / Pause */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={togglePlayPause}
              style={{ flex: 1, borderRadius: 16, overflow: 'hidden' }}
            >
              <LinearGradient
                colors={isPlaying ? ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.04)'] : [C.accent, '#178A52']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  height: 54,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: isPlaying ? 'rgba(255,255,255,0.1)' : 'transparent',
                  flexDirection: 'row',
                  gap: 8,
                }}
              >
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={20}
                  color={isPlaying ? C.white : '#fff'}
                />
                <Text style={{ fontSize: 15, fontWeight: '700', color: isPlaying ? C.white : '#fff' }}>
                  {isPlaying ? 'Pause' : 'Resume'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* End Workout */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={endWorkout}
              style={{ flex: 1, borderRadius: 16, overflow: 'hidden' }}
            >
              <LinearGradient
                colors={['rgba(239,68,68,0.15)', 'rgba(239,68,68,0.08)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  height: 54,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: 'rgba(239,68,68,0.25)',
                  flexDirection: 'row',
                  gap: 8,
                }}
              >
                <Ionicons name="stop-circle-outline" size={20} color={C.danger} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: C.danger }}>
                  End Workout
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
