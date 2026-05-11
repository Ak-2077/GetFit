import React from 'react';
import { View, Text, TouchableOpacity, Dimensions, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';

const { width } = Dimensions.get('window');

const C = {
  bg: '#060D09',
  card: '#0F1A13',
  label: 'rgba(255,255,255,0.50)',
  white: '#F0F0F0',
  accent: '#1FA463',
};

const PARTS = [
  { key: 'chest', label: 'Chest', image: require('../assets/icons/Homeworkout/Chest.png') },
  { key: 'legs', label: 'Legs', image: require('../assets/icons/Homeworkout/legs.png') },
  { key: 'shoulders', label: 'Shoulders', image: require('../assets/icons/Homeworkout/Shoulder.png') },
  { key: 'arms', label: 'Arms', image: require('../assets/icons/Homeworkout/arms.png') },
  { key: 'back', label: 'Back', image: require('../assets/icons/Homeworkout/back.png') },
  { key: 'abs', label: 'Abs', image: require('../assets/icons/Homeworkout/abs.png') }
];

export default function WorkoutBodyParts() {
  const router = useRouter();
  const { workoutType = 'home', userPlan = 'free' } = useLocalSearchParams();

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ padding: 20 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: C.white }}>Choose a Body Part</Text>
          <Text style={{ fontSize: 13, color: C.label, marginTop: 6 }}>Select the area you want to train</Text>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {PARTS.map((p) => (
              <TouchableOpacity
                key={p.key}
                activeOpacity={0.9}
                onPress={() => router.push(`/workout-list?workoutType=${workoutType}&bodyPart=${p.key}&userPlan=${userPlan}` as any)}
                style={{
                  width: (width - 60) / 2,
                  marginBottom: 16,
                  borderRadius: 16,
                  backgroundColor: C.card,
                  padding: 16,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 52, height: 52, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(31,164,99,0.06)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                    {p.image ? (
                      <Image
                        source={p.image}
                        style={{ width: 52, height: 52 }}
                        resizeMode="cover"
                      />
                    ) : (
                      <Ionicons name={(p as any).icon as any} size={28} color="#fff" />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: C.white }}>{p.label}</Text>
                    <Text style={{ fontSize: 12, color: C.label, marginTop: 4 }}>View workouts for {p.label.toLowerCase()}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
