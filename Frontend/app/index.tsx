// import { useEffect } from "react";
// import { useRouter } from "expo-router";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import { setAuthToken, getMe } from '../services/api';
// import GFLoader from '../components/GFLoader';

// export default function Root() {
//   const router = useRouter();

//   useEffect(() => {
//     checkAuth();
//   }, []);

//   const checkAuth = async () => {
//     const token = await AsyncStorage.getItem("token");

//     if (token) {
//       // set header then verify role
//       try {
//         setAuthToken(token);
//         const res = await getMe();
//         const role = res?.data?.role;
//         const onboardingCompleted = res?.data?.onboardingCompleted;

//         if (role === 'admin') {
//           router.replace('/admin' as any);
//         } else if (!onboardingCompleted) {
//           router.replace('/auth/onboarding' as any);
//         } else {
//           router.replace("/(tabs)");
//         }
//       } catch (e) {
//         // token invalid or request failed -> go to auth
//         router.replace('/auth' as any);
//       }
//     } else {
//       router.replace('/auth' as any);
//     }
//   };

//   return <GFLoader message="Starting up..." />;
// }



import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Animated,
  Easing,
  StyleSheet,
  Dimensions,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { setAuthToken, getMe } from "../services/api";

const { width, height } = Dimensions.get("window");
const LOGO_SIZE = width * 0.55;

export default function SplashScreen() {
  const router = useRouter();

  // ─── Animation values ────────────────────────────────────────
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.6)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const dot1Opacity = useRef(new Animated.Value(0.3)).current;
  const dot2Opacity = useRef(new Animated.Value(0.3)).current;
  const dot3Opacity = useRef(new Animated.Value(0.3)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;

  // Where to go after splash
  const [destination, setDestination] = useState<string | null>(null);

  // ─── Auth check (runs in parallel with animation) ────────────
  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem("token");
        if (token) {
          setAuthToken(token);
          const res = await getMe();
          const role = res?.data?.role;
          const onboardingCompleted = res?.data?.onboardingCompleted;

          if (role === "admin") {
            setDestination("/admin");
          } else if (!onboardingCompleted) {
            setDestination("/auth/onboarding");
          } else {
            setDestination("/(tabs)");
          }
        } else {
          setDestination("/auth");
        }
      } catch {
        setDestination("/auth");
      }
    })();
  }, []);

  // ─── Animation sequence ──────────────────────────────────────
  useEffect(() => {
    // 1. Logo fade-in + scale
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(logoScale, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.back(1.2)),
        useNativeDriver: true,
      }),
    ]).start(() => {
      // 2. Glow bloom
      Animated.parallel([
        Animated.timing(glowOpacity, {
          toValue: 0.7,
          duration: 600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glowScale, {
          toValue: 1.3,
          duration: 600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();

      // 3. Loading text fade in
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 500,
        delay: 200,
        useNativeDriver: true,
      }).start();

      // 4. Subtle pulse loop on logo
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseScale, {
            toValue: 1.04,
            duration: 1200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 1200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      ).start();
    });

    // 5. Loading dots animation
    const animateDots = () => {
      const createDotAnim = (dot: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 1,
              duration: 400,
              delay,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0.3,
              duration: 400,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ])
        );

      createDotAnim(dot1Opacity, 0).start();
      createDotAnim(dot2Opacity, 200).start();
      createDotAnim(dot3Opacity, 400).start();
    };
    animateDots();
  }, []);

  // ─── Navigate when both animation min-time & auth are ready ──
  useEffect(() => {
    if (!destination) return;

    // Ensure at least 2.5s of splash visibility
    const minSplashTime = 2500;
    const startTime = Date.now();

    const tryNavigate = () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, minSplashTime - elapsed);

      setTimeout(() => {
        // Exit animation: fade out entire screen
        Animated.timing(screenOpacity, {
          toValue: 0,
          duration: 500,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          router.replace(destination as any);
        });
      }, remaining);
    };

    tryNavigate();
  }, [destination]);

  // ─── Render ──────────────────────────────────────────────────
  return (
    <Animated.View style={[styles.root, { opacity: screenOpacity }]}>
      <LinearGradient
        colors={["#000000", "#071a0e", "#0d2818", "#0a1f12"]}
        locations={[0, 0.35, 0.7, 1]}
        style={styles.gradient}
      >
        {/* Ambient light orbs */}
        <View style={styles.orbContainer}>
          <View style={[styles.orb, styles.orbTopRight]} />
          <View style={[styles.orb, styles.orbBottomLeft]} />
        </View>

        {/* Centre content */}
        <View style={styles.centreWrap}>
          {/* Glow ring behind logo */}
          <Animated.View
            style={[
              styles.glowRing,
              {
                opacity: glowOpacity,
                transform: [{ scale: glowScale }],
              },
            ]}
          />

          {/* Second outer glow */}
          <Animated.View
            style={[
              styles.glowOuter,
              {
                opacity: Animated.multiply(glowOpacity, 0.35),
                transform: [{ scale: Animated.multiply(glowScale, 1.6) }],
              },
            ]}
          />

          {/* Logo */}
          <Animated.View
            style={{
              opacity: logoOpacity,
              transform: [
                { scale: Animated.multiply(logoScale, pulseScale) },
              ],
            }}
          >
            <Image
              source={require("../assets/images/RealLogo.png")}
              style={styles.logo}
              resizeMode="cover"
            />
          </Animated.View>
        </View>

        {/* Loading section */}
        <Animated.View style={[styles.loadingWrap, { opacity: textOpacity }]}>
          <Animated.Text style={styles.loadingText}>
            Loading your fitness journey
          </Animated.Text>

          {/* Animated dots */}
          <View style={styles.dotsRow}>
            <Animated.View
              style={[styles.dot, { opacity: dot1Opacity }]}
            />
            <Animated.View
              style={[styles.dot, { opacity: dot2Opacity }]}
            />
            <Animated.View
              style={[styles.dot, { opacity: dot3Opacity }]}
            />
          </View>
        </Animated.View>

        {/* Subtle bottom branding */}
        <Animated.Text style={[styles.brand, { opacity: textOpacity }]}>
          GETFIT
        </Animated.Text>
      </LinearGradient>
    </Animated.View>
  );
}

// ─── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  gradient: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  /* Ambient orbs for depth */
  orbContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  orb: {
    position: "absolute",
    borderRadius: 999,
  },
  orbTopRight: {
    width: width * 0.7,
    height: width * 0.7,
    top: -width * 0.2,
    right: -width * 0.25,
    backgroundColor: "rgba(34, 197, 94, 0.06)",
  },
  orbBottomLeft: {
    width: width * 0.6,
    height: width * 0.6,
    bottom: -width * 0.15,
    left: -width * 0.2,
    backgroundColor: "rgba(34, 197, 94, 0.04)",
  },

  /* Logo centering */
  centreWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: LOGO_SIZE * 1.6,
    height: LOGO_SIZE * 1.6,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE * 0.22,
    overflow: 'hidden',
  },

  /* Glow effects */
  glowRing: {
    position: "absolute",
    width: LOGO_SIZE * 1.25,
    height: LOGO_SIZE * 1.25,
    borderRadius: LOGO_SIZE * 0.625,
    backgroundColor: "rgba(39, 205, 99, 0.15)",
  },
  glowOuter: {
    position: "absolute",
    width: LOGO_SIZE * 1.25,
    height: LOGO_SIZE * 1.25,
    borderRadius: LOGO_SIZE * 0.625,
    backgroundColor: "rgba(34, 197, 94, 0.08)",
  },

  /* Loading */
  loadingWrap: {
    position: "absolute",
    bottom: height * 0.18,
    alignItems: "center",
  },
  loadingText: {
    fontFamily: "Poppins_400Regular",
    fontSize: 14,
    color: "rgba(255,255,255,0.55)",
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#22c55e",
  },

  /* Bottom brand */
  brand: {
    position: "absolute",
    bottom: height * 0.06,
    fontFamily: "Poppins_500Medium",
    fontSize: 12,
    letterSpacing: 4,
    color: "rgba(255,255,255,0.2)",
  },
});