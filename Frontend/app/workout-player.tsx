import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Animated, Easing, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import { Asset } from 'expo-asset';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LinearGradient } from 'expo-linear-gradient';
import GFLoader from '../components/GFLoader';

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
 * Add your GLB files here. Each key should match the workout's modelId
 * from the backend, or use a naming convention like `{type}_{name_slug}`.
 * 
 * Example:
 *   'home_push_ups': require('../assets/models/workouts/push_ups.glb'),
 *   'gym_bench_press': require('../assets/models/workouts/bench_press.glb'),
 *   'gym_deadlift': require('../assets/models/workouts/deadlift.glb'),
 */
const MODEL_MAP: Record<string, number> = {
  // ── Add your GLB files below ──
  // 'home_push_ups': require('../assets/models/workouts/push_ups.glb'),
  // 'gym_bench_press': require('../assets/models/workouts/bench_press.glb'),
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

  const [modelLoading, setModelLoading] = useState(true);
  const [modelError, setModelError] = useState('');
  const [isPlaying, setIsPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  const frameRef = useRef<number | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionRef = useRef<THREE.AnimationAction | null>(null);
  const clockRef = useRef<THREE.Clock | null>(null);
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
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Toggle play/pause ──
  const togglePlayPause = useCallback(() => {
    if (actionRef.current) {
      if (isPlaying) {
        actionRef.current.paused = true;
      } else {
        actionRef.current.paused = false;
      }
    }
    setIsPlaying((prev) => !prev);
  }, [isPlaying]);

  // ── End workout ──
  const endWorkout = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (actionRef.current) actionRef.current.stop();
    router.back();
  }, [router]);

  // ── GLView context creation (loads GLB + starts animation) ──
  const onContextCreate = async (gl: any) => {
    try {
      setModelLoading(true);
      setModelError('');

      const modelKey = getModelKey(workoutType, workoutName);
      const modelModule = MODEL_MAP[modelKey];

      if (!modelModule) {
        setModelError(`No 3D model found for "${workoutName}". Add the GLB file to MODEL_MAP in workout-player.tsx.`);
        setModelLoading(false);
        return;
      }

      // ── Scene setup ──
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x060d09);

      const camera = new THREE.PerspectiveCamera(
        60,
        gl.drawingBufferWidth / gl.drawingBufferHeight,
        0.1,
        1000
      );
      camera.position.set(0, 1.4, 3);

      const renderer = new Renderer({ gl });
      renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);

      // ── Lighting ──
      const ambient = new THREE.AmbientLight(0xffffff, 1.2);
      scene.add(ambient);
      const directional = new THREE.DirectionalLight(0xffffff, 1.1);
      directional.position.set(2, 5, 3);
      scene.add(directional);
      const fill = new THREE.DirectionalLight(0x1fa463, 0.4);
      fill.position.set(-3, 2, -2);
      scene.add(fill);

      // ── Load GLB ──
      const asset = Asset.fromModule(modelModule);
      await asset.downloadAsync();
      const uri = asset.localUri || asset.uri;
      if (!uri) {
        setModelError('Unable to load model file from local assets.');
        setModelLoading(false);
        return;
      }

      const response = await fetch(uri);
      const arrayBuffer = await response.arrayBuffer();

      const loader = new GLTFLoader();
      const gltf: any = await new Promise((resolve, reject) => {
        loader.parse(arrayBuffer, '', resolve, reject);
      });

      const model = gltf.scene;
      model.position.set(0, -1.15, 0);
      model.scale.set(1.2, 1.2, 1.2);
      scene.add(model);

      // ── Animation ──
      const mixer = gltf.animations?.length ? new THREE.AnimationMixer(model) : null;
      mixerRef.current = mixer;

      if (mixer && gltf.animations[0]) {
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
        actionRef.current = action;
      }

      const clock = new THREE.Clock();
      clockRef.current = clock;

      setModelLoading(false);

      // ── Render loop ──
      const render = () => {
        const delta = clock.getDelta();
        if (mixer) mixer.update(delta);
        model.rotation.y += 0.003;
        renderer.render(scene, camera);
        gl.endFrameEXP();
        frameRef.current = requestAnimationFrame(render);
      };

      render();
    } catch (err: any) {
      setModelError(err?.message || 'Failed to load 3D model');
      setModelLoading(false);
    }
  };

  // ── Difficulty colors ──
  const diffColors: Record<string, { bg: string; text: string }> = {
    easy: { bg: 'rgba(34,197,94,0.12)', text: '#22C55E' },
    medium: { bg: 'rgba(251,191,36,0.12)', text: '#FBBF24' },
    hard: { bg: 'rgba(239,68,68,0.12)', text: '#EF4444' },
  };
  const diff = diffColors[workoutDifficulty] || diffColors.medium;

  const modelKey = getModelKey(workoutType, workoutName);
  const hasModel = !!MODEL_MAP[modelKey];

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
            <>
              <GLView
                style={{ flex: 1 }}
                onContextCreate={onContextCreate}
              />
              {modelLoading && (
                <View
                  style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: 'rgba(6,13,9,0.9)',
                  }}
                >
                  <GFLoader fullScreen={false} size={44} message="Loading animation..." />
                </View>
              )}
            </>
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
