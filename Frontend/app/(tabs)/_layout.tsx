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
        // Isolated from auth check so HealthKit/native errors don't masquerade
        // as auth failures (and don't log the user out).
        try {
          let userWeight: number | undefined;
          try {
            const profileRes = await getUserProfile();
            const w = Number(profileRes?.data?.weight);
            if (w > 0) userWeight = w;
          } catch {
            // profile fetch failed — proceed without weight
          }

          await FitnessService.initialize(userWeight);
        } catch (fitErr: any) {
          console.log('[FITNESS-INIT-FAIL]', fitErr?.message || String(fitErr));
        }
        return;
      } catch (e: any) {
        const details = {
          status: e?.response?.status,
          data: e?.response?.data,
          message: e?.message,
          code: e?.code,
          url: e?.config?.url,
          baseURL: e?.config?.baseURL,
          hasAuthHeader: Boolean(e?.config?.headers?.Authorization),
        };
        console.log('[AUTH-CHECK-FAIL]', JSON.stringify(details));
        console.warn('auth check failed', details);
        // Only clear token on definitive auth failures (401/403).
        // For network errors / 5xx, keep the token so the user isn't logged out
        // every time the backend is briefly unreachable.
        const status = e?.response?.status;
        if (status === 401 || status === 403) {
          await AsyncStorage.removeItem('token');
          setAuthToken(null);
          router.replace('/auth');
        } else {
          // Allow the app to render; individual screens will retry.
          setChecking(false);
        }
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
      tabBar={(props: React.ComponentProps<typeof GlassTabBar>) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: true,
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
