import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Home screen currently has static content — simulate refresh
    // Replace with real data fetch when home screen gets dynamic content
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-black">
      <ScrollView
        className="px-4 py-4"
        refreshControl={        
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00E676"
            colors={['#00E676']}
            progressBackgroundColor="rgba(25,25,25,1)"
          />
        }
      >

        {/* ================= TOP BAR ================= */}
        <View className="flex-row justify-between items-center mb-6">

          {/* Coins */}
          <View className="flex-row items-center space-x-2">
            <View className="w-10 h-10 rounded-full bg-yellow-700 items-center justify-center">
              <Text className="text-white font-bold">F</Text>
            </View>

            <View className="border border-gray-600 px-3 py-1 rounded-full">
              <Text className="text-white">0</Text>
            </View>
          </View>

          {/* Icons */}
          <View className="flex-row space-x-3">
              {(() => {
                const icons: React.ComponentProps<typeof Ionicons>['name'][] = [
                  'search',
                  'notifications-outline',
                  'chatbubble-outline',
                ];
                return icons.map((icon, i) => (
                  <TouchableOpacity
                    key={i}
                    className="w-10 h-10 rounded-full bg-gray-800 items-center justify-center"
                  >
                    <Ionicons name={icon} size={18} color="white" />
                  </TouchableOpacity>
                ));
              })()}
            </View>
        </View>

        {/* ================= QUICK FEATURES ================= */}
        <View className="flex-row justify-between mb-6">
          {[
            'Get A Coach',
            'Lab Test',
            'Challenges',
            'My Plan'
          ].map((item, i) => (
            <View key={i} className="items-center">
              <View className="w-16 h-16 rounded-full bg-gray-800 mb-2" />
              <Text className="text-gray-300 text-xs text-center w-20">
                {item}
              </Text>
            </View>
          ))}
        </View>

        {/* ================= LOCK CARD ================= */}
        <View className="bg-slate-900 rounded-3xl p-6 items-center mb-8 border border-gray-800">

          <View className="w-14 h-14 rounded-full bg-gray-700 items-center justify-center mb-4">
            <Ionicons name="lock-closed" size={20} color="white" />
          </View>

          <Text className="text-white text-lg font-bold">
            Unlock health trackers
          </Text>

          <Text className="text-gray-400 text-center mt-2 mb-5">
            Calculate your ideal daily calories and get started!
          </Text>

          <TouchableOpacity className="bg-white px-10 py-3 rounded-xl">
            <Text className="text-black font-bold text-lg">Unlock now</Text>
            <Text className="text-green-500 text-center font-semibold">
              It's FREE!
            </Text>
          </TouchableOpacity>
        </View>

        {/* ================= COMMUNITY ================= */}
        <Text className="text-white text-xl font-bold mb-1">Community</Text>
        <Text className="text-gray-400 mb-4">
          Learn. Get fit. Share and inspire!
        </Text>

        <View className="flex-row space-x-3 mb-6">
          <TouchableOpacity className="border border-white px-4 py-2 rounded-xl">
            <Text className="text-white">Highlights</Text>
          </TouchableOpacity>

          {['All', 'Discussions', 'Transformations'].map((tab, i) => (
            <TouchableOpacity
              key={i}
              className="bg-gray-800 px-4 py-2 rounded-xl"
            >
              <Text className="text-gray-300">{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Post */}
        <View className="bg-slate-900 p-4 rounded-2xl mb-20">
          <Text className="text-white font-semibold">Nivin Suresh</Text>
          <Text className="text-gray-400 text-xs mb-2">
            Transformations • 163 Views
          </Text>

          <Text className="text-gray-200">
            14 Weeks. 16.9 Kg Down. Life Changed 💪🔥
          </Text>
        </View>
      </ScrollView>

      {/* ================= FLOATING BUTTON ================= */}
      <TouchableOpacity className="absolute bottom-6 right-6 w-16 h-16 bg-white rounded-full items-center justify-center shadow-lg">
        <Ionicons name="add" size={28} color="black" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

