/**
 * Upgrade Screen
 * ────────────────────────────────────────────────────────────
 * Real subscription flow:
 *   1. Fetch plans + current status from /api/payments/plans
 *   2. User selects monthly | yearly + plan tier
 *   3. POST /api/payments/razorpay/create-order → RZP order id
 *   4. Open Razorpay Checkout (Android only)
 *   5. POST /api/payments/razorpay/verify → backend HMAC verifies
 *   6. Backend activates Subscription → we refresh useSubscription
 *
 * Premium UX:
 *   • Monthly / yearly toggle with savings badge
 *   • Animated plan cards with "Most Popular" badge
 *   • Processing modal during checkout
 *   • Success / Failed inline result cards
 *   • Restore Purchases button
 *   • iOS-aware (gracefully shows "coming soon" until Phase 3)
 * ────────────────────────────────────────────────────────────
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
  StyleSheet,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import {
  getPaymentPlans,
  getUserProfile,
  setAuthToken,
} from '../services/api';
import { useSubscription } from '../hooks/useSubscription';
import RazorpayCheckoutService from '../services/payments/RazorpayCheckoutService';
import IAPService from '../services/payments/IAPService';
import { CancelSubscriptionModal } from '../components/CancelSubscriptionModal';

/* ---------- Theme ---------- */

const C = {
  bg: '#060D09',
  card: 'rgba(20,22,24,0.92)',
  cardBorder: 'rgba(255,255,255,0.06)',
  accent: '#1FA463',
  accentSoft: 'rgba(31,164,99,0.14)',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.55)',
  muted: 'rgba(255,255,255,0.40)',
  purple: '#6A0DAD',
  burn: '#FF6B6B',
};

/* ---------- Types ---------- */

type BillingCycle = 'monthly' | 'yearly';
type PaymentState =
  | { kind: 'idle' }
  | { kind: 'processing'; planId: string }
  | { kind: 'success'; planTier: string; expiryDate: string | null }
  | { kind: 'failed'; reason: string }
  | { kind: 'cancelled' };

interface ServerPlan {
  id: string;
  tier: 'free' | 'pro' | 'pro_plus';
  name: string;
  billingCycle: BillingCycle | null;
  durationDays: number | null;
  amountPaise: number;
  displayPrice: string;
  period: string;
  currency: string;
  badge: string | null;
  isPopular: boolean;
  discountPercent: number;
  trialDays: number;
  featureList: { name: string; included: boolean }[];
}

/* ---------- Screen ---------- */

export default function UpgradeScreen() {
  const router = useRouter();
  const subscription = useSubscription();

  const [plans, setPlans] = useState<ServerPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [user, setUser] = useState<{ name?: string; email?: string; phone?: string } | null>(null);
  const [paymentState, setPaymentState] = useState<PaymentState>({ kind: 'idle' });
  const [restoring, setRestoring] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);

  /* ---------- Load ---------- */

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);

      const [plansRes, profileRes] = await Promise.all([
        getPaymentPlans(),
        getUserProfile().catch(() => ({ data: null })),
      ]);
      const fetched: ServerPlan[] = plansRes.data?.plans || [];
      setPlans(fetched);
      if (profileRes?.data) {
        setUser({
          name: profileRes.data.name,
          email: profileRes.data.email,
          phone: profileRes.data.phone,
        });
      }
    } catch (err: any) {
      console.warn('[upgrade] failed to load plans:', err?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      subscription.refresh();
    }, [load]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ---------- Derived: plans visible in this billing cycle ---------- */

  const visiblePlans = useMemo(
    () => plans.filter((p) => p.tier !== 'free' && p.billingCycle === billing),
    [plans, billing]
  );

  /* ---------- Actions ---------- */

  const handlePurchase = async (plan: ServerPlan) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPaymentState({ kind: 'processing', planId: plan.id });

    /* ---------- iOS: Apple IAP via StoreKit ---------- */
    if (Platform.OS === 'ios') {
      if (!IAPService.isAvailable()) {
        setPaymentState({
          kind: 'failed',
          reason:
            'StoreKit not available. Install react-native-iap, run `npx expo prebuild --platform ios`, then rebuild the dev client.',
        });
        return;
      }
      // Backend resolves the Apple SKU from `appleProductId`.
      // The plan list endpoint includes it; fall back to a derived id
      // if the backend hasn't redeployed yet.
      const appleSku =
        (plan as any).appleProductId ||
        `com.getfit.fitness.${plan.tier === 'pro_plus' ? 'proplus' : 'pro'}.${plan.billingCycle}`;

      const result = await IAPService.purchase(appleSku);

      if (result.kind === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setPaymentState({
          kind: 'success',
          planTier: result.planTier,
          expiryDate: result.expiryDate,
        });
        await subscription.refresh();
      } else if (result.kind === 'cancelled') {
        setPaymentState({ kind: 'cancelled' });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setPaymentState({ kind: 'failed', reason: result.reason });
      }
      return;
    }

    /* ---------- Android: Razorpay ---------- */
    if (!RazorpayCheckoutService.isAvailable()) {
      setPaymentState({
        kind: 'failed',
        reason:
          'Razorpay not bundled. Run `npx expo prebuild` after installing react-native-razorpay, then rebuild the dev client.',
      });
      return;
    }

    const result = await RazorpayCheckoutService.purchase(plan.id, user || {});

    if (result.kind === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPaymentState({
        kind: 'success',
        planTier: result.planTier,
        expiryDate: result.expiryDate,
      });
      await subscription.refresh();
    } else if (result.kind === 'cancelled') {
      setPaymentState({ kind: 'cancelled' });
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setPaymentState({ kind: 'failed', reason: result.reason });
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      // On iOS, hit StoreKit first to fetch the latest receipt, then
      // backend-verify it. On Android, the backend cache is the source
      // of truth so a simple refresh is enough.
      if (Platform.OS === 'ios' && IAPService.isAvailable()) {
        const r = await IAPService.restore();
        if (r.ok) await subscription.refresh();
        Alert.alert(r.ok ? 'Subscription restored' : 'No active subscription', r.message);
      } else {
        const r = await subscription.restore();
        Alert.alert(r.ok ? 'Subscription restored' : 'No active subscription', r.message);
      }
    } finally {
      setRestoring(false);
    }
  };

  /**
   * iOS users can ONLY cancel via Apple's subscriptions page
   * (App Review explicitly forbids in-app cancellation for IAP).
   * Android users see the in-app modal which calls our backend.
   */
  const handleCancelTap = () => {
    if (Platform.OS === 'ios') {
      Alert.alert(
        'Manage your subscription',
        "To cancel, you'll be taken to your Apple subscriptions page. Your premium access stays active until the end of the billing period.",
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => IAPService.openManageSubscriptions().catch(() => {}),
          },
        ]
      );
      return;
    }
    setCancelModalVisible(true);
  };

  /* ---------- Render ---------- */

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={styles.glow} />

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                router.back();
              }}
              style={styles.backBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={22} color={C.white} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.title}>Choose Your Plan</Text>
              <Text style={styles.subtitle}>
                Unlock premium features and reach your goals faster
              </Text>
            </View>
          </View>

          {/* Current plan banner — reflects cancelled state when applicable */}
          {subscription.isPremium && (
            <View
              style={[
                styles.currentBanner,
                subscription.cancelled && {
                  backgroundColor: 'rgba(255,159,10,0.10)',
                  borderColor: 'rgba(255,159,10,0.30)',
                },
              ]}
            >
              <Ionicons
                name={subscription.cancelled ? 'time-outline' : 'shield-checkmark'}
                size={18}
                color={subscription.cancelled ? '#FF9F0A' : C.accent}
              />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text
                  style={[
                    styles.currentTitle,
                    subscription.cancelled && { color: '#FFB84D' },
                  ]}
                >
                  {subscription.cancelled
                    ? `${subscription.tier === 'pro_plus' ? 'Pro+' : 'Pro'} — Cancelled`
                    : `You're on ${subscription.tier === 'pro_plus' ? 'Pro+' : 'Pro'}`}
                </Text>
                {subscription.expiryDate && (
                  <Text style={styles.currentSub}>
                    {subscription.cancelled
                      ? `Premium access until ${subscription.expiryDate.toLocaleDateString()}`
                      : subscription.autoRenew
                        ? `Renews on ${subscription.expiryDate.toLocaleDateString()}`
                        : `Active until ${subscription.expiryDate.toLocaleDateString()}`}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Billing toggle */}
          <BillingToggle value={billing} onChange={setBilling} plans={plans} />

          {/* Plan cards */}
          {visiblePlans.length === 0 ? (
            <View style={[styles.center, { paddingVertical: 40 }]}>
              <Text style={{ color: C.muted, fontSize: 13 }}>No plans available right now.</Text>
            </View>
          ) : (
            visiblePlans.map((plan) => {
              const isCurrent =
                subscription.planId === plan.id ||
                (subscription.tier === plan.tier && subscription.billingCycle === plan.billingCycle);
              return (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isCurrent={isCurrent}
                  onPurchase={() => handlePurchase(plan)}
                />
              );
            })
          )}

          {/* Secure indicator */}
          <View style={styles.secureRow}>
            <Ionicons name="lock-closed" size={12} color={C.muted} />
            <Text style={styles.secureText}>
              Secure payments processed by Razorpay · 256-bit encryption
            </Text>
          </View>

          {/* Restore + Cancel row — the two lifecycle CTAs */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <TouchableOpacity
              onPress={handleRestore}
              disabled={restoring}
              style={[styles.restoreBtn, { flex: 1, marginTop: 0 }]}
              activeOpacity={0.8}
            >
              {restoring ? (
                <ActivityIndicator size="small" color={C.label} />
              ) : (
                <Text style={styles.restoreText}>
                  {subscription.cancelled ? 'Restore Subscription' : 'Restore Purchases'}
                </Text>
              )}
            </TouchableOpacity>

            {/* Cancel — only visible for active, non-cancelled premium users */}
            {subscription.isPremium && !subscription.cancelled && (
              <TouchableOpacity
                onPress={handleCancelTap}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: 12,
                  backgroundColor: 'rgba(255,69,58,0.10)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,69,58,0.30)',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#FF453A', fontSize: 13, fontWeight: '700' }}>
                  Cancel Subscription
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.legal}>
            Subscriptions auto-renew at the displayed price unless cancelled at
            least 24h before the renewal date. Manage in your account settings.
          </Text>
        </ScrollView>
      </SafeAreaView>

      {/* Cancellation confirmation modal */}
      <CancelSubscriptionModal
        visible={cancelModalVisible}
        planName={subscription.tier === 'pro_plus' ? 'AI Trainer Pro Plus' : 'AI Trainer Pro'}
        expiryDate={subscription.expiryDate}
        onConfirm={async () => {
          const r = await subscription.cancel();
          return { ok: r.ok, message: r.message };
        }}
        onClose={() => setCancelModalVisible(false)}
        onCancelled={(msg) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          Alert.alert('Subscription cancelled', msg);
        }}
      />

      {/* Result modal */}
      <PaymentResultModal
        state={paymentState}
        onClose={() => setPaymentState({ kind: 'idle' })}
        onDone={() => {
          setPaymentState({ kind: 'idle' });
          router.back();
        }}
      />
    </View>
  );
}

/* ---------- Components ---------- */

const BillingToggle: React.FC<{
  value: BillingCycle;
  onChange: (v: BillingCycle) => void;
  plans: ServerPlan[];
}> = ({ value, onChange, plans }) => {
  // Compute % savings of yearly vs 12× monthly for the Pro tier (display hint).
  const proMonthly = plans.find((p) => p.id === 'pro_monthly')?.amountPaise || 0;
  const proYearly = plans.find((p) => p.id === 'pro_yearly')?.amountPaise || 0;
  const savings =
    proMonthly > 0 && proYearly > 0
      ? Math.round(100 - (proYearly / (proMonthly * 12)) * 100)
      : 0;

  return (
    <View style={styles.toggleWrap}>
      <TouchableOpacity
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onChange('monthly');
        }}
        style={[
          styles.toggleSeg,
          value === 'monthly' && { backgroundColor: C.accentSoft, borderColor: C.accent },
        ]}
      >
        <Text
          style={[
            styles.toggleText,
            value === 'monthly' && { color: '#fff' },
          ]}
        >
          Monthly
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onChange('yearly');
        }}
        style={[
          styles.toggleSeg,
          value === 'yearly' && { backgroundColor: C.accentSoft, borderColor: C.accent },
        ]}
      >
        <Text
          style={[
            styles.toggleText,
            value === 'yearly' && { color: '#fff' },
          ]}
        >
          Yearly
        </Text>
        {savings > 0 && (
          <View style={styles.saveBadge}>
            <Text style={styles.saveText}>Save {savings}%</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
};

const PlanCard: React.FC<{
  plan: ServerPlan;
  isCurrent: boolean;
  onPurchase: () => void;
}> = ({ plan, isCurrent, onPurchase }) => {
  const isProPlus = plan.tier === 'pro_plus';
  const accent = isProPlus ? '#FF7F00' : C.accent;
  const gradientColors: [string, string] = isProPlus
    ? ['rgba(255,127,0,0.10)', 'rgba(255,107,107,0.04)']
    : ['rgba(31,164,99,0.10)', 'rgba(31,164,99,0.02)'];

  return (
    <View
      style={[
        styles.planCard,
        {
          borderColor: isCurrent ? C.accent : `${accent}40`,
          borderWidth: plan.isPopular || isCurrent ? 1.5 : 1,
        },
      ]}
    >
      <LinearGradient colors={gradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 20 }}>
        {/* Badge */}
        {plan.badge && (
          <View style={[styles.badge, { backgroundColor: `${accent}25`, borderColor: `${accent}80` }]}>
            <Text style={[styles.badgeText, { color: accent }]}>{plan.badge}</Text>
          </View>
        )}

        {/* Title + price */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18, marginTop: plan.badge ? 0 : 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.planName}>{plan.name}</Text>
            {isCurrent && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#22C55E' }} />
                <Text style={{ color: '#22C55E', fontSize: 11, fontWeight: '700' }}>Current Plan</Text>
              </View>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.planPrice, { color: '#fff' }]}>{plan.displayPrice}</Text>
            <Text style={styles.planPeriod}>{plan.period}</Text>
          </View>
        </View>

        {/* Features */}
        {plan.featureList.map((feat, i) => (
          <View key={i} style={styles.featureRow}>
            <View
              style={[
                styles.featureIcon,
                { backgroundColor: feat.included ? `${accent}20` : 'rgba(255,255,255,0.04)' },
              ]}
            >
              <Ionicons
                name={feat.included ? 'checkmark' : 'close'}
                size={12}
                color={feat.included ? accent : 'rgba(255,255,255,0.20)'}
              />
            </View>
            <Text
              style={[
                styles.featureText,
                { color: feat.included ? C.white : C.muted },
              ]}
            >
              {feat.name}
            </Text>
          </View>
        ))}

        {/* CTA */}
        {isCurrent ? (
          <View style={styles.ctaCurrent}>
            <Text style={{ color: C.muted, fontSize: 14, fontWeight: '600' }}>Active</Text>
          </View>
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onPurchase}
            style={[styles.cta, { backgroundColor: accent }]}
          >
            <Ionicons name="flash" size={14} color="#fff" />
            <Text style={styles.ctaText}>
              Subscribe – {plan.displayPrice}
              {plan.period}
            </Text>
          </TouchableOpacity>
        )}
      </LinearGradient>
    </View>
  );
};

const PaymentResultModal: React.FC<{
  state: PaymentState;
  onClose: () => void;
  onDone: () => void;
}> = ({ state, onClose, onDone }) => {
  const visible = state.kind !== 'idle';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          {state.kind === 'processing' && (
            <>
              <ActivityIndicator size="large" color={C.accent} />
              <Text style={styles.modalTitle}>Processing payment…</Text>
              <Text style={styles.modalBody}>
                Please don't close the app. We're verifying your payment securely.
              </Text>
            </>
          )}

          {state.kind === 'success' && (
            <>
              <View style={[styles.iconCircle, { backgroundColor: C.accentSoft, borderColor: C.accent }]}>
                <Ionicons name="checkmark" size={36} color={C.accent} />
              </View>
              <Text style={styles.modalTitle}>Welcome to Premium!</Text>
              <Text style={styles.modalBody}>
                Your {state.planTier === 'pro_plus' ? 'Pro+' : 'Pro'} subscription is now active.
                {state.expiryDate ? `\nValid until ${new Date(state.expiryDate).toLocaleDateString()}.` : ''}
              </Text>
              <TouchableOpacity onPress={onDone} style={[styles.modalBtn, { backgroundColor: C.accent }]}>
                <Text style={styles.modalBtnText}>Start exploring</Text>
              </TouchableOpacity>
            </>
          )}

          {state.kind === 'failed' && (
            <>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,107,107,0.14)', borderColor: C.burn }]}>
                <Ionicons name="close" size={36} color={C.burn} />
              </View>
              <Text style={styles.modalTitle}>Payment failed</Text>
              <Text style={styles.modalBody}>{state.reason}</Text>
              <TouchableOpacity onPress={onClose} style={[styles.modalBtn, { backgroundColor: C.burn }]}>
                <Text style={styles.modalBtnText}>Try again</Text>
              </TouchableOpacity>
            </>
          )}

          {state.kind === 'cancelled' && (
            <>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.20)' }]}>
                <Ionicons name="close-circle-outline" size={36} color={C.muted} />
              </View>
              <Text style={styles.modalTitle}>Payment cancelled</Text>
              <Text style={styles.modalBody}>
                You cancelled the payment. Your selection is preserved — try again anytime.
              </Text>
              <TouchableOpacity onPress={onClose} style={[styles.modalBtn, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                <Text style={[styles.modalBtnText, { color: C.white }]}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  glow: {
    position: 'absolute',
    top: -120,
    right: -120,
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: 'rgba(31,164,99,0.06)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 18,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 22, fontWeight: '800', color: C.white, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: C.label, marginTop: 4 },

  currentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.accentSoft,
    borderColor: `${C.accent}55`,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  currentTitle: { color: C.white, fontSize: 13, fontWeight: '700' },
  currentSub: { color: C.label, fontSize: 11, marginTop: 2 },

  toggleWrap: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  toggleSeg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 8,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: C.label,
    letterSpacing: 0.2,
  },
  saveBadge: {
    backgroundColor: C.accent,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  saveText: { color: '#0B0B0B', fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },

  planCard: {
    marginBottom: 14,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: C.card,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1,
    marginBottom: 12,
  },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  planName: { color: C.white, fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
  planPrice: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  planPeriod: { color: C.muted, fontSize: 11, fontWeight: '500', marginTop: 2 },

  featureRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  featureIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  featureText: { fontSize: 13, fontWeight: '500' },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 14,
    marginTop: 12,
    gap: 8,
  },
  ctaText: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  ctaCurrent: {
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },

  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
    gap: 6,
  },
  secureText: { fontSize: 11, color: C.muted, fontWeight: '500' },

  restoreBtn: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginTop: 14,
  },
  restoreText: {
    color: C.label,
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  legal: {
    color: C.muted,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 18,
    paddingHorizontal: 20,
    lineHeight: 15,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#0F1116',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  modalTitle: {
    color: C.white,
    fontSize: 19,
    fontWeight: '800',
    marginTop: 6,
    marginBottom: 6,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  modalBody: {
    color: C.label,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  modalBtn: {
    width: '100%',
    height: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnText: { color: '#0B0B0B', fontSize: 14, fontWeight: '700' },
});
