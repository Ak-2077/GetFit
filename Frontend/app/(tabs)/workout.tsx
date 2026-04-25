import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function WorkoutScreen() {
  const router = useRouter();

  const handleHomeWorkout = () => {
    router.push('/home-workout');
  };

  const handleGym = () => {
    console.log('Gym pressed');
    // TODO: Navigate to gym workouts
  };

  const handleAITrainer = () => {
    console.log('AI Trainer pressed');
    // TODO: Navigate to AI Trainer
  };

  return (
    <SafeAreaView className="flex-1 bg-[#0A0A0A]">
      <View className="flex-1 px-6 py-6">
        <Text className="text-white text-[28px] font-bold mb-2">Workout</Text>
        <Text className="text-[#9CA3AF] text-[15px] mb-8">Choose your training mode</Text>

        <View className="gap-4">
          {/* Home Workout Block */}
          <TouchableOpacity
            onPress={handleHomeWorkout}
            activeOpacity={0.8}
            className="bg-[#1A1A1A] rounded-3xl p-6 border border-[#2A2A2A] flex-row items-center"
          >
            <View className="w-20 h-20 rounded-2xl bg-[#2D2D2D] items-center justify-center mr-5">
              <Image
                source={require('../../assets/icons/home-workout.png')}
                style={{ width: 50, height: 50, tintColor: '#fff' }}
                resizeMode="contain"
              />
            </View>
            <View className="flex-1">
              <Text className="text-white text-xl font-bold mb-1">Home Workout</Text>
              <Text className="text-[#9CA3AF] text-sm">Train anywhere, anytime</Text>
            </View>
          </TouchableOpacity>

          {/* Gym Block */}
          <TouchableOpacity
            onPress={handleGym}
            activeOpacity={0.8}
            className="bg-[#1A1A1A] rounded-3xl p-6 border border-[#2A2A2A] flex-row items-center"
          >
            <View className="w-20 h-20 rounded-2xl bg-[#2D2D2D] items-center justify-center mr-5">
              <Image
                source={require('../../assets/icons/Gym.png')}
                style={{ width: 50, height: 50, tintColor: '#fff' }}
                resizeMode="contain"
              />
            </View>
            <View className="flex-1">
              <Text className="text-white text-xl font-bold mb-1">Gym</Text>
              <Text className="text-[#9CA3AF] text-sm">Full equipment training</Text>
            </View>
          </TouchableOpacity>

          {/* AI Trainer Block */}
          <TouchableOpacity
            onPress={handleAITrainer}
            activeOpacity={0.8}
            className="bg-[#1A1A1A] rounded-3xl p-6 border border-[#2A2A2A] flex-row items-center"
          >
            <View className="w-20 h-20 rounded-2xl bg-[#2D2D2D] items-center justify-center mr-5">
              <Image
                source={require('../../assets/icons/ai.png')}
                style={{ width: 50, height: 50, tintColor: '#fff' }}
                resizeMode="contain"
              />
            </View>
            <View className="flex-1">
              <Text className="text-white text-xl font-bold mb-1">AI Trainer</Text>
              <Text className="text-[#9CA3AF] text-sm">Personalized AI guidance</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
