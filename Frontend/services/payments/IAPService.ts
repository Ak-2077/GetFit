/**
 * IAPService — iOS Apple In-App Purchase wrapper (expo-iap)
 * ─────────────────────────────────────────────────────────────
 * Why expo-iap (not react-native-iap):
 *   react-native-iap v12 has a broken Podspec on RN 0.81 + new
 *   architecture (it still references the old `RCT-Folly` pod).
 *   expo-iap is by the same author (hyochan), works with Expo
 *   SDK 54 + new arch, and has a cleaner API.
 *
 * Why we lazy-load:
 *   • iOS-only module (Android uses Razorpay).
 *   • If the user runs Expo Go (no native modules bundled), a
 *     top-level import would crash the whole app. Lazy-load lets
 *     us gracefully degrade.
 *
 * Lifecycle:
 *   1. init()          → opens StoreKit connection (idempotent)
 *   2. getProducts()   → fetches localized info from Apple
 *   3. purchase(sku)   → opens native sheet, awaits user action
 *   4. <listener>      → on success, sends receipt to backend
 *   5. finishTx        → tells StoreKit the tx is acknowledged
 *
 * Backend contract:
 *   POST /api/payments/apple/verify { receipt, productId }
 *   → 200 { subscription: { tier, expiryDate, autoRenew, ... } }
 *
 * SECURITY:
 *   The receipt is the source of truth. Even if a jailbroken
 *   client spoofs success, the backend rejects the entitlement
 *   unless Apple confirms the receipt.
 * ──────────────────────────────────────────────────────────── */

import { Platform, Linking } from 'react-native';
import { verifyAppleReceipt } from '../api';

/* ---------- Module loader (lazy + safe) ---------- */

let _IAP: any = null;
let _loadAttempted = false;

function loadIAP(): any | null {
  if (_loadAttempted) return _IAP;
  _loadAttempted = true;
  if (Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _IAP = require('expo-iap');
    return _IAP;
  } catch (e) {
    console.warn('[IAP] expo-iap not bundled in this build:', (e as Error).message);
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
  /** True only when iOS + native module bundled. */
  isAvailable(): boolean {
    return Platform.OS === 'ios' && loadIAP() != null;
  },

  /** Open StoreKit connection. Idempotent. No-op on Android. */
  async init(): Promise<boolean> {
    if (!IAPService.isAvailable()) return false;
    if (_initialized) return true;

    const IAP = loadIAP();
    try {
      await IAP.initConnection();
      // Clear any stuck transactions from a previous crash.
      try { await IAP.clearTransactionIOS?.(); } catch {}
      _initialized = true;
      console.log('[IAP] connection initialized');
      return true;
    } catch (e) {
      console.warn('[IAP] init failed:', (e as Error).message);
      return false;
    }
  },

  /**
   * Fetch product metadata from Apple. SKUs MUST be auto-renewable
   * subscriptions in the same group (configured in App Store Connect).
   */
  async getProducts(skus: string[]): Promise<IAPProduct[]> {
    if (!(await IAPService.init())) return [];
    const IAP = loadIAP();
    try {
      // expo-iap v2.x: fetchProducts replaces getSubscriptions/getProducts.
      const products = await IAP.fetchProducts({ skus, type: 'subs' });
      return (products || []).map((p: any) => ({
        productId: p.productId || p.id,
        title: p.title || p.productId || p.id,
        description: p.description || '',
        localizedPrice: p.localizedPrice || p.displayPrice || p.price || '',
        currency: p.currency || p.currencyCode || 'USD',
      }));
    } catch (e) {
      console.warn('[IAP] getProducts failed:', (e as Error).message);
      return [];
    }
  },

  /**
   * Full purchase pipeline:
   *   1. Open StoreKit native sheet
   *   2. User authenticates (Face ID / Touch ID)
   *   3. expo-iap fires purchaseUpdatedListener
   *   4. Send receipt to backend for Apple verifyReceipt
   *   5. finishTransaction so StoreKit clears the tx
   */
  async purchase(productId: string): Promise<IAPPurchaseResult> {
    if (!IAPService.isAvailable()) {
      return { kind: 'failed', reason: 'In-App Purchase not available on this device' };
    }
    if (!(await IAPService.init())) {
      return { kind: 'failed', reason: 'Could not connect to App Store' };
    }

    const IAP = loadIAP();

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

      // Listener 1 — successful purchase
      _purchaseUpdatedSub = IAP.purchaseUpdatedListener(async (purchase: any) => {
        try {
          // expo-iap exposes the receipt at one of these fields depending on platform
          const receipt =
            purchase.transactionReceipt ||
            purchase.purchaseToken ||
            purchase.jwsRepresentationIos;

          if (!receipt) {
            finish({ kind: 'failed', reason: 'Empty receipt from StoreKit' });
            return;
          }

          // Backend round-trips to Apple verifyReceipt
          const res = await verifyAppleReceipt({
            receipt,
            productId: purchase.productId || purchase.id || productId,
          });

          // Acknowledge so StoreKit clears the transaction
          await IAP.finishTransaction({ purchase, isConsumable: false });

          const sub = res.data?.subscription;
          finish({
            kind: 'success',
            planTier: sub?.tier === 'pro_plus' ? 'pro_plus' : 'pro',
            expiryDate: sub?.expiryDate || null,
            productId: purchase.productId || purchase.id || productId,
          });
        } catch (e: any) {
          // Don't finish the tx on backend failure — Apple will
          // retry on next launch until we acknowledge.
          finish({
            kind: 'failed',
            reason: e?.response?.data?.message || e?.message || 'Verification failed',
          });
        }
      });

      // Listener 2 — error / user cancel
      _purchaseErrorSub = IAP.purchaseErrorListener((err: any) => {
        if (err?.code === 'E_USER_CANCELLED' || err?.responseCode === 2) {
          finish({ kind: 'cancelled' });
        } else {
          finish({ kind: 'failed', reason: err?.message || 'Purchase failed' });
        }
      });

      // Open native StoreKit sheet (expo-iap v2 API)
      try {
        await IAP.requestPurchase({
          request: {
            ios: { sku: productId },
            android: { skus: [productId] },
          },
          type: 'subs',
        });
      } catch (e) {
        finish({ kind: 'failed', reason: (e as Error).message });
      }
    });
  },

  /**
   * Restore previous subscriptions. Apple requires a "Restore" button
   * on the paywall — App Review will reject without it.
   */
  async restore(): Promise<{ ok: boolean; message: string }> {
    if (!IAPService.isAvailable()) {
      return { ok: false, message: 'In-App Purchase not available' };
    }
    if (!(await IAPService.init())) {
      return { ok: false, message: 'Could not connect to App Store' };
    }
    const IAP = loadIAP();
    try {
      // expo-iap v2.x: restorePurchases is the cross-platform helper.
      const purchases = await IAP.restorePurchases();
      if (!purchases?.length) {
        return { ok: false, message: 'No previous purchases found' };
      }

      // Use the most recent transaction
      const latest = purchases.reduce((a: any, b: any) =>
        Number(b.transactionDate || 0) > Number(a.transactionDate || 0) ? b : a
      );
      const receipt =
        latest.transactionReceipt ||
        latest.purchaseToken ||
        latest.jwsRepresentationIos;
      if (!receipt) {
        return { ok: false, message: 'No receipt available' };
      }

      const res = await verifyAppleReceipt({
        receipt,
        productId: latest.productId || latest.id,
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
   * iOS does NOT allow apps to cancel subs in-app. App Review will
   * reject any UI that does. Deep-link to Apple's subscriptions page.
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
    const IAP = loadIAP();
    try { await IAP?.endConnection?.(); } catch {}
    _initialized = false;
  },
};

export default IAPService;
