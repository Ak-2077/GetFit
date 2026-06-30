/**
 * Upgrade Screen
 * ────────────────────────────────────────────────────────────
 * Real subscription flow:
 *   1. Fetch plans + current status from /api/payments/plans
 *   2. User selects monthly | yearly + plan tier
 *   3. Open StoreKit/Play Billing Checkout native sheet
 *   4. POST /api/payments/apple/verify or /google/verify → backend verifies
 *   5. Backend activates Subscription → we refresh useSubscription
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';

import {
  getPaymentPlans,
  getUserProfile,
  setAuthToken,
} from '../services/api';
import { useSubscription } from '../hooks/useSubscription';
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
  const insets = useSafeAreaInsets();

  const [plans, setPlans] = useState<ServerPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [user, setUser] = useState<{ name?: string; email?: string; phone?: string } | null>(null);
  const [paymentState, setPaymentState] = useState<PaymentState>({ kind: 'idle' });
  const [restoring, setRestoring] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);

  /* ---------- Legal docs (App Store compliance) ---------- */

  const openLegalDoc = useCallback(async (docName: string) => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (apiUrl) {
      await WebBrowser.openBrowserAsync(`${apiUrl}/legal/${docName}`).catch(() => {});
    }
  }, []);

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

    if (!IAPService.isAvailable()) {
      setPaymentState({
        kind: 'failed',
        reason:
          'StoreKit/Play Billing not available. Install expo-iap, run `npx expo prebuild`, then rebuild the dev client.',
      });
      return;
    }

    const skuId =
      (plan as any)[Platform.OS === 'ios' ? 'appleProductId' : 'googleProductId'] ||
      `com.getfit.fitness.${plan.tier === 'pro_plus' ? 'proplus' : 'pro'}.${plan.billingCycle}`;

    // DIAGNOSTIC — log what Apple/Google actually returns so we can debug
    // E_SKU_NOT_FOUND vs "products not propagated yet".
    try {
      const allSkus = [
        'com.getfit.fitness.pro.monthly',
        'com.getfit.fitness.pro.yearly',
        'com.getfit.fitness.proplus.monthly',
        'com.getfit.fitness.proplus.yearly',
      ];
      const fetched = await IAPService.getProducts(allSkus);
      console.log('[IAP] Requested SKU:', skuId);
      console.log('[IAP] Apple/Google returned', fetched.length, 'products:');
      fetched.forEach((p) => console.log('   -', p.productId, '|', p.localizedPrice));
      if (!fetched.find((p) => p.productId === skuId)) {
        console.warn('[IAP] ⚠ Requested SKU not in response!');
      }
    } catch (e) {
      console.warn('[IAP] diagnostic fetch failed:', (e as Error).message);
    }

    const result = await IAPService.purchase(skuId);

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
        // A user-cancelled purchase sometimes surfaces as a generic failure —
        // treat it as a cancellation (neutral), not a red error.
        if (/cancel/i.test(result.reason || '')) {
          setPaymentState({ kind: 'cancelled' });
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
          setPaymentState({ kind: 'failed', reason: result.reason });
        }
      }
      return;
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      if (IAPService.isAvailable()) {
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
   * App Review explicitly forbids in-app cancellation for IAP.
   */
  const handleCancelTap = () => {
    Alert.alert(
      'Manage your subscription',
      "To cancel, you'll be taken to your device's subscriptions page. Your premium access stays active until the end of the billing period.",
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Open Settings',
          onPress: () => IAPService.openManageSubscriptions().catch(() => {}),
        },
      ]
    );
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

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 48 }}
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
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.title}>Go Premium</Text>
              <Text style={styles.subtitle}>
                Unlock everything and reach your goals faster
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
              Secure payments processed by {Platform.OS === 'ios' ? 'Apple App Store' : 'Google Play'}
            </Text>
          </View>

          {/* Restore — centered, primary lifecycle CTA (required by App Store) */}
          <TouchableOpacity
            onPress={handleRestore}
            disabled={restoring}
            style={styles.restoreBtn}
            activeOpacity={0.7}
          >
            {restoring ? (
              <ActivityIndicator size="small" color={C.label} />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="refresh" size={14} color={C.label} />
                <Text style={styles.restoreText}>
                  {subscription.cancelled ? 'Restore Subscription' : 'Restore Purchases'}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Cancel — only for active, non-cancelled premium users */}
          {subscription.isPremium && !subscription.cancelled && (
            <TouchableOpacity
              onPress={handleCancelTap}
              style={styles.cancelBtn}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelText}>Cancel Subscription</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.legal}>
            Subscriptions are billed through your {Platform.OS === 'ios' ? 'Apple ID' : 'Google'} account and
            automatically renew at the displayed price unless cancelled at least 24 hours before the end of the
            current period. Your account is charged for renewal within 24 hours prior to the end of the current
            period. You can manage or cancel anytime in your device's account settings. Any unused portion of a
            free trial is forfeited when you purchase a subscription.
          </Text>

          {/* Functional legal links — required by App Store Guideline 3.1.2 */}
          <View style={styles.legalLinks}>
            <TouchableOpacity onPress={() => openLegalDoc('terms-of-use')} activeOpacity={0.7}>
              <Text style={styles.legalLink}>Terms of Use (EULA)</Text>
            </TouchableOpacity>
            <Text style={styles.legalDot}>•</Text>
            <TouchableOpacity onPress={() => openLegalDoc('privacy-policy')} activeOpacity={0.7}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Cancellation confirmation modal */}
      <CancelSubscriptionModal
        visible={cancelModalVisible}
        planName={subscription.tier === 'pro_plus' ? 'Kyro Pro Plus' : 'Kyro Pro'}
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
  // Refined gold for Pro+ (premium feel, not a harsh orange).
  const accent = isProPlus ? '#D4A93C' : C.accent;
  const gradientColors: [string, string] = isProPlus
    ? ['rgba(212,169,60,0.06)', 'rgba(20,22,24,0.92)']
    : ['rgba(31,164,99,0.06)', 'rgba(20,22,24,0.92)'];
  const highlighted = plan.isPopular || isCurrent;

  return (
    <View
      style={[
        styles.planCard,
        {
          borderColor: isCurrent ? C.accent : highlighted ? `${accent}55` : C.cardBorder,
          borderWidth: highlighted ? 1.5 : 1,
          // Subtle elevation/glow on the highlighted plan — premium, not flashy.
          shadowColor: highlighted ? accent : '#000',
          shadowOpacity: highlighted ? 0.18 : 0.08,
          shadowRadius: highlighted ? 16 : 8,
          shadowOffset: { width: 0, height: 6 },
          elevation: highlighted ? 6 : 2,
        },
      ]}
    >
      <LinearGradient colors={gradientColors} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ padding: 22 }}>
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
              {plan.trialDays > 0 ? `Start ${plan.trialDays}-day free trial` : `Subscribe – ${plan.displayPrice}${plan.period}`}
            </Text>
          </TouchableOpacity>
        )}

        {/* Per-plan billing disclosure (App Store 3.1.2: length + price at point of purchase) */}
        {!isCurrent && (
          <Text style={styles.planTerms}>
            {plan.trialDays > 0
              ? `Then ${plan.displayPrice}${plan.period}, auto-renews. Cancel anytime.`
              : `${plan.displayPrice} per ${plan.billingCycle === 'yearly' ? 'year' : 'month'}, auto-renews. Cancel anytime.`}
          </Text>
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
              <View style={[styles.iconCircle, { backgroundColor: C.accentSoft }]}>
                <ActivityIndicator size="small" color={C.accent} />
              </View>
              <Text style={styles.modalTitle}>Processing payment</Text>
              <Text style={styles.modalBody}>
                Please keep the app open while we securely verify your payment.
              </Text>
            </>
          )}

          {state.kind === 'success' && (
            <>
              <View style={[styles.iconCircle, { backgroundColor: C.accentSoft }]}>
                <Ionicons name="checkmark-circle" size={44} color={C.accent} />
              </View>
              <Text style={styles.modalTitle}>You're all set</Text>
              <Text style={styles.modalBody}>
                Your {state.planTier === 'pro_plus' ? 'Pro+' : 'Pro'} subscription is now active.
                {state.expiryDate ? `\nValid until ${new Date(state.expiryDate).toLocaleDateString()}.` : ''}
              </Text>
              <TouchableOpacity onPress={onDone} style={[styles.modalBtn, { backgroundColor: C.accent }]} activeOpacity={0.85}>
                <Text style={styles.modalBtnText}>Start exploring</Text>
              </TouchableOpacity>
            </>
          )}

          {state.kind === 'failed' && (
            <>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,107,107,0.12)' }]}>
                <Ionicons name="alert-circle" size={44} color={C.burn} />
              </View>
              <Text style={styles.modalTitle}>Payment didn't go through</Text>
              <Text style={styles.modalBody}>{state.reason}</Text>
              <TouchableOpacity onPress={onClose} style={[styles.modalBtn, { backgroundColor: C.accent }]} activeOpacity={0.85}>
                <Text style={styles.modalBtnText}>Try again</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.modalBtnGhost} activeOpacity={0.7}>
                <Text style={styles.modalBtnGhostText}>Not now</Text>
              </TouchableOpacity>
            </>
          )}

          {state.kind === 'cancelled' && (
            <>
              <View style={[styles.iconCircle, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
                <Ionicons name="close-circle" size={44} color={C.muted} />
              </View>
              <Text style={styles.modalTitle}>Purchase cancelled</Text>
              <Text style={styles.modalBody}>
                No charge was made. Your selection is saved — you can subscribe anytime.
              </Text>
              <TouchableOpacity onPress={onClose} style={[styles.modalBtn, { backgroundColor: C.accent }]} activeOpacity={0.85}>
                <Text style={styles.modalBtnText}>Try again</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.modalBtnGhost} activeOpacity={0.7}>
                <Text style={styles.modalBtnGhostText}>Maybe later</Text>
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
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 22,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 28, fontWeight: '700', color: C.white, letterSpacing: 0.2, lineHeight: 34 },
  subtitle: { fontSize: 14, color: C.label, marginTop: 3, lineHeight: 19 },

  currentBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderColor: C.cardBorder,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  currentTitle: { color: C.white, fontSize: 13, fontWeight: '700' },
  currentSub: { color: C.label, fontSize: 11, marginTop: 2 },

  toggleWrap: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 5,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  toggleSeg: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 8,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
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
    marginBottom: 16,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: C.card,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
  },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  planName: { color: C.white, fontSize: 20, fontWeight: '700', letterSpacing: 0.1 },
  planPrice: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  planPeriod: { color: C.muted, fontSize: 12, fontWeight: '500', marginTop: 2 },

  featureRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  featureIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  featureText: { fontSize: 14, fontWeight: '500', lineHeight: 20, flex: 1 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 16,
    marginTop: 16,
    gap: 8,
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  planTerms: {
    color: C.muted,
    fontSize: 10.5,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 14,
  },
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 16,
    minHeight: 44,
  },
  restoreText: {
    color: C.label,
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  cancelBtn: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
  },
  cancelText: {
    color: '#FF453A',
    fontSize: 13,
    fontWeight: '700',
  },
  legal: {
    color: C.muted,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 18,
    paddingHorizontal: 20,
    lineHeight: 15,
  },
  legalLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    gap: 10,
  },
  legalLink: {
    color: C.label,
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  legalDot: { color: C.muted, fontSize: 12 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#16181B',
    borderRadius: 28,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  modalTitle: {
    color: C.white,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.2,
    lineHeight: 26,
  },
  modalBody: {
    color: C.label,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  modalBtn: {
    width: '100%',
    height: 50,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBtnText: { color: '#0B0B0B', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  modalBtnGhost: {
    width: '100%',
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  modalBtnGhostText: { color: C.label, fontSize: 15, fontWeight: '600' },
});
