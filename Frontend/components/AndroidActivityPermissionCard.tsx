/**
 * AndroidActivityPermissionCard.tsx
 * ──────────────────────────────────────────────────────────────
 * Glassmorphism permission-recovery card shown on Android when our
 * fitness pipeline detects that activity tracking data is unavailable.
 *
 * Handles 3 states:
 *   1. Health Connect available but not authorized → "Connect Health Data"
 *   2. Health Connect not installed (Android < 14) → "Install Health Connect"
 *      + secondary "Use Basic Tracking"
 *   3. No Health Connect, pedometer permission denied → "Enable Activity
 *      Tracking" + "Open Settings"
 *
 * • Premium feel mirroring HealthKitPermissionCard
 * • Renders nothing on iOS or when no recovery is needed
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
import { HealthConnectService } from '../services/fitness/HealthConnectService';
import { AndroidPedometerService } from '../services/fitness/AndroidPedometerService';
import { FitnessService } from '../services/fitness/FitnessService';

interface Props {
  onEnabled?: () => void;
  /** Pass false to render the card unconditionally (e.g. settings screen). */
  onlyWhenIssue?: boolean;
  /** True when the resolver thinks Android activity tracking can't deliver. */
  permissionIssue?: boolean;
  /** Whether Health Connect is available on this device */
  isHealthConnectAvailable?: boolean;
  /** Whether Health Connect has been authorized */
  isHealthConnectAuthorized?: boolean;
}

const Feature: React.FC<{ icon: any; text: string }> = ({ icon, text }) => (
  <View style={styles.featureRow}>
    <FontAwesome name={icon} size={14} color="#fff" style={{ width: 20 }} />
    <Text style={styles.featureText}>{text}</Text>
  </View>
);

export const AndroidActivityPermissionCard: React.FC<Props> = ({
  onEnabled,
  onlyWhenIssue = true,
  permissionIssue = false,
  isHealthConnectAvailable = false,
  isHealthConnectAuthorized = false,
}) => {
  const [working, setWorking] = useState(false);

  if (Platform.OS !== 'android') return null;
  if (onlyWhenIssue && !permissionIssue) return null;
  // Don't show if HC is authorized — data is flowing
  if (isHealthConnectAuthorized) return null;

  /* ── Determine the card variant ── */

  // Variant 1: HC available but not authorized → request HC permissions
  const showHCConnect = isHealthConnectAvailable && !isHealthConnectAuthorized;
  // Variant 2: HC not available → prompt to install HC from Play Store
  const showHCInstall = !isHealthConnectAvailable;

  const handleConnectHealthData = useCallback(async () => {
    if (working) return;
    setWorking(true);
    try {
      if (showHCConnect) {
        // Request Health Connect permissions
        const ok = await HealthConnectService.requestPermissions();
        if (ok) {
          await FitnessService.refreshAll(true);
          onEnabled?.();
        }
      } else {
        // Fallback: request pedometer permissions
        const granted = await AndroidPedometerService.requestPermissions();
        if (granted) {
          await FitnessService.refreshAll(true);
          onEnabled?.();
        }
      }
    } finally {
      setWorking(false);
    }
  }, [working, onEnabled, showHCConnect]);

  const handleInstallHealthConnect = useCallback(async () => {
    await HealthConnectService.openInstallPage();
  }, []);

  const handleOpenSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  /* ── Title / subtitle / CTA labels ── */

  let title = 'Enable Activity Tracking';
  let subtitle = 'Allow fitness tracking for accurate steps and calorie insights.';
  let primaryLabel = 'Connect Health Data';
  let secondaryLabel = 'Open Settings';
  let secondaryAction = handleOpenSettings;

  if (showHCConnect) {
    title = 'Connect Health Data';
    subtitle =
      'Link Health Connect for accurate step counting, calorie tracking, and activity insights from all your fitness apps.';
    primaryLabel = working ? 'Connecting…' : 'Connect Health Data';
    secondaryLabel = 'Open Settings';
    secondaryAction = handleOpenSettings;
  } else if (showHCInstall) {
    title = 'Install Health Connect';
    subtitle =
      'Health Connect by Google provides the most accurate fitness tracking. Install it for reliable step and calorie data.';
    primaryLabel = 'Install Health Connect';
    secondaryLabel = 'Use Basic Tracking';
    secondaryAction = handleConnectHealthData; // falls back to pedometer request
  }

  return (
    <View style={styles.wrapper}>
      <BlurView intensity={60} tint="dark" style={styles.blur}>
        <View style={styles.headerRow}>
          <View style={styles.iconBubble}>
            <FontAwesome name="heartbeat" size={20} color="#1FA463" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>

        <View style={styles.features}>
          <Feature icon="bolt" text="Calorie burn estimation" />
          <Feature icon="line-chart" text="Live step tracking" />
          <Feature icon="map-marker" text="Distance tracking" />
          <Feature icon="trophy" text="Daily activity goals" />
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.primary]}
            onPress={
              showHCInstall
                ? handleInstallHealthConnect
                : handleConnectHealthData
            }
            disabled={working}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>
              {working && !showHCInstall ? 'Requesting…' : primaryLabel}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondary]}
            onPress={secondaryAction}
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        </View>
      </BlurView>
    </View>
  );
};

/* ---------- Styles (mirror HealthKitPermissionCard) ---------- */

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginVertical: 12,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(31,164,99,0.30)',
    backgroundColor: 'rgba(15,15,15,0.55)',
  },
  blur: {
    padding: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(31,164,99,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    marginTop: 3,
    lineHeight: 16,
  },
  features: {
    gap: 9,
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12.5,
    fontWeight: '500',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#1FA463',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  secondaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
