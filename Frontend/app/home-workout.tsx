import React from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function HomeWorkoutScreen() {
  const router = useRouter();

  const bodyParts = [
    { name: 'Arms', icon: require('../assets/icons/Homeworkout/Arms.png') },
    { name: 'Back', icon: require('../assets/icons/Homeworkout/back.png') },
    { name: 'Chest', icon: require('../assets/icons/Homeworkout/chest.png') },
    { name: 'Core', icon: require('../assets/icons/Homeworkout/abs.png') },
    { name: 'Legs', icon: require('../assets/icons/Homeworkout/Legs.png') },
    { name: 'Shoulder', icon: require('../assets/icons/Homeworkout/Shoulder.png') },
  ];

  const handleBodyPartPress = (bodyPart: string) => {
    const normalized = bodyPart.toLowerCase() === 'shoulder' ? 'shoulders' : bodyPart.toLowerCase();
    router.push(`/home-workout-player?mode=home&bodyPart=${normalized}` as any);
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0A0A0A]">
      <ScrollView className="flex-1">
        <View className="px-6 py-6">
          {/* Header */}
          <View className="flex-row items-center mb-6">
            <TouchableOpacity onPress={() => router.back()} className="mr-4">
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </TouchableOpacity>
            <View className="flex-1">
              <Text className="text-white text-[28px] font-bold">Home Workout</Text>
              <Text className="text-[#9CA3AF] text-[15px] mt-1">Select body part to train</Text>
            </View>
          </View>

          {/* Body Parts Grid */}
          <View className="flex-row flex-wrap justify-between gap-4">
            {bodyParts.map((part, index) => (
              <View key={index} style={{ width: '47%' }} className="items-center">
                <TouchableOpacity
                  onPress={() => handleBodyPartPress(part.name)}
                  activeOpacity={0.8}
                  className="bg-[#1A1A1A] rounded-3xl border border-[#2A2A2A] items-center justify-center w-full mb-3"
                  style={{ aspectRatio: 1 }}
                >
                  <Image
                    source={part.icon}
                    style={{ width: 80, height: 80, tintColor: '#fff' }}
                    resizeMode="contain"
                  />
                </TouchableOpacity>
                <Text className="text-white text-base font-semibold">{part.name}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
