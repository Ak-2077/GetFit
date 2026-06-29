/**
 * Google Play Billing Service
 * ──────────────────────────────────────────────────────────────
 * Server-side verification of Google Play purchase tokens using
 * the Android Publisher API (v3).
 *
 * Requires a Google Cloud service account with the
 * "Android Publisher" API enabled and linked to the Google Play
 * Console app. The service account JSON key path should be set
 * in the environment variable GOOGLE_SERVICE_ACCOUNT_PATH.
 *
 * If the service account is not configured, the service
 * gracefully degrades (returns a 503-style error) so the app
 * doesn't crash during development.
 *
 * SECURITY:
 *   • Never trust the client-supplied productId — always use
 *     the one returned by Google's API.
 *   • Never log purchase tokens.
 * ──────────────────────────────────────────────────────────────
 */

import fs from 'fs';

const PACKAGE_NAME = 'com.getfit.fitness';

/* ── Service account loader ──────────────────────────────── */

let _authClient = null;
let _loadAttempted = false;

/**
 * Whether Google Play verification is configured.
 */
export const isGooglePlayConfigured = () => {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  return Boolean(keyPath && fs.existsSync(keyPath));
};

/**
 * Lazily load the Google auth client from the service account JSON.
 * Uses the googleapis npm package if available, falls back to
 * manual JWT auth otherwise.
 */
const getAuthClient = async () => {
  if (_authClient) return _authClient;
  if (_loadAttempted) return null;
  _loadAttempted = true;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  if (!keyPath || !fs.existsSync(keyPath)) {
    console.warn('[GooglePlay] Service account not configured. Set GOOGLE_SERVICE_ACCOUNT_PATH in .env');
    return null;
  }

  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    _authClient = await auth.getClient();
    console.log('[GooglePlay] Service account loaded successfully');
    return _authClient;
  } catch (e) {
    console.warn('[GooglePlay] Failed to load service account:', e.message);
    return null;
  }
};

/* ── Purchase verification ───────────────────────────────── */

/**
 * Verify a Google Play subscription purchase token.
 *
 * Calls GET https://androidpublisher.googleapis.com/androidpublisher/v3/
 *   applications/{packageName}/purchases/subscriptionsv2/tokens/{token}
 *
 * @param {string} purchaseToken - The purchase token from the client
 * @returns {Promise<{
 *   productId: string,
 *   orderId: string,
 *   expiryDate: Date,
 *   startDate: Date,
 *   isAutoRenewing: boolean,
 *   purchaseState: number,
 *   acknowledgementState: number,
 * }>}
 */
export const verifySubscription = async (purchaseToken) => {
  const auth = await getAuthClient();
  if (!auth) {
    throw new Error('Google Play verification not configured. Set GOOGLE_SERVICE_ACCOUNT_PATH.');
  }

  const { google } = await import('googleapis');
  const androidPublisher = google.androidpublisher({ version: 'v3', auth });

  // Use subscriptionsv2.get for the modern Google Play Billing Library 5+
  const response = await androidPublisher.purchases.subscriptionsv2.get({
    packageName: PACKAGE_NAME,
    token: purchaseToken,
  });

  const data = response.data;

  if (!data) {
    throw new Error('Empty response from Google Play API');
  }

  // Extract the subscription line item (first one for single-product subscriptions)
  const lineItem = data.lineItems?.[0];
  if (!lineItem) {
    throw new Error('No subscription line items in Google Play response');
  }

  const productId = lineItem.productId;
  const expiryTime = lineItem.expiryTime;
  const autoRenewing = lineItem.autoRenewingPlan?.autoRenewEnabled ?? false;

  return {
    productId,
    orderId: data.latestOrderId || data.orderId || null,
    expiryDate: expiryTime ? new Date(expiryTime) : null,
    startDate: data.startTime ? new Date(data.startTime) : new Date(),
    isAutoRenewing: autoRenewing,
    // subscriptionState: SUBSCRIPTION_STATE_ACTIVE = 3
    isActive: data.subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE',
    acknowledgementState: data.acknowledgementState || 'ACKNOWLEDGEMENT_STATE_PENDING',
    environment: data.testPurchase ? 'sandbox' : 'production',
  };
};

/**
 * Acknowledge a subscription purchase (required within 3 days
 * of purchase or Google will refund it automatically).
 */
export const acknowledgeSubscription = async (purchaseToken, subscriptionId) => {
  const auth = await getAuthClient();
  if (!auth) return; // Non-critical — the client-side acknowledge is sufficient

  try {
    const { google } = await import('googleapis');
    const androidPublisher = google.androidpublisher({ version: 'v3', auth });

    await androidPublisher.purchases.subscriptions.acknowledge({
      packageName: PACKAGE_NAME,
      subscriptionId,
      token: purchaseToken,
    });
  } catch (e) {
    // Non-fatal — the client should also acknowledge
    console.warn('[GooglePlay] acknowledge failed:', e.message);
  }
};

export default {
  isGooglePlayConfigured,
  verifySubscription,
  acknowledgeSubscription,
};
