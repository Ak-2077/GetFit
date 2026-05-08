# GetFit — Apple HealthKit Integration Guide

> Complete guide covering architecture, implementation details, testing instructions, and FAQ for the HealthKit-based fitness tracking system.

---

## Table of Contents

1. [What Was Before (The Problem)](#1-what-was-before-the-problem)
2. [What Was Built (The Solution)](#2-what-was-built-the-solution)
3. [Architecture](#3-architecture)
4. [Files Created & Why](#4-files-created--why)
5. [Files Modified & Why](#5-files-modified--why)
6. [Data Flow — Step by Step](#6-data-flow--step-by-step)
7. [FAQ](#7-faq)
8. [Testing Guide](#8-testing-guide)
9. [Debugging & Logs](#9-debugging--logs)
10. [Cost Summary](#10-cost-summary)

---

## 1. What Was Before (The Problem)

The app was tracking steps using **GPS location** (`expo-location`). The old system worked like this:

```
Old Flow:
iPhone GPS → watchPositionAsync() → Calculate distance → Estimate steps (distance ÷ 0.78)
→ Sync to backend every 30s → UI reads from backend API
```

### Why this was bad:

| Problem | Impact |
|---------|--------|
| **Inaccurate** | GPS can't count steps — it estimates distance, then guesses steps |
| **Battery drain** | GPS running constantly kills battery |
| **Doesn't work indoors** | No GPS signal inside buildings, gyms, malls |
| **No Apple Watch data** | Ignores the dedicated motion sensor on the wrist |
| **Crude calorie estimation** | Just `weight × distance × 0.75` — not real burn data |
| **Values could drop** | GPS drift caused distance to reset, making step count jump down |

---

## 2. What Was Built (The Solution)

Replaced the GPS system with **Apple HealthKit** — the same system Apple Fitness uses. HealthKit reads data directly from:

- **iPhone**: M-series motion coprocessor (counts steps even in your pocket)
- **Apple Watch**: Accelerometer + heart rate sensor (more accurate calories)

```
New Flow:
iPhone Sensor + Apple Watch → HealthKit Database → Our App reads via HKStatisticsQuery
→ FitnessStore (cache) → UI displays instantly
```

### Key features:

- **HKStatisticsQuery with cumulativeSum** — proper HealthKit query method
- **Auto-deduplication** — if both iPhone and Apple Watch count steps, HealthKit merges them
- **Monotonic values** — step count and calories NEVER decrease (prevents UI flicker)
- **Three-tier fallback** — HealthKit → Backend API → Step-based estimation
- **20-second auto-polling** — real-time but stable updates
- **Day boundary detection** — auto-resets at midnight

---

## 3. Architecture

### 4-Layer Design

```
┌─────────────────────────────────────────────┐
│  UI LAYER (What user sees)                  │
│  index.tsx (Home), calories.tsx (Calories)   │
│  Uses: useFitness() hook                    │
├─────────────────────────────────────────────┤
│  STATE LAYER (Single source of truth)       │
│  FitnessStore.ts                            │
│  Caches data, prevents value drops,         │
│  day-boundary reset, AsyncStorage persist   │
├─────────────────────────────────────────────┤
│  SERVICE LAYER (Business logic)             │
│  FitnessService.ts (orchestrator)           │
│  StepManager.ts + CalorieManager.ts         │
│  Throttling, fallback logic, polling        │
├─────────────────────────────────────────────┤
│  DATA LAYER (Where data comes from)         │
│  HealthKitService.ts (iOS only)             │
│  api.js (Backend fallback for Android)      │
└─────────────────────────────────────────────┘
```

### Why 4 layers?

| Layer | Responsibility |
|-------|----------------|
| **Data Layer** | Talks to HealthKit or Backend — raw data fetching only |
| **Service Layer** | Decides *which* source to use, applies throttling, prevents duplicate queries |
| **State Layer** | Single store that both Home and Calories tabs read from — ensures they show the **same numbers** |
| **UI Layer** | Just displays data — zero business logic |

### Data Source Priority

```
Priority 1: Apple HealthKit (most accurate — real sensor data)
    ↓ if unavailable
Priority 2: Backend API (existing step/burn data from server)
    ↓ if unavailable  
Priority 3: Step-based Estimation (steps × 0.04 × weight/70)
```

---

## 4. Files Created & Why

### `services/fitness/HealthKitService.ts` — The HealthKit Bridge

**Why needed:** React Native can't talk to HealthKit directly. This file uses `react-native-health` to:

- Request permissions (read StepCount, ActiveEnergyBurned, BodyMass)
- Query today's steps using `HKStatisticsQuery` with `cumulativeSum`
- Query today's active energy burned (same time range as steps)
- Read user's weight from HealthKit for calorie estimation
- Set up background observers for real-time step updates
- Calculate `startOfDay` in **local timezone** (avoids UTC bugs)
- Auto-deduplicates iPhone + Apple Watch data (HealthKit does this with statistics queries)

---

### `services/fitness/StepManager.ts` — Step Count Logic

**Why needed:** A layer between HealthKit and UI that ensures data quality:

- Tries HealthKit first, falls back to `getStepsToday()` backend API
- **Throttles** to max 1 query per 10 seconds (prevents hammering HealthKit)
- **Monotonic guarantee** — if new step count < old count, keeps the old value
- **Re-entrancy guard** — prevents duplicate concurrent fetches
- Caches last known value for instant reads

---

### `services/fitness/CalorieManager.ts` — Calorie Burn Logic

**Why needed:** Calories have complex fallback logic:

1. **HealthKit `ActiveEnergyBurned`** → most accurate (from sensors)
2. **Backend burn data** → manual workout logs from the app
3. **Estimation fallback**: `steps × 0.04 × (weight / 70)` → if nothing else works

Also:
- Merges manual burn logs from backend ON TOP of HealthKit data
- Reads user weight from HealthKit for better estimation accuracy
- Same throttling and monotonic guarantees as StepManager

---

### `services/fitness/FitnessStore.ts` — Central State Store

**Why needed:** Both Home tab and Calories tab need the **same step/calorie numbers**. Without a central store, they'd each query separately and show different values.

Features:
- `subscribe(listener)` / `getState()` pattern (like Redux, but simpler)
- Notifies all UI subscribers when data changes
- **Monotonic guarantees** — steps and calories never decrease within a day
- **Day boundary detection** — auto-resets at midnight
- **AsyncStorage persistence** — cached data loads instantly on next app launch

---

### `services/fitness/FitnessService.ts` — The Orchestrator

**Why needed:** Coordinates all the managers and handles app lifecycle:

- Initializes HealthKit on app start (after auth)
- **Auto-polls every 20 seconds** when app is active
- **Pauses polling** when app goes to background (saves battery)
- **Resumes and force-refreshes** when app returns to foreground
- Sets up HealthKit **background observers** for real-time step updates
- **Day boundary checking** every 60 seconds

---

### `services/fitness/index.ts` — Barrel Export

Single import point: `import { FitnessService, useFitness } from '../services/fitness'`

---

### `hooks/useFitness.ts` — React Hook

**Why needed:** Clean way for any UI component to consume fitness data:

```typescript
const {
  steps,           // 4,523
  distanceKm,      // 3.45
  caloriesBurned,  // 345
  walkingCalories, // 312
  manualCalories,  // 33
  source,          // 'healthkit' | 'backend' | 'estimated'
  isHealthKitAvailable,
  isHealthKitAuthorized,
  isLoading,
  refresh,         // for pull-to-refresh
} = useFitness();
```

---

## 5. Files Modified & Why

### `app/(tabs)/_layout.tsx` — Removed GPS Tracking

**Before:** ~140 lines of `expo-location` code:
- `watchPositionAsync()` tracking GPS continuously
- Haversine distance calculation
- Step estimation (distance ÷ 0.78)
- Backend sync every 30 seconds
- Location permission management
- Day-boundary reset logic

**After:** Single initialization call:
```typescript
await FitnessService.initialize(userWeight);
```

All the polling, lifecycle management, and day-boundary logic is handled internally by FitnessService.

---

### `app/(tabs)/index.tsx` — Home Tab

**Before:** Called `getStepsToday()` and `getCaloriesBurn()` API directly in `Promise.all`

**After:** Uses `useFitness()` hook:
```typescript
const fitness = useFitness();
// In UI:
fitness.steps          // instead of steps.steps
fitness.caloriesBurned // instead of burn.totalCaloriesBurned
fitness.distanceKm     // instead of steps.distanceKm
```

---

### `app/(tabs)/calories.tsx` — Calories Tab

**Changes made:**
- Removed `expo-location` import
- Removed `getStepsToday()` and `getCaloriesBurn()` from data loading
- Removed `steps` and `burn` local state → replaced with `useFitness()` hook
- Replaced **"Location Required"** permission card with **"Apple Health"** HealthKit card
- Added **source badges** on the burn card:
  - `❤️ HK` — data from HealthKit (green badge)
  - `EST` — estimated from steps (orange badge)
- Syncs user weight to FitnessService for calorie estimation accuracy

---

### `app.json` — HealthKit Entitlements

Added iOS HealthKit configuration:
```json
"ios": {
  "infoPlist": {
    "NSHealthShareUsageDescription": "GetFit reads your step count and active energy burned to display accurate fitness data",
    "NSHealthUpdateUsageDescription": "GetFit does not write health data"
  },
  "entitlements": {
    "com.apple.developer.healthkit": true
  }
}
```

---

## 6. Data Flow — Step by Step

```
1. App launches → _layout.tsx auth check passes
2. FitnessService.initialize(userWeight) called
3. HealthKitService checks: am I on iOS? → Yes → request permissions
4. FitnessStore restores cached data from AsyncStorage (instant UI)
5. FitnessService starts 20-second auto-poll timer

6. Every 20s → FitnessService.refreshAll():
   ├── StepManager.fetch()
   │   ├── Check throttle (was last fetch > 10s ago?)
   │   ├── HealthKit.getStepCount() → 4,523 steps ✓
   │   ├── Apply monotonic check (4523 ≥ previous 4500? ✓)
   │   └── Return { steps: 4523, distanceKm: 3.45, source: 'healthkit' }
   │
   ├── CalorieManager.fetch()
   │   ├── HealthKit.getActiveEnergyBurned() → 312 kcal
   │   ├── Backend burn logs → 33 kcal (manual workout)
   │   ├── Total: 312 + 33 = 345 kcal
   │   └── Return { totalCaloriesBurned: 345, source: 'healthkit' }
   │
   └── FitnessStore.update({ steps: 4523, calories: 345 })
       ├── Monotonic check ✓
       ├── Persist to AsyncStorage (fire-and-forget)
       └── Notify all subscribers (Home tab + Calories tab)

7. useFitness() hook receives update → React re-renders UI
8. Both tabs show identical numbers (single source of truth)
```

### What happens on Android / Expo Go:

```
Step 3 changes: HealthKitService.isAvailable() → false (not iOS)
Step 6 changes:
   ├── StepManager.fetch()
   │   ├── HealthKit unavailable → skip
   │   ├── Fallback: getStepsToday() backend API → 2,100 steps
   │   └── Return { steps: 2100, source: 'backend' }
   │
   ├── CalorieManager.fetch()
   │   ├── HealthKit unavailable → skip
   │   ├── Fallback: getCaloriesBurn() backend API → 156 kcal
   │   └── Return { totalCaloriesBurned: 156, source: 'backend' }

Everything else works the same — just different data source.
```

---

## 7. FAQ

### Does the user need an Apple Watch?

**No. Apple Watch is NOT required.**

| Device | What it tracks | How |
|--------|---------------|-----|
| **iPhone only** | Steps, distance, calories | M-series motion coprocessor chip (built into every iPhone since 5s). Counts steps even in your pocket |
| **iPhone + Apple Watch** | Same + more accurate heart rate data, workout tracking | Watch adds better data. HealthKit **automatically merges and deduplicates** data from both |

### Will the app crash on Android or Expo Go?

**No.** The system gracefully falls back to the backend API. `HealthKitService.isAvailable()` returns `false` on non-iOS platforms, and StepManager/CalorieManager use the existing backend endpoints.

### Can I test without building an IPA?

**Yes, but only the backend fallback.** HealthKit requires native iOS code, which Expo Go doesn't include. In Expo Go, the app works exactly as before — reading steps/calories from your backend.

### Why do values never decrease?

The **monotonic guarantee** in FitnessStore. If a new HealthKit query returns a lower number than what's cached (can happen due to query timing), the system keeps the higher value and logs a warning.

---

## 8. Testing Guide

### Option A: MacBook + iOS Simulator (Free, Recommended)

**Prerequisites:**
- macOS with **Xcode** installed (free from Mac App Store)
- **CocoaPods**: `sudo gem install cocoapods`

**Steps:**

```bash
# 1. Navigate to project
cd ~/Desktop/GetFit/Frontend
npm install

# 2. Generate native iOS project
npx expo prebuild --platform ios

# 3. Install iOS dependencies
cd ios && pod install && cd ..

# 4. Run on iOS Simulator
npx expo run:ios
```

**Adding fake data in Simulator:**

1. Open the **Health** app in the Simulator
2. Tap **Browse** → **Activity** → **Steps**
3. Tap **Add Data** (top right)
4. Enter `5000` steps with today's date → tap **Add**
5. Go back → **Activity** → **Active Energy**
6. Tap **Add Data** → enter `350` kcal → tap **Add**
7. Switch to **GetFit** app
8. HealthKit permission prompt → tap **Allow All**
9. Steps shows **5,000** · Burn shows **350 kcal** with **❤️ HK** badge

---

### Option B: MacBook + Physical iPhone (Free, Real Data)

```bash
# Connect iPhone via USB, then:
npx expo run:ios --device
```

- Select your iPhone from the list
- App installs on your phone
- Walk around → real step data flows from motion sensor into the app
- Requires a free Apple ID signed into Xcode (Xcode → Settings → Accounts)

---

### Option C: EAS Cloud Build from Windows (No Mac Needed)

**Prerequisites:**
- **Apple Developer Account** — $99/year at [developer.apple.com](https://developer.apple.com)
- **Physical iPhone** for testing

**Steps:**

```bash
# 1. Install EAS CLI
npm install -g eas-cli

# 2. Login to Expo
eas login

# 3. Configure EAS
eas build:configure
```

Edit `eas.json`:
```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": false
      }
    }
  }
}
```

```bash
# 4. Register your iPhone
eas device:create
# Opens a URL → open on iPhone → installs device profile

# 5. Build in the cloud (~15 minutes)
eas build --platform ios --profile development

# 6. Install
# EAS gives you a download link → open on iPhone → tap Install
```

**No TestFlight needed** for development builds. The app installs directly on your registered iPhone.

---

### Option D: Testing Backend Fallback on Expo Go (Right Now)

If you want to verify the architecture works **today** without any iOS build:

```bash
# Start your backend
cd c:\Users\rishi\Desktop\GetFit\Backend
node index.js
```

Use Postman / Thunder Client to simulate step data:

```http
PATCH http://localhost:5000/api/auth/profile
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "steps": 5000,
  "stepDistanceKm": 3.81
}
```

Add a manual burn log:

```http
POST http://localhost:5000/api/burn/log
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "caloriesBurned": 150,
  "activity": "Walking",
  "durationMinutes": 30
}
```

Pull-to-refresh in the app → you'll see the updated numbers. The source badge won't show ❤️ HK (since it's backend data), but the architecture is working.

---

## 9. Debugging & Logs

The system produces structured console logs at every layer. Open Metro terminal to see them.

### Normal operation:
```
[HealthKitService] Initialized successfully
[HealthKitService] steps: 4523 | range: 2026-05-02T00:00:00 → 2026-05-02T17:30:00 | 45ms
[HealthKitService] burn: 312 kcal | range: 2026-05-02T00:00:00 → 2026-05-02T17:30:00 | 32ms
[StepManager] fetch: 4523 steps | source: healthkit | 48ms
[CalorieManager] fetch: 345 kcal (HK: 312 + manual: 33) | source: healthkit | 55ms
[FitnessService] refresh complete | steps: 4523 | burn: 345 | source: healthkit
```

### Throttling (too many refreshes):
```
[FitnessService] debounced: skipping refresh (last: 3s ago)
[StepManager] throttled: skipping (last: 7s ago)
```

### Value drop protection:
```
[FitnessStore] ⚠️ step drop detected: 4523 → 4510 (keeping 4523)
[CalorieManager] ⚠️ value drop: 345 → 340 (keeping 345)
```

### Day boundary:
```
[FitnessService] Day boundary: 2026-05-02 → 2026-05-03
[StepManager] Reset for new day
[CalorieManager] Reset for new day
```

### Fallback (no HealthKit):
```
[HealthKitService] Not available (non-iOS or missing module)
[StepManager] fetch: 2100 steps | source: backend | 120ms
[CalorieManager] fallback: 156 kcal | method: step-estimation | weight: 75kg | 130ms
```

---

## 10. Cost Summary

| Item | Cost | Required for |
|------|------|-------------|
| Xcode (Mac only) | Free | Simulator testing |
| Apple ID (personal) | Free | Physical device testing (via Mac) |
| Apple Developer Account | $99/year | EAS cloud builds, App Store |
| EAS Build (free tier) | Free (30 builds/month) | Cloud builds from Windows |
| TestFlight | Free | NOT needed for dev testing |
| Mac computer | $0 if you have one | Local builds |

### Cheapest testing path:
- **Have a Mac?** → Completely free (Xcode + Simulator)
- **Windows only?** → $99/year Apple Developer + free EAS builds

---

*Generated for the GetFit project — May 2026*a
