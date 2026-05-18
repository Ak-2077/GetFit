# iOS In-App Purchase (Apple IAP) Setup Guide

This guide walks through everything needed to enable Apple StoreKit
subscriptions for GetFit. Companion to `PAYMENTS_SETUP.md` (Razorpay
for Android).

---

## 0. Prerequisites

- ✅ **Apple Developer Program membership** ($99/year, paid)
- ✅ **macOS machine with Xcode 15+** (required for iOS builds — Windows can do
  the App Store Connect side, but the build itself needs a Mac or EAS Build)
- ✅ **Bundle ID `com.getfit.fitness`** registered in your Apple Developer
  account (already in `Frontend/app.json`)

---

## 1. Apple Developer Portal — capabilities

Go to **[developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles → Identifiers**.

1. Click your `com.getfit.fitness` App ID.
2. **Capabilities** tab → enable:
   - ☑ **In-App Purchase**
   - ☑ **HealthKit** (already on)
   - ☑ **Sign In with Apple** (already on)
3. Save. Provisioning profiles regenerate automatically.

---

## 2. App Store Connect — banking & tax (CRITICAL)

> ⚠ **No banking = no IAP.** Skip this and your products will sit in
> "Developer Action Needed" forever.

[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Agreements, Tax, and Banking**.

1. **Paid Apps** agreement → click **Set Up** if pending → e-sign.
2. **Banking** → add your business / personal bank account.
3. **Tax** → fill the relevant form:
   - US: W-9
   - Non-US (India etc.): W-8BEN
4. Wait for the agreement status to flip to **Active** (1–2 business days).

---

## 3. App Store Connect — create the IAP products

Go to **My Apps → GetFit → Features → Subscriptions**.

### 3a. Create the subscription group

Click **Create** → name it `getfit_premium`. All four products live inside
this single group so users can switch between them with proration handled
by Apple automatically (Spotify / YouTube model).

### 3b. Create the four auto-renewable subscriptions

| Reference name | Product ID | Duration | Price (Tier) | Level |
|---|---|---|---|---|
| Pro Monthly | `com.getfit.fitness.pro.monthly` | 1 Month | Tier 5 (~₹199 in IN) | **2** |
| Pro Yearly | `com.getfit.fitness.pro.yearly` | 1 Year | Tier 17 (~₹1,990) | **2** |
| Pro+ Monthly | `com.getfit.fitness.proplus.monthly` | 1 Month | Tier 9 (~₹399) | **1** |
| Pro+ Yearly | `com.getfit.fitness.proplus.yearly` | 1 Year | Tier 33 (~₹3,990) | **1** |

> Higher level number = lower priority in Apple's terminology.
> **Pro+ is Level 1 (highest)**, Pro is Level 2.

For **EACH** product, fill out:

- **Display Name** (localized) — required, blocks submission otherwise
- **Description** (localized) — required
- **Review Information → Screenshot** — at least 640×920 PNG showing the
  paywall with this product visible. Apple **rejects** without this.
- **Review Notes** — paste:
  ```
  This is an auto-renewable subscription that unlocks AI-powered
  workout planning and diet recommendations inside the GetFit fitness
  tracking app. Test with sandbox account: <your sandbox email>.
  ```

### 3c. Generate the App-Specific Shared Secret (legacy verifyReceipt)

App page → **App Information → App-Specific Shared Secret → Generate**.
Copy the 32-char hex string. Save as `APPLE_SHARED_SECRET` in your backend
`.env`.

### 3d. (Optional but recommended) App Store Server API Key (StoreKit 2)

**Users and Access → Integrations → App Store Server → Keys → Generate**.

- Name: `GetFit Backend`
- Access: `Customer Communications`
- Download the `.p8` file (you can only download ONCE)
- Save **Key ID**, **Issuer ID**, and the `.p8` contents → backend `.env`:
  ```
  APPLE_API_KEY_ID=<key id>
  APPLE_API_ISSUER_ID=<issuer id>
  APPLE_API_PRIVATE_KEY=<paste full .p8 contents, multi-line ok>
  ```
  (Currently the codebase uses verifyReceipt + JWS decode without
  full chain validation — the API key isn't strictly required, but
  having it ready means future hardening only needs a code change.)

### 3e. App Store Server Notifications v2 (S2S webhook)

App page → **App Information → App Store Server Notifications**.

- **Production Server URL**: `https://your-domain.com/api/payments/apple/webhook`
- **Sandbox Server URL**: same path on staging
- **Version**: **Version 2** (JWS signed) — NOT v1
- Save.

Apple will POST renewal / refund / cancel events here. Without this,
the backend will not know when subscriptions renew or get refunded.

### 3f. Sandbox tester accounts

**Users and Access → Sandbox Testers → "+"**.

- Email: a fresh address that has **never** been an Apple ID (e.g.
  `getfit-test-1@yourdomain.com` — use a Gmail "+" alias)
- Password: any
- Region: India (or your test region)

On the iPhone for testing:

1. Settings → **App Store** → sign OUT of regular Apple ID
2. Build & run the dev client on the device
3. Tap "Subscribe" → StoreKit prompts → sign in with the **sandbox** tester
4. Sandbox subscriptions renew at accelerated speeds (1 month = 5 minutes,
   1 year = 1 hour) — perfect for testing renewals.

---

## 4. Backend `.env`

Add to `Backend/.env`:

```env
# Apple In-App Purchase
APPLE_BUNDLE_ID=com.getfit.fitness
APPLE_SHARED_SECRET=<32-char hex from step 3c>

# Optional (for future StoreKit 2 chain validation)
# APPLE_API_KEY_ID=<key id>
# APPLE_API_ISSUER_ID=<issuer id>
# APPLE_API_PRIVATE_KEY=<full .p8 contents>
```

Then restart the backend. Test with curl after a sandbox purchase:

```bash
# After grabbing a real receipt from a sandbox device:
curl -X POST https://your-domain.com/api/payments/apple/verify \
  -H "Authorization: Bearer <user JWT>" \
  -H "Content-Type: application/json" \
  -d '{"receipt":"<base64 receipt>","productId":"com.getfit.fitness.pro.monthly"}'
```

Expected `200`:
```json
{
  "message": "Receipt verified",
  "subscription": {
    "planId": "pro_monthly",
    "tier": "pro",
    "expiryDate": "2026-06-15T...",
    "autoRenew": true,
    "environment": "Sandbox"
  }
}
```

---

## 5. Frontend setup

### 5a. Install the native module

```powershell
cd Frontend
npm install react-native-iap
```

### 5b. Prebuild + rebuild dev client

```powershell
npx expo prebuild --platform ios --clean
npx expo run:ios --device
```

> ⚠ Run on a Mac. From Windows you can use **EAS Build**:
> ```powershell
> npx eas-cli build --platform ios --profile development
> ```

### 5c. Verify

1. App opens on a real device
2. Sign in with a sandbox tester (Settings → App Store)
3. Open the app → Profile Settings → Subscription → tap → /upgrade
4. Tap a plan → StoreKit native sheet opens
5. Enter sandbox password → "Subscribed" toast
6. Backend logs `[apple-iap] Receipt verified` and creates a `Subscription` doc

---

## 6. Webhook testing

App Store Connect → **App Information → App Store Server Notifications →
Test**. Apple will send a fake `TEST` notification. Confirm the backend
logs `[apple-webhook] noop type=TEST`.

For renewal testing, just buy a sandbox monthly sub and wait 5 minutes —
Apple will fire `DID_RENEW` automatically.

---

## 7. iOS-specific UX notes

### Cancellation
**Apple does NOT allow apps to cancel subscriptions in-app.** App Review
will reject any UI that does this. The app deep-links to:

```
https://apps.apple.com/account/subscriptions
```

This is implemented in `IAPService.openManageSubscriptions()` and wired
in `app/upgrade.tsx → handleCancelTap`.

### Restore Purchases
Apple **requires** a "Restore Purchases" button on every paywall screen.
Already present in `upgrade.tsx`. Apple will reject the build without it.

### Required disclosures
On the paywall, the legal text must mention:
- Auto-renewal
- The fact that the user can cancel at least 24h before renewal
- A link to your Privacy Policy + Terms of Use

Already present in `styles.legal` block on `upgrade.tsx`. Verify the text
matches your actual policies before submission.

---

## 8. Production checklist

- [ ] Banking + tax forms = **Active**
- [ ] All 4 products = **Ready to Submit**
- [ ] Subscription group localized in all your supported languages
- [ ] Privacy Policy URL on the App Information page
- [ ] EULA URL OR rely on Apple's standard EULA
- [ ] Webhook endpoint deployed with valid HTTPS cert
- [ ] `APPLE_SHARED_SECRET` set in production env
- [ ] Tested at least one sandbox purchase + renewal end-to-end
- [ ] Restore Purchases button visible
- [ ] Auto-renewal disclosure visible on paywall

---

## 9. File map

| File | Purpose |
|---|---|
| `Backend/services/appleIapService.js` | verifyReceipt + JWS decode |
| `Backend/controllers/paymentsController.js` | `verifyAppleReceipt` + `appleWebhook` controllers |
| `Backend/routes/paymentsRoute.js` | `/apple/verify` route |
| `Backend/index.js` | Webhook mount with raw-body parser |
| `Backend/config/plans.js` | `appleProductId` per SKU + reverse lookup |
| `Frontend/services/payments/IAPService.ts` | StoreKit wrapper |
| `Frontend/services/api.js` | `verifyAppleReceipt` HTTP wrapper |
| `Frontend/app/upgrade.tsx` | iOS branch in `handlePurchase` + `handleCancelTap` |
| `Frontend/app.json` | `react-native-iap` config plugin |

---

## 10. Common gotchas

- **"Cannot connect to iTunes Store"** — sandbox tester not signed in,
  or you're using a real Apple ID (must sign out of regular ID first)
- **Status 21002 from Apple** — receipt is malformed, usually because
  the client sent a tampered or partial receipt
- **Status 21004** — `APPLE_SHARED_SECRET` is wrong or missing
- **Subscription doc not created on backend** — JWT not sent on the
  /apple/verify call; check Authorization header
- **No webhook events** — wrong URL in App Store Connect, or HTTPS cert
  invalid (Apple silently drops without retry)
- **Build crashes on iOS Simulator** — the simulator can't run StoreKit
  in some setups. Always test purchases on a **real device**.

---

Last updated: GetFit Phase 3 — Apple IAP integration.
