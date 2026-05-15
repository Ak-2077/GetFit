/**
 * CancelSubscriptionModal.tsx
 * ──────────────────────────────────────────────────────────────
 * Industry-standard cancellation confirmation modal (Netflix /
 * Spotify / Apple pattern).
 *
 * Explains to the user that:
 *   • Premium access remains until the billing-period ends
 *   • Auto-renew will stop
 *   • The account will revert to Basic afterward
 *
 * The actual cancel call is delegated to the parent via `onConfirm`
 * so the modal stays UI-only and testable.
 * ──────────────────────────────────────────────────────────────
 */

import React, { useCallback, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import FontAwesome from '@expo/vector-icons/FontAwesome';

interface Props {
  visible: boolean;
  /** Human-readable plan name shown in the title, e.g. "AI Trainer Pro". */
  planName?: string;
  /** Expiry date displayed in the "you'll keep access until DATE" copy. */
  expiryDate?: Date | null;
  /** Called when the user taps "Cancel Plan". Must return the result. */
  onConfirm: () => Promise<{ ok: boolean; message: string }>;
  /** Called when the user dismisses or taps "Keep Subscription". */
  onClose: () => void;
  /** Optional callback when cancellation succeeds (e.g. show toast). */
  onCancelled?: (message: string) => void;
}

const fmtDate = (d?: Date | null): string => {
  if (!d) return 'the end of your billing period';
  try {
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return d.toDateString();
  }
};

export const CancelSubscriptionModal: React.FC<Props> = ({
  visible,
  planName = 'your subscription',
  expiryDate,
  onConfirm,
  onClose,
  onCancelled,
}) => {
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    if (working) return;
    setWorking(true);
    setErrorMessage(null);
    try {
      const result = await onConfirm();
      if (result.ok) {
        onCancelled?.(result.message);
        onClose();
      } else {
        setErrorMessage(result.message);
      }
    } finally {
      setWorking(false);
    }
  }, [working, onConfirm, onCancelled, onClose]);

  const handleClose = useCallback(() => {
    if (working) return;
    setErrorMessage(null);
    onClose();
  }, [working, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.cardWrapper}>
          <BlurView intensity={80} tint="dark" style={styles.card}>
            {/* Icon */}
            <View style={styles.iconBubble}>
              <FontAwesome name="exclamation-triangle" size={22} color="#FF9F0A" />
            </View>

            <Text style={styles.title}>Cancel {planName}?</Text>
            <Text style={styles.subtitle}>
              Your premium benefits will remain active until{' '}
              <Text style={styles.subtitleBold}>{fmtDate(expiryDate)}</Text>.
              After that, your account will revert to Basic.
            </Text>

            {/* Bullet list */}
            <View style={styles.bullets}>
              <Bullet icon="check" tone="ok" text="You keep all Pro features until expiry" />
              <Bullet icon="ban" tone="warn" text="Auto-renew will be turned off" />
              <Bullet icon="arrow-down" tone="warn" text="Premium features lock after the expiry date" />
              <Bullet icon="refresh" tone="info" text="You can resubscribe anytime" />
            </View>

            {errorMessage ? (
              <View style={styles.errorBox}>
                <FontAwesome name="exclamation-circle" size={13} color="#FF453A" />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Buttons */}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.primary]}
                onPress={handleClose}
                disabled={working}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryText}>Keep Subscription</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.danger]}
                onPress={handleConfirm}
                disabled={working}
                activeOpacity={0.85}
              >
                {working ? (
                  <ActivityIndicator color="#FF453A" />
                ) : (
                  <Text style={styles.dangerText}>Cancel Plan</Text>
                )}
              </TouchableOpacity>
            </View>
          </BlurView>
        </View>
      </View>
    </Modal>
  );
};

/* ---------- Sub-components ---------- */

type BulletTone = 'ok' | 'warn' | 'info';

const TONE_COLORS: Record<BulletTone, string> = {
  ok: '#1FA463',
  warn: '#FF9F0A',
  info: '#5AC8FA',
};

const Bullet: React.FC<{ icon: any; tone: BulletTone; text: string }> = ({
  icon,
  tone,
  text,
}) => (
  <View style={styles.bulletRow}>
    <View style={[styles.bulletIcon, { backgroundColor: `${TONE_COLORS[tone]}22` }]}>
      <FontAwesome name={icon} size={11} color={TONE_COLORS[tone]} />
    </View>
    <Text style={styles.bulletText}>{text}</Text>
  </View>
);

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  cardWrapper: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(20,20,20,0.85)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 12 },
    }),
  },
  card: {
    padding: 24,
  },
  iconBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,159,10,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginBottom: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.70)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
  },
  subtitleBold: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  bullets: {
    gap: 10,
    marginBottom: 18,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bulletIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    flex: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,69,58,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,69,58,0.30)',
    marginBottom: 14,
  },
  errorText: {
    color: '#FF453A',
    fontSize: 12.5,
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  button: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#FFFFFF',
  },
  primaryText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
  },
  danger: {
    backgroundColor: 'rgba(255,69,58,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,69,58,0.40)',
  },
  dangerText: {
    color: '#FF453A',
    fontSize: 14,
    fontWeight: '700',
  },
});
