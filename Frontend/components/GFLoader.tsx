import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, Image, Text, StyleSheet, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

interface GFLoaderProps {
  /** Optional text below the rotating logo */
  message?: string;
  /** Logo size in pixels (default 64) */
  size?: number;
  /** Whether to show on a full-screen dark background (default true) */
  fullScreen?: boolean;
  /** Background colour for full-screen mode */
  backgroundColor?: string;
}

/**
 * Premium rotating GF logo loader.
 * Drop-in replacement for React Native's ActivityIndicator.
 */
export default function GFLoader({
  message,
  size = 44,
  fullScreen = true,
  backgroundColor = '#050505',
}: GFLoaderProps) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    spin.start();
    return () => spin.stop();
  }, [rotation]);

  const rotateInterpolation = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const content = (
    <View style={styles.center}>
      <Animated.View style={{ transform: [{ rotate: rotateInterpolation }] }}>
        <Image
          source={require('../assets/images/gf-logo.png')}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />
      </Animated.View>
      {message ? (
        <Text style={styles.message}>{message}</Text>
      ) : null}
    </View>
  );

  if (fullScreen) {
    return (
      <View style={[styles.fullScreen, { backgroundColor }]}>
        {content}
      </View>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    marginTop: 16,
    fontSize: 13,
    color: 'rgba(255,255,255,0.50)',
    fontFamily: 'Poppins_400Regular',
    letterSpacing: 0.4,
  },
});
