import React from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * GlassHeader — floating, blurred header (WhatsApp / Apple Music style).
 *
 * The header floats over the screen content. The list/scroll view below
 * scrolls UNDERNEATH it, and the blur faintly reveals that content.
 *
 *   • Respects the safe-area top inset.
 *   • Low-opacity tint on iOS so the blur shows through; slightly more
 *     opaque on Android (BlurView is weaker / less consistent there).
 *   • Does NOT use a solid background.
 *
 * Usage:
 *   <GlassHeader title="Home" right={<IconButton />} />
 *   // give the scroll view: contentContainerStyle={{ paddingTop: headerHeight }}
 *   // use useGlassHeaderHeight() to get that value.
 */

const TINT =
  Platform.OS === 'android' ? 'rgba(6,13,9,0.80)' : 'rgba(6,13,9,0.35)';

export const HEADER_CONTENT_HEIGHT = 52;

export function useGlassHeaderHeight() {
  const insets = useSafeAreaInsets();
  return insets.top + HEADER_CONTENT_HEIGHT;
}

export default function GlassHeader({
  title,
  left,
  right,
  titleAlign = 'left',
}: {
  title?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  titleAlign?: 'left' | 'center';
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: TINT }]} />
      <View style={[styles.bottomBorder]} />
      <View
        style={{
          paddingTop: insets.top,
          height: insets.top + HEADER_CONTENT_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
        }}
      >
        <View style={{ minWidth: 40, alignItems: 'flex-start' }}>{left}</View>
        <View
          style={{
            flex: 1,
            alignItems: titleAlign === 'center' ? 'center' : 'flex-start',
            paddingHorizontal: titleAlign === 'center' ? 0 : 4,
          }}
        >
          {!!title && <Text style={styles.title}>{title}</Text>}
        </View>
        <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    overflow: 'hidden',
  },
  bottomBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  title: {
    color: '#F0F0F0',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
});
