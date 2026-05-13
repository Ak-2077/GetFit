import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import { Asset } from 'expo-asset';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getWorkoutModel } from '../services/api';


type WorkoutModelResponse = {
	mode: string;
	bodyPart: string;
	modelId: string;
	title?: string;
};

const LOCAL_MODEL_MAP: Record<string, number> = {
	home_legs_situps: require('../assets/models/HomeWorkout/body-parts/legs/situps.glb'),
	home_abs_situps: require('../assets/models/HomeWorkout/body-parts/abs/situps.glb'),
	home_core_situps: require('../assets/models/HomeWorkout/body-parts/abs/situps.glb'),
};

export default function HomeWorkoutPlayerScreen() {
	const router = useRouter();
	const params = useLocalSearchParams<{ mode?: string; bodyPart?: string }>();

	const mode = useMemo(() => (typeof params.mode === 'string' ? params.mode : 'home'), [params.mode]);
	const bodyPart = useMemo(() => (typeof params.bodyPart === 'string' ? params.bodyPart : 'legs'), [params.bodyPart]);

	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [modelConfig, setModelConfig] = useState<WorkoutModelResponse | null>(null);
	const frameRef = useRef<number | null>(null);

	useEffect(() => {
		const fetchModelConfig = async () => {
			try {
				setLoading(true);
				setError('');

				const res = await getWorkoutModel(mode, bodyPart);
				setModelConfig(res.data);
			} catch (err: any) {
				const msg = err?.response?.data?.message || 'No model configured for this body part yet.';
				setError(msg);
			} finally {
				setLoading(false);
			}
		};

		fetchModelConfig();

		return () => {
			if (frameRef.current) {
				cancelAnimationFrame(frameRef.current);
			}
		};
	}, [mode, bodyPart]);

	const onContextCreate = async (gl: any) => {
		if (!modelConfig?.modelId) return;

		const modelModule = LOCAL_MODEL_MAP[modelConfig.modelId];
		if (!modelModule) {
			setError(`Model asset is not mapped for ${modelConfig.modelId}`);
			return;
		}

		const scene = new THREE.Scene();
		scene.background = new THREE.Color(0x0a0a0a);

		const camera = new THREE.PerspectiveCamera(60, gl.drawingBufferWidth / gl.drawingBufferHeight, 0.1, 1000);
		camera.position.set(0, 1.4, 3);

		const renderer = new Renderer({ gl });
		renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight);

		const ambient = new THREE.AmbientLight(0xffffff, 1.2);
		scene.add(ambient);
		const directional = new THREE.DirectionalLight(0xffffff, 1.1);
		directional.position.set(2, 5, 3);
		scene.add(directional);

		const asset = Asset.fromModule(modelModule);
		await asset.downloadAsync();
		const uri = asset.localUri || asset.uri;
		if (!uri) {
			setError('Unable to load model file from local assets.');
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

		const mixer = gltf.animations?.length ? new THREE.AnimationMixer(model) : null;
		if (mixer && gltf.animations[0]) {
			const action = mixer.clipAction(gltf.animations[0]);
			action.play();
		}

		const clock = new THREE.Clock();
		const render = () => {
			const delta = clock.getDelta();
			if (mixer) mixer.update(delta);

			model.rotation.y += 0.005;
			renderer.render(scene, camera);
			gl.endFrameEXP();
			frameRef.current = requestAnimationFrame(render);
		};

		render();
	};

	return (
		<SafeAreaView className="flex-1 bg-[#0A0A0A]">
			<View className="flex-row items-center px-4 py-4">
				<TouchableOpacity onPress={() => router.back()} className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-[#1F2937]">
					<Ionicons name="chevron-back" size={22} color="#fff" />
				</TouchableOpacity>
				<View>
					<Text className="text-xl font-bold text-white">{modelConfig?.title || 'Workout Animation'}</Text>
					<Text className="text-sm text-gray-400">{mode} • {bodyPart}</Text>
				</View>
			</View>

			{loading ? (
				<View className="flex-1 items-center justify-center">
					<ActivityIndicator size="large" color="#1FA463" />
				</View>
			) : error ? (
				<View className="flex-1 items-center justify-center px-6">
					<Text className="text-center text-base text-red-400">{error}</Text>
				</View>
			) : (
				<View className="flex-1 px-4 pb-6">
					<View className="flex-1 overflow-hidden rounded-2xl border border-[#2A2A2A] bg-[#111827]">
						<GLView style={{ flex: 1 }} onContextCreate={onContextCreate} />
					</View>
				</View>
			)}
		</SafeAreaView>
	);
}
