/**
 * Razorpay Service
 * ──────────────────────────────────────────────────────────────
 * Thin, dependency-free wrapper around Razorpay's REST API.
 *   • createOrder()       — POST /v1/orders
 *   • verifyPaymentSig()  — HMAC-SHA256 of "{orderId}|{paymentId}"
 *   • verifyWebhookSig()  — HMAC-SHA256 of raw body
 *
 * We deliberately avoid the official `razorpay` npm package to
 * keep the dependency surface small. All requests use Basic Auth
 * with KEY_ID:KEY_SECRET.
 *
 * Required env vars:
 *   RAZORPAY_KEY_ID
 *   RAZORPAY_KEY_SECRET
 *   RAZORPAY_WEBHOOK_SECRET   (optional; only if webhooks enabled)
 * ──────────────────────────────────────────────────────────────
 */

import crypto from 'crypto';

const RZP_BASE = 'https://api.razorpay.com/v1';

const getKeys = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      'Razorpay keys missing — set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in .env'
    );
  }
  return { keyId, keySecret };
};

/**
 * Whether Razorpay is configured (used to short-circuit endpoints
 * with a clean 503 in dev environments).
 */
export const isRazorpayConfigured = () =>
  Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

/**
 * Public, frontend-safe key id (never the secret).
 */
export const getPublicKeyId = () => process.env.RAZORPAY_KEY_ID || null;

/* ── Order creation ─────────────────────────────────────────── */

/**
 * Create a Razorpay order.
 *
 * @param {Object} params
 * @param {number} params.amount   — amount in paise
 * @param {string} params.currency — e.g. "INR"
 * @param {string} params.receipt  — your internal id (≤ 40 chars)
 * @param {Object} [params.notes]  — arbitrary key-value metadata
 * @returns {Promise<{ id: string, amount: number, currency: string, status: string }>}
 */
export const createOrder = async ({ amount, currency = 'INR', receipt, notes = {} }) => {
  const { keyId, keySecret } = getKeys();

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('createOrder: amount must be a positive integer (paise)');
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const res = await fetch(`${RZP_BASE}/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount,
      currency,
      receipt: receipt?.slice(0, 40),
      notes,
      payment_capture: 1,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.description || body?.message || `HTTP ${res.status}`;
    throw new Error(`Razorpay createOrder failed: ${msg}`);
  }
  return body;
};

/* ── Signature verification ─────────────────────────────────── */

/**
 * Verify the signature returned by Razorpay Checkout after a
 * successful payment.
 *
 * Per Razorpay docs:
 *   expected = HMAC_SHA256(orderId + "|" + paymentId, KEY_SECRET)
 *
 * @returns {boolean} true ⇔ signature is valid
 */
export const verifyPaymentSignature = ({
  razorpay_order_id,
  razorpay_payment_id,
  razorpay_signature,
}) => {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return false;
  }
  const { keySecret } = getKeys();
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  // Constant-time compare to defeat timing attacks.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(razorpay_signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

/**
 * Verify a Razorpay webhook payload using the configured webhook
 * secret. The caller must pass the **raw** request body — re-
 * stringifying req.body will mutate whitespace and break the HMAC.
 *
 * @param {Buffer|string} rawBody    — exact body bytes Razorpay sent
 * @param {string} signatureHeader   — value of x-razorpay-signature
 */
export const verifyWebhookSignature = (rawBody, signatureHeader) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

/* ── Misc ───────────────────────────────────────────────────── */

/**
 * Fetch a payment by id (for reconciliation / refunds).
 */
export const fetchPayment = async (paymentId) => {
  const { keyId, keySecret } = getKeys();
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const res = await fetch(`${RZP_BASE}/payments/${paymentId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.description || `Razorpay fetchPayment ${res.status}`);
  }
  return body;
};

export default {
  isRazorpayConfigured,
  getPublicKeyId,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  fetchPayment,
};
