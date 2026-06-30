import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

import "../global.css";

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthToken } from '@/services/api';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Keep the native splash visible until we're ready
SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (token) setAuthToken(token);
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    const enforceAuth = async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (token) {
          setAuthToken(token);
        } else {
          setAuthToken(null);
        }

        const isPublicAuthRoute =
          pathname === '/auth' ||
          pathname === '/auth/forgot-password' ||
          pathname === '/auth/onboarding' ||
          pathname === '/auth/profile-settings';

        if (!token && !isPublicAuthRoute) {
          router.replace('/auth' as any);
          return;
        }

        if (token && isPublicAuthRoute && pathname !== '/auth/onboarding' && pathname !== '/auth/profile-settings') {
          router.replace('/(tabs)');
        }
      } catch (e) {
        setAuthToken(null);
        if (pathname !== '/auth') {
          router.replace('/auth' as any);
        }
      }
    };

    enforceAuth();
  }, [pathname, router]);

  useEffect(() => {
    // No custom fonts — React Native uses the native system font automatically
    // (SF Pro on iOS, Roboto on Android). Hide the splash once mounted.
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          freezeOnBlur: true,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="scan" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="food-details" options={{ headerShown: false }} />
        <Stack.Screen name="home-workout" options={{ headerShown: false }} />
        <Stack.Screen name="home-workout-player" options={{ headerShown: false }} />
        <Stack.Screen name="bmi-calculator" options={{ headerShown: false }} />
        <Stack.Screen name="bmb-calculator" options={{ headerShown: false }} />
        <Stack.Screen name="ai-diet" options={{ headerShown: false }} />
        <Stack.Screen name="workout-plan" options={{ headerShown: false }} />
        <Stack.Screen name="workout-bodyparts" options={{ headerShown: false }} />
        <Stack.Screen name="workout-list" options={{ headerShown: false }} />
        <Stack.Screen name="workout-player" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="upgrade" options={{ headerShown: false }} />
        <Stack.Screen name="analytics/steps" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="analytics/calories" options={{ headerShown: false, animation: 'slide_from_right' }} />
      </Stack>
        <StatusBar style="light" />
      </ThemeProvider>
      </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
