import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';

import GlassTabBar from '@/components/GlassTabBar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMe, setAuthToken, getUserProfile } from '@/services/api';
import { FitnessService } from '@/services/fitness';

export default function TabLayout() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (!token) {
          router.replace('/auth');
          return;
        }
        // Set header and verify token is still valid
        setAuthToken(token);
        await getMe();
        setChecking(false);

        // ── Initialize FitnessService after auth ──
        // Fetch user weight for calorie estimation fallback
        let userWeight: number | undefined;
        try {
          const profileRes = await getUserProfile();
          const w = Number(profileRes?.data?.weight);
          if (w > 0) userWeight = w;
        } catch {
          // profile fetch failed — proceed without weight
        }

        await FitnessService.initialize(userWeight);
      } catch (e: any) {
        console.warn('auth check failed', e?.response?.status || e);
        // Token is invalid / expired → clear and redirect
        await AsyncStorage.removeItem('token');
        setAuthToken(null);
        router.replace('/auth');
      }
    })();

    return () => {
      // Clean up FitnessService on unmount (unlikely but safe)
      FitnessService.destroy();
    };
  }, []);

  // while checking auth, don't render tabs to avoid unauthenticated access briefly
  if (checking) return null;

  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home' }}
      />
      <Tabs.Screen
        name="workout"
        options={{ title: 'Workout' }}
      />
      <Tabs.Screen
        name="ai-trainer"
        options={{ title: 'AI Trainer' }}
      />
      <Tabs.Screen
        name="calories"
        options={{ title: 'Calories' }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile' }}
      />
    </Tabs>
  );
}
