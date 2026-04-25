import { useEffect } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { View, ActivityIndicator } from "react-native";
import { setAuthToken, getMe } from '../services/api';

export default function Root() {
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = await AsyncStorage.getItem("token");

    if (token) {
      // set header then verify role
      try {
        setAuthToken(token);
        const res = await getMe();
        const role = res?.data?.role;
        const onboardingCompleted = res?.data?.onboardingCompleted;

        if (role === 'admin') {
          router.replace('/admin' as any);
        } else if (!onboardingCompleted) {
          router.replace('/auth/onboarding' as any);
        } else {
          router.replace("/(tabs)");
        }
      } catch (e) {
        // token invalid or request failed -> go to auth
        router.replace('/auth' as any);
      }
    } else {
      router.replace('/auth' as any);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
