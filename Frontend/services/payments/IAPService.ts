/**
 * IAPService — iOS Apple In-App Purchase wrapper
 * ─────────────────────────────────────────────────────────────
 * Mirrors the API of RazorpayCheckoutService.ts so the upgrade
 * screen can branch on Platform.OS without changing its UX.
 *
 * Why we lazy-load `react-native-iap`:
 *   • The module is iOS-only in our build (Android uses Razorpay).
 *   • If it's not bundled in the dev client (Expo Go, or before
 *     `expo prebuild`), importing it at module top-level crashes
 *     the whole app. Lazy-loading lets us gracefully report
 *     "not available" instead.
 *
 * Lifecycle (iOS purchase flow):
 *   1. init()          → opens StoreKit connection (idempotent)
 *   2. getProducts()   → fetches localized product info from Apple
 *   3. purchase(sku)   → opens native sheet, awaits user action
 *   4. <listener>      → on success, sends receipt to backend
 *   5. finishTx        → tells StoreKit it's safe to remove the tx
 *
 * Backend contract:
 *   POST /api/payments/apple/verify { receipt, productId }
 *   → 200 { subscription: { tier, expiryDate, autoRenew, ... } }
 *
 * SECURITY NOTE:
 *   The receipt is the source of truth. Even if a jailbroken client
 *   spoofs success, the backend will refuse to grant entitlement
 *   unless Apple confirms the receipt.
 * ──────────────────────────────────────────────────────────── */

import { Platform, Linking } from 'react-native';
import { verifyAppleReceipt } from '../api';

/* ---------- Module loader (lazy + safe) ---------- */

let _RNIap: any = null;
let _loadAttempted = false;

function loadRNIap(): any | null {
  if (_loadAttempted) return _RNIap;
  _loadAttempted = true;
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _RNIap = require('react-native-iap');
    return _RNIap;
  } catch (e) {
    console.warn('[IAP] react-native-iap not installed or not bundled in dev client:', (e as Error).message);
    return null;
  }
}

/* ---------- Public types ---------- */

export type IAPPurchaseResult =
  | {
      kind: 'success';
      planTier: 'pro' | 'pro_plus';
      expiryDate: string | null;
      productId: string;
    }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: string };

export interface IAPProduct {
  productId: string;
  title: string;
  description: string;
  localizedPrice: string;
  currency: string;
}

/* ---------- Internal state ---------- */

let _initialized = false;
let _purchaseUpdatedSub: { remove: () => void } | null = null;
let _purchaseErrorSub: { remove: () => void } | null = null;

/* ---------- Service ---------- */

const IAPService = {
  /** True only when iOS + native module is bundled. */
  isAvailable(): boolean {
    return Platform.OS === 'ios' && loadRNIap() != null;
  },

  /**
   * Open the StoreKit connection. Safe to call multiple times.
   * No-ops on Android.
   */
  async init(): Promise<boolean> {
    if (!IAPService.isAvailable()) return false;
    if (_initialized) return true;

    const RNIap = loadRNIap();
    try {
      await RNIap.initConnection();
      // Clear any pending transactions left over from a previous crash.
      // Required on iOS to avoid "transaction already pending" errors.
      try { await RNIap.flushFailedPurchasesCachedAsPendingAndroid?.(); } catch {}
      try { await RNIap.clearTransactionIOS?.(); } catch {}
      _initialized = true;
      console.log('[IAP] connection initialized');
      return true;
    } catch (e) {
      console.warn('[IAP] init failed:', (e as Error).message);
      return false;
    }
  },

  /**
   * Fetch localized product metadata from Apple for the given SKUs.
   * The SKUs MUST be auto-renewable subscriptions in the same group
   * (configured in App Store Connect).
   */
  async getProducts(skus: string[]): Promise<IAPProduct[]> {
    if (!(await IAPService.init())) return [];
    const RNIap = loadRNIap();
    try {
      const products = await RNIap.getSubscriptions({ skus });
      return (products || []).map((p: any) => ({
        productId: p.productId,
        title: p.title || p.productId,
        description: p.description || '',
        localizedPrice: p.localizedPrice || p.price || '',
        currency: p.currency || 'USD',
      }));
    } catch (e) {
      console.warn('[IAP] getProducts failed:', (e as Error).message);
      return [];
    }
  },

  /**
   * Run the full purchase pipeline:
   *   1. Open StoreKit native sheet
   *   2. Wait for user to complete (or cancel)
   *   3. Send receipt to backend
   *   4. Tell StoreKit to finish the transaction
   *   5. Return a normalized result
   */
  async purchase(productId: string): Promise<IAPPurchaseResult> {
    if (!IAPService.isAvailable()) {
      return { kind: 'failed', reason: 'In-App Purchase not available on this device' };
    }
    if (!(await IAPService.init())) {
      return { kind: 'failed', reason: 'Could not connect to App Store' };
    }

    const RNIap = loadRNIap();

    // We attach listeners specifically for this purchase so concurrent
    // purchases (which iOS doesn't allow anyway) don't race.
    return new Promise<IAPPurchaseResult>(async (resolve) => {
      let resolved = false;
      const finish = (r: IAPPurchaseResult) => {
        if (resolved) return;
        resolved = true;
        try { _purchaseUpdatedSub?.remove(); } catch {}
        try { _purchaseErrorSub?.remove(); } catch {}
        _purchaseUpdatedSub = null;
        _purchaseErrorSub = null;
        resolve(r);
      };

      // Listener 1: successful purchase
      _purchaseUpdatedSub = RNIap.purchaseUpdatedListener(async (purchase: any) => {
        try {
          const receipt = purchase.transactionReceipt;
          if (!receipt) {
            finish({ kind: 'failed', reason: 'Empty receipt from StoreKit' });
            return;
          }

          // Send to backend for verification
          const res = await verifyAppleReceipt({
            receipt,
            productId: purchase.productId || productId,
          });

          // Acknowledge the transaction so StoreKit clears it
          await RNIap.finishTransaction({ purchase, isConsumable: false });

          const sub = res.data?.subscription;
          finish({
            kind: 'success',
            planTier: sub?.tier === 'pro_plus' ? 'pro_plus' : 'pro',
            expiryDate: sub?.expiryDate || null,
            productId: purchase.productId || productId,
          });
        } catch (e: any) {
          // If backend verification fails, DON'T finish the tx — let
          // StoreKit retry on next launch. Apple will keep posting it
          // until we finishTransaction.
          finish({
            kind: 'failed',
            reason: e?.response?.data?.message || e?.message || 'Verification failed',
          });
        }
      });

      // Listener 2: error / user cancel
      _purchaseErrorSub = RNIap.purchaseErrorListener((err: any) => {
        // Apple's E_USER_CANCELLED code
        if (err?.code === 'E_USER_CANCELLED') {
          finish({ kind: 'cancelled' });
        } else {
          finish({ kind: 'failed', reason: err?.message || 'Purchase failed' });
        }
      });

      // Open the native sheet
      try {
        await RNIap.requestSubscription({
          sku: productId,
          // For an initial purchase Apple ignores andDangerouslyFinishTransactionAutomaticallyIOS
          // We finish manually after backend verifies.
          andDangerouslyFinishTransactionAutomaticallyIOS: false,
        });
      } catch (e) {
        finish({ kind: 'failed', reason: (e as Error).message });
      }
    });
  },

  /**
   * Restore previously-purchased subscriptions. Apple recommends
   * exposing this as an explicit user action.
   * Returns true if at least one active sub was found AND verified.
   */
  async restore(): Promise<{ ok: boolean; message: string }> {
    if (!IAPService.isAvailable()) {
      return { ok: false, message: 'In-App Purchase not available' };
    }
    if (!(await IAPService.init())) {
      return { ok: false, message: 'Could not connect to App Store' };
    }
    const RNIap = loadRNIap();
    try {
      const purchases = await RNIap.getAvailablePurchases();
      if (!purchases?.length) {
        return { ok: false, message: 'No previous purchases found' };
      }

      // Find the most recent transactionDate across the array
      const latest = purchases.reduce((a: any, b: any) =>
        Number(b.transactionDate || 0) > Number(a.transactionDate || 0) ? b : a
      );
      const receipt = latest.transactionReceipt;
      if (!receipt) {
        return { ok: false, message: 'No receipt available' };
      }

      const res = await verifyAppleReceipt({
        receipt,
        productId: latest.productId,
      });
      const sub = res.data?.subscription;
      if (!sub) return { ok: false, message: 'Verification returned no subscription' };

      return { ok: true, message: 'Subscription restored' };
    } catch (e: any) {
      return {
        ok: false,
        message: e?.response?.data?.message || e?.message || 'Restore failed',
      };
    }
  },

  /**
   * iOS does NOT allow apps to cancel subscriptions directly.
   * App Store Review will reject any in-app cancel UI for IAP.
   * We deep-link to the user's subscriptions page in Settings instead.
   * (Spotify, Netflix, YouTube all do this.)
   */
  openManageSubscriptions(): Promise<void> {
    return Linking.openURL('https://apps.apple.com/account/subscriptions');
  },

  /** Tear down listeners (e.g. on logout). */
  async dispose(): Promise<void> {
    if (!_initialized) return;
    try { _purchaseUpdatedSub?.remove(); } catch {}
    try { _purchaseErrorSub?.remove(); } catch {}
    _purchaseUpdatedSub = null;
    _purchaseErrorSub = null;
    const RNIap = loadRNIap();
    try { await RNIap?.endConnection?.(); } catch {}
    _initialized = false;
  },
};

export default IAPService;
