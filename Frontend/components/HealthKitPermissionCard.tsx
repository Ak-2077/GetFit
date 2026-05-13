/**
 * HealthKitPermissionCard.tsx
 * ──────────────────────────────────────────────────────────────
 * Glassmorphism permission-recovery card shown when our resolver
 * detects that Apple Health access is denied / unavailable.
 *
 * • Premium feel (BlurView + subtle gradient + Apple-style typography)
 * • Two CTAs: "Enable Health" (re-requests auth) and "Open Settings"
 *   (deep-link to iOS Settings for this app)
 * • Renders nothing on Android
 * ──────────────────────────────────────────────────────────────
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { HealthKitService } from '../services/fitness/HealthKitService';
import { FitnessService } from '../services/fitness/FitnessService';

interface Props {
  onEnabled?: () => void;
  /** Pass false to render the card unconditionally (e.g. settings screen). */
  onlyWhenIssue?: boolean;
  permissionIssue?: boolean;
}

const Feature: React.FC<{ icon: any; text: string }> = ({ icon, text }) => (
  <View style={styles.featureRow}>
    <FontAwesome name={icon} size={14} color="#fff" style={{ width: 20 }} />
    <Text style={styles.featureText}>{text}</Text>
  </View>
);

export const HealthKitPermissionCard: React.FC<Props> = ({
  onEnabled,
  onlyWhenIssue = true,
  permissionIssue = false,
}) => {
  const [working, setWorking] = useState(false);

  if (Platform.OS !== 'ios') return null;
  if (onlyWhenIssue && !permissionIssue) return null;

  const handleEnable = useCallback(async () => {
    if (working) return;
    setWorking(true);
    try {
      const ok = await HealthKitService.initialize();
      if (ok) {
        await FitnessService.refreshAll(true);
        onEnabled?.();
      }
    } finally {
      setWorking(false);
    }
  }, [working, onEnabled]);

  const handleOpenSettings = useCallback(() => {
    // Deep link to the app's Settings entry (iOS 8+). This is where
    // the user can toggle Health permissions back on after denial.
    Linking.openURL('app-settings:').catch(() => {});
  }, []);

  return (
    <View style={styles.wrapper}>
      <BlurView intensity={60} tint="dark" style={styles.blur}>
        <View style={styles.headerRow}>
          <View style={styles.iconBubble}>
            <FontAwesome name="heart" size={20} color="#FF3B30" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Enable Apple Health</Text>
            <Text style={styles.subtitle}>
              Allow Health access for accurate calorie and step tracking.
            </Text>
          </View>
        </View>

        <View style={styles.features}>
          <Feature icon="bolt" text="Accurate calorie burn" />
          <Feature icon="line-chart" text="Live step tracking" />
          <Feature icon="map-marker" text="Distance tracking" />
          <Feature icon="moon-o" text="Recovery insights" />
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.primary]}
            onPress={handleEnable}
            disabled={working}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>
              {working ? 'Requesting…' : 'Enable Health'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondary]}
            onPress={handleOpenSettings}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      </BlurView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginVertical: 12,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: 'rgba(20,22,28,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  blur: {
    padding: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,59,48,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 2,
  },
  features: {
    marginTop: 16,
    gap: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#FF3B30',
  },
  primaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  secondaryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
