# Payments Setup — GetFit

End-to-end setup for the Razorpay (Android) subscription flow. iOS Apple
IAP is planned for Phase 3 and will be added on top of this foundation.

---

## 1. Razorpay account

1. Sign up / log in at https://dashboard.razorpay.com
2. Switch to **Test Mode** (toggle top-right) for development
3. **Settings → API Keys → Generate Test Key** → copy:
   - `Key Id`     (looks like `rzp_test_XXXXXXXXXX`)
   - `Key Secret` (shown once — store safely)

## 2. Backend `.env`

Add to `Backend/.env`:

```
# ── Razorpay (Android subscriptions) ──
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_test_secret_here
# Webhook secret is optional in dev. Required for production.
RAZORPAY_WEBHOOK_SECRET=
```

Restart the Node process (`npm run dev`).

## 3. Webhook (optional in dev, recommended in prod)

1. Dashboard → **Settings → Webhooks → + Add New Webhook**
2. Webhook URL: `https://YOUR_PUBLIC_URL/api/payments/razorpay/webhook`
   - In dev, expose your local backend with ngrok: `ngrok http 5000`
3. Active events:
   - `payment.captured`
   - `payment.failed`
4. Set a **secret**, copy it into `RAZORPAY_WEBHOOK_SECRET`

## 4. Frontend native module

Razorpay's native checkout requires a custom dev client (it can't run
in plain Expo Go).

```powershell
cd Frontend
npm install react-native-razorpay
npx expo prebuild
npx expo run:android   # builds + installs the dev client
```

Then start Metro as usual:

```powershell
npx expo start --dev-client --clear
```

## 5. Test cards (Razorpay test mode)

| Type    | Number               | CVV  | Expiry  |
|---------|----------------------|------|---------|
| Success | `4111 1111 1111 1111`| any  | any future |
| Failure | `4242 4242 4242 4242`| any  | any future |

UPI test ID: `success@razorpay` (force success), `failure@razorpay` (force failure).

## 6. Verify the flow

1. Open the app → Upgrade
2. Pick a plan → Subscribe
3. Razorpay sheet opens → use a test card
4. Watch backend logs for:
   ```
   POST /api/payments/razorpay/create-order  → orderId
   POST /api/payments/razorpay/verify        → "Payment verified"
   ```
5. Open `/api/payments/subscription/status` (auth) — should return
   `{ tier: "pro", isActive: true, expiryDate: ... }`

---

## Architecture notes

- Plan price is **always** resolved server-side from `config/plans.js`.
  The frontend cannot tamper with the amount.
- Subscription rows are written as `pending` before checkout opens, so
  abandoned carts are auditable.
- Activation only happens after **HMAC SHA-256 signature verification**
  via `/api/payments/razorpay/verify`.
- The `User.subscriptionPlan` field is now a **cache** — the
  `Subscription` collection is the source of truth.
- Premium gating: use the `requirePlan('pro')` middleware on any route
  that needs a tier check. It returns `402 UPGRADE_REQUIRED` on miss.

## Production checklist

- [ ] Switch Razorpay to Live Mode + replace keys
- [ ] Configure webhook with HTTPS + secret
- [ ] Rotate `JWT_SECRET` to a strong value
- [ ] Enable rate limiting on `/api/payments/*` (e.g. `express-rate-limit`)
- [ ] Add Sentry / logging for payment failures
- [ ] Run a real end-to-end purchase from a TestFlight / internal track build
