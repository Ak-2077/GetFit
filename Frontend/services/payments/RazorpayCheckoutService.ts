/**
 * RazorpayCheckoutService
 * ──────────────────────────────────────────────────────────────
 * Wraps the native `react-native-razorpay` module behind a
 * platform-gated, lazy-loaded interface so the app:
 *   1. Doesn't crash on iOS (Razorpay shouldn't be used for iOS
 *      digital subscriptions — Apple rejects it).
 *   2. Doesn't crash in Expo Go where the native module is absent.
 *
 * End-to-end flow (called from upgrade.tsx):
 *   1. createOrder(planId)        → backend creates RZP order
 *   2. openCheckout(orderInfo)    → opens RZP UI, returns sigs
 *   3. verifyPayment(payload)     → backend HMAC verifies + activates
 *   4. callers refresh their useSubscription hook
 * ──────────────────────────────────────────────────────────────
 */

import { Platform } from 'react-native';
import {
  createRazorpayOrder as apiCreateOrder,
  verifyRazorpayPayment as apiVerifyPayment,
} from '../api';

export interface RazorpayOrder {
  orderId: string;
  amount: number; // paise
  currency: string;
  keyId: string;
  planId: string;
  planName: string;
  displayPrice: string;
  period: string;
}

export interface RazorpaySuccessPayload {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export type RazorpayResult =
  | { kind: 'success'; planTier: string; expiryDate: string | null }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: string };

/* ── Native module loader ───────────────────────────────────── */

let _RazorpayCheckout: any = null;
let _loadAttempted = false;

const getNativeRazorpay = (): any => {
  if (Platform.OS !== 'android') {
    // We deliberately don't load on iOS — Apple requires StoreKit
    // for digital subscriptions. iOS uses a separate flow (Phase 3).
    return null;
  }
  if (_RazorpayCheckout) return _RazorpayCheckout;
  if (_loadAttempted) return null;
  _loadAttempted = true;
  try {
    const mod = require('react-native-razorpay');
    _RazorpayCheckout = mod?.default || mod;
    return _RazorpayCheckout;
  } catch (e) {
    console.warn('[Razorpay] react-native-razorpay not installed yet:', e);
    return null;
  }
};

/* ── Public API ─────────────────────────────────────────────── */

export const isAvailable = (): boolean =>
  Platform.OS === 'android' && getNativeRazorpay() !== null;

/**
 * Step 1 — ask the backend to create a Razorpay order for this
 * plan. The backend resolves the price from server-side config,
 * so the frontend can never tamper with the amount.
 */
export const createOrder = async (planId: string): Promise<RazorpayOrder> => {
  const res = await apiCreateOrder(planId);
  const d = res.data || {};
  if (!d.orderId) {
    throw new Error(d.message || 'Failed to create payment order');
  }
  return {
    orderId: d.orderId,
    amount: d.amount,
    currency: d.currency,
    keyId: d.keyId,
    planId: d.planId,
    planName: d.planName,
    displayPrice: d.displayPrice,
    period: d.period,
  };
};

/**
 * Step 2 — open the Razorpay checkout UI. Resolves with the
 * payment signatures on success, rejects on cancel / error.
 */
export const openCheckout = async (
  order: RazorpayOrder,
  user: { name?: string; email?: string; phone?: string } = {}
): Promise<RazorpaySuccessPayload> => {
  const RazorpayCheckout = getNativeRazorpay();
  if (!RazorpayCheckout) {
    throw new Error(
      'Razorpay is unavailable on this device. Rebuild the dev client with react-native-razorpay installed.'
    );
  }

  const options: any = {
    key: order.keyId,
    order_id: order.orderId,
    amount: order.amount,
    currency: order.currency,
    name: 'GetFit',
    description: `${order.planName} — ${order.displayPrice}${order.period}`,
    image: undefined, // optional logo URL
    prefill: {
      name: user.name || '',
      email: user.email || '',
      contact: user.phone || '',
    },
    theme: { color: '#1FA463' },
  };

  // RazorpayCheckout.open returns a promise that resolves on
  // success and rejects on user cancel / network error.
  const data = await RazorpayCheckout.open(options);

  // Sanity-check the shape — the native bridge sometimes wraps
  // values in unusual ways across versions.
  if (
    !data?.razorpay_payment_id ||
    !data?.razorpay_order_id ||
    !data?.razorpay_signature
  ) {
    throw new Error('Razorpay returned an incomplete response');
  }

  return {
    razorpay_order_id: data.razorpay_order_id,
    razorpay_payment_id: data.razorpay_payment_id,
    razorpay_signature: data.razorpay_signature,
  };
};

/**
 * Step 3 — hand the signatures to the backend for HMAC verification
 * and subscription activation. The backend returns the new active
 * plan, which callers should reflect in their UI immediately.
 */
export const verifyPayment = async (
  payload: RazorpaySuccessPayload
): Promise<{ planTier: string; expiryDate: string | null }> => {
  const res = await apiVerifyPayment(payload);
  const d = res.data || {};
  if (d.status !== 'active') {
    throw new Error(d.message || 'Payment verification failed');
  }
  return {
    planTier: d.plan?.tier || 'pro',
    expiryDate: d.expiryDate || null,
  };
};

/**
 * Convenience: full create-order → checkout → verify pipeline.
 * Returns a discriminated union the UI can switch on.
 */
export const purchase = async (
  planId: string,
  user: { name?: string; email?: string; phone?: string } = {}
): Promise<RazorpayResult> => {
  try {
    const order = await createOrder(planId);
    let payload: RazorpaySuccessPayload;
    try {
      payload = await openCheckout(order, user);
    } catch (err: any) {
      // react-native-razorpay rejects with { code, description }
      // when the user cancels — treat that distinctly.
      const code = err?.code;
      if (code === 0 || /cancelled|cancelled/i.test(err?.description || '')) {
        return { kind: 'cancelled' };
      }
      return {
        kind: 'failed',
        reason: err?.description || err?.message || 'Payment failed',
      };
    }

    const verified = await verifyPayment(payload);
    return {
      kind: 'success',
      planTier: verified.planTier,
      expiryDate: verified.expiryDate,
    };
  } catch (e: any) {
    return {
      kind: 'failed',
      reason: e?.response?.data?.message || e?.message || 'Payment failed',
    };
  }
};

export default {
  isAvailable,
  createOrder,
  openCheckout,
  verifyPayment,
  purchase,
};
