import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMe, setAuthToken, updateProfile } from '@/services/api';

export default function TabLayout() {
  const colorScheme = useColorScheme();
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
        if (token) {
          setAuthToken(token);
          setChecking(false);
        } else {
          // not authenticated -> send to login
          router.replace('/auth');
        }
      } catch (e) {
        console.warn('auth check failed', e);
        router.replace('/auth');
      }
    })();
  }, []);

  useEffect(() => {
    let mounted = true;
    let starting = false;
    let checkIntervalId: ReturnType<typeof setInterval> | null = null;

    const stopTracking = () => {
      if (watchSubRef.current) {
        watchSubRef.current.remove();
        watchSubRef.current = null;
        console.log('Location tracking stopped');
      }
    };

    const ensureTracking = async () => {
      if (!mounted || starting) return;

      try {
        // Check if user has enabled tracking
        const trackingEnabled = await AsyncStorage.getItem('locationTrackingEnabled');
        if (trackingEnabled !== 'true') {
          stopTracking();
          starting = false;
          return;
        }

        // Already tracking, no need to start again
        if (watchSubRef.current) return;

        starting = true;

        let permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          permission = await Location.requestForegroundPermissionsAsync();
        }
        if (permission.status !== 'granted') {
          starting = false;
          return;
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

    ensureTracking();

    // Check tracking preference every 3 seconds
    checkIntervalId = setInterval(() => {
      ensureTracking();
    }, 3000);

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        ensureTracking();
      }
    });

    return () => {
      mounted = false;
      if (checkIntervalId) clearInterval(checkIntervalId);
      appStateSub.remove();
      stopTracking();
    };
  }, []);

  // while checking auth, don't render tabs to avoid unauthenticated access briefly
  if (checking) return null;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="calories"
        options={{
          title: 'Calories',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="flame.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{
          title: 'Workout',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="figure.walk" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.crop.circle" color={color} />,
        }}
      />
    </Tabs>
  );
}
