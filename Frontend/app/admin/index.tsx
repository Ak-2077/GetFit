import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMe, setAuthToken } from '../../services/api';

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) {
          router.replace('/auth');
          return;
        }
        setAuthToken(token);
        const res = await getMe();
        const u = res.data;
        if (!u || u.role !== 'admin') {
          // not an admin -> redirect to login or tabs
          Alert.alert('Unauthorized', 'Admin access required');
          router.replace('/auth');
          return;
        }
        setUser(u);
      } catch (e) {
        console.warn('admin check failed', e);
        router.replace('/auth');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator size="large" color="#fff" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-black px-4 py-6">
      <Text className="text-white text-2xl font-bold mb-4">Admin Dashboard</Text>
      <Text className="text-gray-300 mb-6">Welcome, {user?.name || user?.email}</Text>

      <View className="space-y-3">
        <TouchableOpacity className="bg-slate-800 px-4 py-3 rounded-xl">
          <Text className="text-white">Manage Users (placeholder)</Text>
        </TouchableOpacity>

        <TouchableOpacity className="bg-slate-800 px-4 py-3 rounded-xl">
          <Text className="text-white">Site Settings (placeholder)</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
