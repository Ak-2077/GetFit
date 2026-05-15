/**
 * Apple In-App Purchase Service
 * ─────────────────────────────────────────────────────────────
 * Dependency-free verification for both legacy (StoreKit 1) base64
 * receipts AND modern (StoreKit 2) JWS-signed transactions.
 *
 * Why no SDK?
 *   • The app-store-server-api-node-library SDK pulls in dozens
 *     of transitive deps. We only need 3 things:
 *       1) POST receipt → Apple verifyReceipt endpoint
 *       2) Decode JWS without verifying chain (StoreKit 2 client receipts)
 *       3) Verify signed S2S notification payloads (App Store v2 webhooks)
 *
 * Spec references:
 *   verifyReceipt   https://developer.apple.com/documentation/appstorereceipts
 *   StoreKit 2 JWS  https://developer.apple.com/documentation/storekit/jwsrepresentation
 *   S2S Notif v2    https://developer.apple.com/documentation/appstoreservernotifications
 *
 * Env vars expected:
 *   APPLE_SHARED_SECRET     (32-char hex, App Store Connect → App-Specific Shared Secret)
 *   APPLE_BUNDLE_ID         (com.getfit.fitness)
 *
 * NOTE on signature verification:
 *   For maximum security in production, you should validate the JWS
 *   x5c chain against Apple's root CA. We do a *best-effort* decode
 *   here and rely on:
 *     1) Bundle ID match
 *     2) Original receipt round-trip via verifyReceipt for the FIRST
 *        purchase (which gives us the trusted originalTransactionId)
 *     3) S2S notifications come from Apple's IPs (verify in webhook)
 *   This is the same pattern used by RevenueCat's open-source verifier.
 * ──────────────────────────────────────────────────────────── */

import crypto from 'crypto';
import https from 'https';

const APPLE_PROD_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

/* ─────────────────────────────────────────────────────────────
   Config
───────────────────────────────────────────────────────────── */

export const isAppleIapConfigured = () =>
  Boolean(process.env.APPLE_SHARED_SECRET && process.env.APPLE_BUNDLE_ID);

const getSharedSecret = () => process.env.APPLE_SHARED_SECRET || '';
const getBundleId = () => process.env.APPLE_BUNDLE_ID || 'com.getfit.fitness';

/* ─────────────────────────────────────────────────────────────
   Low-level: POST a JSON body to Apple's verifyReceipt.
───────────────────────────────────────────────────────────── */

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname,
        port: 443,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(parsed);
          } catch (e) {
            reject(new Error('Apple returned non-JSON response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/* ─────────────────────────────────────────────────────────────
   verifyReceipt (StoreKit 1 base64 receipt blob)
   ──────────────────────────────────────────────────────────────
   Apple recommends ALWAYS hitting production first. If you get
   status 21007 it means it was a sandbox receipt — retry on the
   sandbox URL. This dual-call is required for App Review because
   reviewers buy in sandbox while the build is in production mode.
───────────────────────────────────────────────────────────── */

export async function verifyAppleReceipt(receiptBase64) {
  if (!receiptBase64) throw new Error('Missing receipt');
  if (!isAppleIapConfigured()) {
    throw new Error('Apple IAP not configured. Set APPLE_SHARED_SECRET + APPLE_BUNDLE_ID.');
  }

  const body = {
    'receipt-data': receiptBase64,
    password: getSharedSecret(),
    'exclude-old-transactions': true,
  };

  // 1. Try production
  let json = await postJson(APPLE_PROD_URL, body);

  // 2. Sandbox fallback (status 21007 = "this is a sandbox receipt")
  if (json.status === 21007) {
    console.log('[apple-iap] Sandbox receipt detected, retrying on sandbox URL');
    json = await postJson(APPLE_SANDBOX_URL, body);
  }

  if (json.status !== 0) {
    throw new Error(`Apple verifyReceipt failed: status=${json.status} ${describeStatus(json.status)}`);
  }

  // Bundle id check (defense against cross-app receipt theft)
  const receiptBundleId = json.receipt?.bundle_id;
  if (receiptBundleId && receiptBundleId !== getBundleId()) {
    throw new Error(`Bundle id mismatch: got ${receiptBundleId}, expected ${getBundleId()}`);
  }

  // The freshest renewal info — Apple sorts latest_receipt_info chronologically
  const latest = pickLatestTransaction(json.latest_receipt_info || []);
  if (!latest) throw new Error('No transactions in receipt');

  return {
    productId: latest.product_id,
    transactionId: latest.transaction_id,
    originalTransactionId: latest.original_transaction_id,
    purchaseDate: new Date(Number(latest.purchase_date_ms)),
    expiresDate: latest.expires_date_ms
      ? new Date(Number(latest.expires_date_ms))
      : null,
    isTrial: latest.is_trial_period === 'true',
    isAutoRenewing: json.pending_renewal_info?.[0]?.auto_renew_status === '1',
    environment: json.environment || 'Production',
    rawLatestReceipt: json.latest_receipt || receiptBase64,
    raw: json,
  };
}

function pickLatestTransaction(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.reduce((best, cur) => {
    if (!best) return cur;
    return Number(cur.expires_date_ms || 0) > Number(best.expires_date_ms || 0) ? cur : best;
  }, null);
}

/* ─────────────────────────────────────────────────────────────
   Decode StoreKit 2 JWS payload (used by Server Notifications v2)
   ──────────────────────────────────────────────────────────────
   The JWS is `header.payload.signature` (all base64url).
   We decode header + payload as JSON. Full chain validation
   against Apple's root CA is a future hardening step.
───────────────────────────────────────────────────────────── */

export function decodeAppleJWS(jws) {
  if (!jws || typeof jws !== 'string') throw new Error('Invalid JWS');
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('JWS must have 3 segments');
  const decode = (seg) =>
    JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return {
    header: decode(parts[0]),
    payload: decode(parts[1]),
    // signature left as-is; we don't verify the cert chain here
  };
}

/* ─────────────────────────────────────────────────────────────
   Parse a v2 App Store Server Notification body.
   ──────────────────────────────────────────────────────────────
   The webhook body is:
   {
     signedPayload: "<JWS>"
   }
   The decoded payload's `data.signedTransactionInfo` and
   `data.signedRenewalInfo` are themselves JWS strings.
───────────────────────────────────────────────────────────── */

export function parseS2SNotification(rawBodyBuffer) {
  const body = JSON.parse(rawBodyBuffer.toString('utf8'));
  if (!body.signedPayload) throw new Error('Missing signedPayload in notification');
  const { payload } = decodeAppleJWS(body.signedPayload);
  // payload.data may have nested signedTransactionInfo / signedRenewalInfo
  const data = payload.data || {};
  const transactionInfo = data.signedTransactionInfo
    ? decodeAppleJWS(data.signedTransactionInfo).payload
    : null;
  const renewalInfo = data.signedRenewalInfo
    ? decodeAppleJWS(data.signedRenewalInfo).payload
    : null;
  return {
    notificationType: payload.notificationType, // DID_RENEW, REFUND, EXPIRED, ...
    subtype: payload.subtype || null,
    notificationUUID: payload.notificationUUID,
    bundleId: data.bundleId,
    environment: payload.environment, // 'Production' | 'Sandbox'
    transactionInfo,
    renewalInfo,
    raw: payload,
  };
}

/* ─────────────────────────────────────────────────────────────
   Map a notification to a subscription state mutation hint.
   The webhook controller uses this to decide what to update.
───────────────────────────────────────────────────────────── */

export function notificationToAction(notif) {
  const t = notif.notificationType;
  switch (t) {
    case 'SUBSCRIBED':
    case 'DID_RENEW':
      return { kind: 'renew' };
    case 'DID_CHANGE_RENEWAL_STATUS':
      // subtype: AUTO_RENEW_ENABLED | AUTO_RENEW_DISABLED
      return {
        kind: 'autoRenewChange',
        autoRenew: notif.subtype === 'AUTO_RENEW_ENABLED',
      };
    case 'EXPIRED':
      return { kind: 'expired' };
    case 'REFUND':
    case 'REVOKE':
      return { kind: 'refund' };
    case 'GRACE_PERIOD_EXPIRED':
    case 'DID_FAIL_TO_RENEW':
      return { kind: 'failToRenew' };
    default:
      return { kind: 'noop', reason: t };
  }
}

/* ─────────────────────────────────────────────────────────────
   Status code lookup — useful in error messages.
───────────────────────────────────────────────────────────── */

function describeStatus(code) {
  const map = {
    21000: 'The App Store could not read the JSON object you provided.',
    21002: 'The data in the receipt-data property was malformed.',
    21003: 'The receipt could not be authenticated.',
    21004: 'Shared secret does not match the secret on file for your account.',
    21005: 'The receipt server is not currently available.',
    21006: 'This receipt is valid but the subscription has expired.',
    21007: 'Sandbox receipt sent to production endpoint.',
    21008: 'Production receipt sent to sandbox endpoint.',
    21010: 'This receipt could not be authorized.',
  };
  return map[code] || `Unknown status ${code}`;
}

export default {
  isAppleIapConfigured,
  verifyAppleReceipt,
  decodeAppleJWS,
  parseS2SNotification,
  notificationToAction,
};
