import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

import GlassTabBar from '@/components/GlassTabBar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMe, setAuthToken, updateProfile } from '@/services/api';

export default function TabLayout() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  const lastCoordsRef = React.useRef<Location.LocationObjectCoords | null>(null);
  const totalDistanceMetersRef = React.useRef(0);
  const watchSubRef = React.useRef<Location.LocationSubscription | null>(null);
  const lastSyncAtRef = React.useRef(0);

  const toRad = (value: number) => (value * Math.PI) / 180;
  const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

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
      } catch (e: any) {
        console.warn('auth check failed', e?.response?.status || e);
        // Token is invalid / expired → clear and redirect
        await AsyncStorage.removeItem('token');
        setAuthToken(null);
        router.replace('/auth');
      }
    })();
  }, []);

  useEffect(() => {
    let mounted = true;
    let starting = false;
    const getTodayKey = () => new Date().toISOString().slice(0, 10);

    const stopTracking = () => {
      if (watchSubRef.current) {
        watchSubRef.current.remove();
        watchSubRef.current = null;
        console.log('Location tracking stopped');
      }
    };

    const startWatcher = async () => {
      if (!mounted || starting || watchSubRef.current) return;
      starting = true;

      try {
        const todayKey = getTodayKey();
        const trackedDay = await AsyncStorage.getItem('activityTrackedDay');

        // Reset counters once per day so steps/distance represent "today".
        if (trackedDay !== todayKey) {
          totalDistanceMetersRef.current = 0;
          lastCoordsRef.current = null;
          await AsyncStorage.setItem('activityTrackedDay', todayKey);
          try {
            await updateProfile({ steps: 0, stepDistanceKm: 0 });
          } catch (err) {
            console.warn('Daily reset sync failed', err);
          }
        }

        if (totalDistanceMetersRef.current === 0) {
          try {
            const profileRes = await getMe();
            const profileDistanceKm = Number(profileRes?.data?.stepDistanceKm || 0);
            if (Number.isFinite(profileDistanceKm) && profileDistanceKm > 0) {
              totalDistanceMetersRef.current = profileDistanceKm * 1000;
            }
          } catch {
            // keep fallback of 0m if profile load fails
          }
        }

        watchSubRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 2,
          },
          async (location) => {
            if (!mounted) return;

            const { coords } = location;
            const last = lastCoordsRef.current;
            lastCoordsRef.current = coords;

            if (!last) return;

            const deltaMeters = getDistanceMeters(last.latitude, last.longitude, coords.latitude, coords.longitude);
            if (deltaMeters < 1) return;

            totalDistanceMetersRef.current += deltaMeters;
            const distanceKm = totalDistanceMetersRef.current / 1000;
            const steps = Math.max(0, Math.round(totalDistanceMetersRef.current / 0.78));

            const now = Date.now();
            if (now - lastSyncAtRef.current > 30000) {
              lastSyncAtRef.current = now;
              try {
                await updateProfile({
                  steps,
                  stepDistanceKm: parseFloat(distanceKm.toFixed(2)),
                });
              } catch (err) {
                console.warn('Global activity sync failed', err);
              }
            }
          }
        );
      } catch (err) {
        console.warn('Global location tracking error', err);
      } finally {
        starting = false;
      }
    };

    const ensureTracking = async () => {
      if (!mounted) return;

      try {
        // Check if user has toggled tracking off in Settings
        const trackingEnabled = await AsyncStorage.getItem('locationTrackingEnabled');
        if (trackingEnabled === 'false') {
          stopTracking();
          return;
        }

        // Check current permission status (don't prompt here — prompt happens in Calories tab / Settings)
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          // First-time: request permission once automatically
          const requested = await AsyncStorage.getItem('locationPermissionRequested');
          if (!requested) {
            await AsyncStorage.setItem('locationPermissionRequested', 'true');
            const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
            if (newStatus === 'granted') {
              await AsyncStorage.setItem('locationTrackingEnabled', 'true');
              await startWatcher();
            }
          }
          return;
        }

        // Permission granted — auto-enable tracking if never set
        const currentSetting = await AsyncStorage.getItem('locationTrackingEnabled');
        if (currentSetting === null) {
          await AsyncStorage.setItem('locationTrackingEnabled', 'true');
        }

        if (currentSetting !== 'false') {
          await startWatcher();
        }
      } catch (err) {
        console.warn('ensureTracking error', err);
      }
    };

    ensureTracking();

    // Re-check only when app returns to foreground (no polling)
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        ensureTracking();
      }
    });

    return () => {
      mounted = false;
      appStateSub.remove();
      stopTracking();
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
