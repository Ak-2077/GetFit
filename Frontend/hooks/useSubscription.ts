/**
 * useSubscription
 * ──────────────────────────────────────────────────────────────
 * Lightweight client-side wrapper around /api/payments/subscription/status.
 *
 * Exposes:
 *   tier            'free' | 'pro' | 'pro_plus'
 *   planId          'pro_monthly' | 'pro_yearly' | ... | null
 *   isPremium       true if tier !== 'free' AND active
 *   expiryDate      Date | null
 *   allowedFeatures string[] (server-resolved feature flags)
 *   refresh()       force a re-fetch
 *
 * IMPORTANT: callers MUST treat this as a hint only. All gating
 * decisions are also enforced server-side via requirePlan middleware.
 * ──────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getSubscriptionStatus,
  restoreSubscription as restoreApi,
} from '../services/api';

export type SubscriptionTier = 'free' | 'pro' | 'pro_plus';

export interface SubscriptionState {
  tier: SubscriptionTier;
  planId: string | null;
  billingCycle: 'monthly' | 'yearly' | null;
  expiryDate: Date | null;
  isActive: boolean;
  isPremium: boolean;
  provider: 'razorpay' | 'apple' | null;
  platform: 'android' | 'ios' | 'web' | null;
  allowedFeatures: string[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  restore: () => Promise<{ ok: boolean; message: string }>;
}

export function useSubscription(): SubscriptionState {
  const [tier, setTier] = useState<SubscriptionTier>('free');
  const [planId, setPlanId] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly' | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [provider, setProvider] = useState<'razorpay' | 'apple' | null>(null);
  const [platform, setPlatform] = useState<'android' | 'ios' | 'web' | null>(null);
  const [allowedFeatures, setAllowedFeatures] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getSubscriptionStatus();
      const d = res.data || {};
      setTier((d.tier as SubscriptionTier) || 'free');
      setPlanId(d.planId || null);
      setBillingCycle(d.billingCycle || null);
      setExpiryDate(d.expiryDate ? new Date(d.expiryDate) : null);
      setIsActive(Boolean(d.isActive));
      setProvider(d.provider || null);
      setPlatform(d.platform || null);
      setAllowedFeatures(Array.isArray(d.allowedFeatures) ? d.allowedFeatures : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to load subscription');
    } finally {
      setLoading(false);
    }
  }, []);

  const restore = useCallback(async () => {
    try {
      const res = await restoreApi();
      await refresh();
      return {
        ok: Boolean(res.data?.plan?.isActive),
        message: res.data?.message || 'Restored',
      };
    } catch (e: any) {
      return {
        ok: false,
        message: e?.response?.data?.message || e?.message || 'Restore failed',
      };
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    tier,
    planId,
    billingCycle,
    expiryDate,
    isActive,
    isPremium: tier !== 'free' && isActive,
    provider,
    platform,
    allowedFeatures,
    loading,
    error,
    refresh,
    restore,
  };
}
