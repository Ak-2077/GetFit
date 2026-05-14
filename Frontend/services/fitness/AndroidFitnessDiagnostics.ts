/**
 * AndroidFitnessDiagnostics.ts
 * ──────────────────────────────────────────────────────────────
 * Android-only diagnostic probe for the fitness pipeline.
 *
 * Runs once at FitnessService init (and on demand from a debug UI)
 * to determine WHY step tracking might be failing on a given device.
 *
 * Probes:
 *   • Platform / OS version / manufacturer / model
 *   • expo-sensors Pedometer hardware availability
 *   • ACTIVITY_RECOGNITION permission status
 *   • Whether range queries (getStepCountAsync) actually work
 *   • Whether the live watcher emits events
 *   • Health Connect availability (best-effort intent probe)
 *   • Google Play Services presence (best-effort)
 *
 * NEVER touches iOS — every public method is a no-op on non-Android.
 *
 * Output is exposed both via:
 *   1. Structured `[AndroidFitness]` console logs
 *   2. The returned AndroidFitnessReport object (consumable by UI /
 *      a future "Run diagnostics" button in settings)
 * ──────────────────────────────────────────────────────────────
 */

import { Platform, Linking, NativeModules } from 'react-native';
import { HealthConnectService } from './HealthConnectService';

/* ---------- Types ---------- */

export type ProbeStatus = 'ok' | 'unavailable' | 'denied' | 'unknown' | 'error';

export interface AndroidFitnessReport {
  /** OS / build info */
  platform: 'android' | 'ios' | 'web' | 'other';
  osVersion: string | number | null;
  apiLevel: number | null;
  manufacturer: string | null;
  brand: string | null;
  model: string | null;

  /** Pedometer (expo-sensors / TYPE_STEP_COUNTER) */
  pedometerHardware: ProbeStatus;
  pedometerPermission: ProbeStatus;
  pedometerRangeQuery: ProbeStatus; // getStepCountAsync (known broken on Android)
  pedometerLiveWatcher: ProbeStatus;

  /** Health Connect — Google's modern API */
  healthConnectInstalled: ProbeStatus;
  healthConnectModulePresent: ProbeStatus;
  /** Whether HC can actually deliver step data (full pipeline test) */
  healthConnectDataAccess: ProbeStatus;

  /** Google Play Services */
  playServicesPresent: ProbeStatus;

  /** Vendor restrictions (heuristic — Xiaomi/MIUI, Oppo/ColorOS, Vivo block bg sensors) */
  vendorRestrictionRisk: 'low' | 'medium' | 'high' | 'unknown';

  /** Composite recommendation */
  recommendedAction:
    | 'use-health-connect'
    | 'use-pedometer-watcher'
    | 'install-health-connect'
    | 'request-permission'
    | 'unsupported-device'
    | 'unknown';

  /** Free-form notes for logs / debug UI */
  notes: string[];
  timestamp: number;
}

const EMPTY_REPORT: AndroidFitnessReport = {
  platform: 'other',
  osVersion: null,
  apiLevel: null,
  manufacturer: null,
  brand: null,
  model: null,
  pedometerHardware: 'unknown',
  pedometerPermission: 'unknown',
  pedometerRangeQuery: 'unknown',
  pedometerLiveWatcher: 'unknown',
  healthConnectInstalled: 'unknown',
  healthConnectModulePresent: 'unknown',
  healthConnectDataAccess: 'unknown',
  playServicesPresent: 'unknown',
  vendorRestrictionRisk: 'unknown',
  recommendedAction: 'unknown',
  notes: [],
  timestamp: 0,
};

/* ---------- Helpers ---------- */

const log = (...args: any[]) => console.log('[AndroidFitness]', ...args);
const warn = (...args: any[]) => console.warn('[AndroidFitness]', ...args);

const getPlatformConstants = (): Record<string, any> => {
  // Platform.constants on Android contains Manufacturer / Model / Brand / Release / Version
  // (works on RN 0.63+). On iOS it's a different shape — we only call this when on Android.
  try {
    return (Platform as any).constants ?? {};
  } catch {
    return {};
  }
};

const detectVendorRisk = (
  manufacturer: string | null
): AndroidFitnessReport['vendorRestrictionRisk'] => {
  if (!manufacturer) return 'unknown';
  const m = manufacturer.toLowerCase();

  // High: aggressive battery managers known to kill background sensor work
  if (m.includes('xiaomi') || m.includes('redmi') || m.includes('poco')) return 'high';
  if (m.includes('oppo') || m.includes('realme')) return 'high';
  if (m.includes('vivo') || m.includes('iqoo')) return 'high';
  if (m.includes('huawei') || m.includes('honor')) return 'high';
  if (m.includes('tecno') || m.includes('infinix') || m.includes('itel')) return 'high';

  // Medium: vendor skins with some restrictions
  if (m.includes('oneplus')) return 'medium';
  if (m.includes('samsung')) return 'medium';
  if (m.includes('nothing')) return 'medium';
  if (m.includes('asus')) return 'medium';

  // Low: stock-Android-leaning vendors
  if (m.includes('google') || m.includes('pixel')) return 'low';
  if (m.includes('motorola') || m.includes('nokia')) return 'low';
  if (m.includes('sony') || m.includes('sharp')) return 'low';

  return 'unknown';
};

/* ---------- Service ---------- */

class _AndroidFitnessDiagnostics {
  private _lastReport: AndroidFitnessReport | null = null;

  /**
   * Run a full diagnostic probe. Safe to call multiple times.
   * On non-Android platforms, returns an empty report tagged as such
   * and emits no logs (we don't pollute iOS sessions).
   */
  async runFullProbe(): Promise<AndroidFitnessReport> {
    const report: AndroidFitnessReport = { ...EMPTY_REPORT, timestamp: Date.now() };

    // Tag platform regardless — useful for logs
    report.platform =
      Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web'
        ? Platform.OS
        : 'other';

    if (Platform.OS !== 'android') {
      // iOS-safe early exit. No logs (iOS uses HealthKit path).
      this._lastReport = report;
      return report;
    }

    log('───── running full probe ─────');

    // ── Device info ──────────────────────────────────────
    const c = getPlatformConstants();
    report.osVersion = c.Release ?? Platform.Version ?? null;
    report.apiLevel = typeof Platform.Version === 'number' ? Platform.Version : null;
    report.manufacturer = c.Manufacturer ?? null;
    report.brand = c.Brand ?? null;
    report.model = c.Model ?? null;
    report.vendorRestrictionRisk = detectVendorRisk(report.manufacturer);

    log(
      `device: ${report.manufacturer || '?'} ${report.model || '?'} (brand=${report.brand || '?'}) | Android ${report.osVersion} (API ${report.apiLevel}) | vendor-risk=${report.vendorRestrictionRisk}`
    );

    // ── Pedometer probes ─────────────────────────────────
    await this._probePedometer(report);

    // ── Health Connect probes ────────────────────────────
    await this._probeHealthConnect(report);

    // ── Google Play Services (best-effort) ───────────────
    await this._probePlayServices(report);

    // ── Recommendation engine ────────────────────────────
    this._computeRecommendation(report);

    log('───── probe complete ─────');
    log('summary:', JSON.stringify(report, null, 2));

    this._lastReport = report;
    return report;
  }

  /** Get the last probe result without re-running. */
  getLastReport(): AndroidFitnessReport | null {
    return this._lastReport;
  }

  /* ── Probes ──────────────────────────────────────────── */

  private async _probePedometer(report: AndroidFitnessReport): Promise<void> {
    let pedometer: any;
    try {
      pedometer = require('expo-sensors').Pedometer;
    } catch (e: any) {
      report.pedometerHardware = 'error';
      report.notes.push(`expo-sensors require failed: ${e?.message}`);
      warn('[Pedometer] expo-sensors module unavailable:', e?.message);
      return;
    }

    // Hardware availability
    try {
      const ok = await pedometer.isAvailableAsync();
      report.pedometerHardware = ok ? 'ok' : 'unavailable';
      log(`[Pedometer] hardware: ${ok ? 'PRESENT' : 'ABSENT'}`);
      if (!ok) {
        report.notes.push('Device does not expose a step counter sensor (TYPE_STEP_COUNTER).');
      }
    } catch (e: any) {
      report.pedometerHardware = 'error';
      report.notes.push(`isAvailableAsync error: ${e?.message}`);
      warn('[Pedometer] isAvailableAsync threw:', e?.message);
    }

    // Permission status (without prompting)
    try {
      const res = await pedometer.getPermissionsAsync();
      const status = res?.status;
      report.pedometerPermission =
        status === 'granted' ? 'ok' : status === 'denied' ? 'denied' : 'unknown';
      log(`[Pedometer] permission: ${status}`);
    } catch (e: any) {
      report.pedometerPermission = 'error';
      warn('[Pedometer] getPermissionsAsync threw:', e?.message);
    }

    // Range query (known broken on Android — we test to confirm)
    if (report.pedometerHardware === 'ok' && report.pedometerPermission === 'ok') {
      try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        const r = await pedometer.getStepCountAsync(start, end);
        if (r && typeof r.steps === 'number') {
          report.pedometerRangeQuery = 'ok';
          log(`[Pedometer] range query returned ${r.steps} (rare on Android — keep)`);
        } else {
          report.pedometerRangeQuery = 'unavailable';
          log('[Pedometer] range query returned no data (expected on Android)');
        }
      } catch (e: any) {
        report.pedometerRangeQuery = 'unavailable';
        log(
          `[Pedometer] range query unsupported (expected): ${e?.message || 'no message'}`
        );
        report.notes.push(
          'getStepCountAsync is not supported on Android — fitness pipeline will use the live watcher + persisted baseline instead.'
        );
      }

      // Live watcher
      try {
        const sub = await new Promise<any>((resolve, reject) => {
          const t = setTimeout(() => {
            try {
              s?.remove();
            } catch {}
            // No event in 1.5s isn't a failure (user might be still) — just inconclusive
            resolve('inconclusive');
          }, 1500);
          let s: any;
          try {
            s = pedometer.watchStepCount((res: any) => {
              clearTimeout(t);
              try {
                s?.remove();
              } catch {}
              resolve(res);
            });
          } catch (err) {
            clearTimeout(t);
            reject(err);
          }
        });
        report.pedometerLiveWatcher =
          sub === 'inconclusive' ? 'ok' /* subscribed but no event yet */ : 'ok';
        log(
          `[Pedometer] watcher: ${
            sub === 'inconclusive' ? 'subscribed (no event in 1.5s — user idle?)' : 'event received'
          }`
        );
      } catch (e: any) {
        report.pedometerLiveWatcher = 'error';
        warn('[Pedometer] watcher subscription failed:', e?.message);
        report.notes.push(`watchStepCount failed: ${e?.message}`);
      }
    }
  }

  private async _probeHealthConnect(report: AndroidFitnessReport): Promise<void> {
    // Check if react-native-health-connect module is available
    try {
      const hc = require('react-native-health-connect');
      report.healthConnectModulePresent = hc ? 'ok' : 'unavailable';
      if (hc) {
        log('[HealthConnect] react-native-health-connect module AVAILABLE');
      }
    } catch {
      report.healthConnectModulePresent = 'unavailable';
      log('[HealthConnect] react-native-health-connect module not bundled');
    }

    // Check availability via HealthConnectService
    try {
      const available = await HealthConnectService.isAvailable();
      report.healthConnectInstalled = available ? 'ok' : 'unavailable';
      log(`[HealthConnect] SDK ${available ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
      if (!available) {
        report.notes.push(
          'Health Connect not available — install from Play Store (Android 9-13) or update system (Android 14+).'
        );
      }
    } catch (e: any) {
      report.healthConnectInstalled = 'unknown';
      log('[HealthConnect] availability check inconclusive:', e?.message);
    }

    // If HC is available and authorized, try an actual data read
    if (
      report.healthConnectInstalled === 'ok' &&
      HealthConnectService.initialized &&
      HealthConnectService.authorized
    ) {
      try {
        const probe = await HealthConnectService.probeDataAccess();
        report.healthConnectDataAccess = probe === 'ok' ? 'ok' : probe === 'empty' ? 'ok' : 'error';
        log(
          `[HealthConnect] data probe: ${probe} (${probe === 'ok' ? 'records found' : probe === 'empty' ? 'no records but pipeline works' : 'error'})` 
        );
      } catch (e: any) {
        report.healthConnectDataAccess = 'error';
        warn('[HealthConnect] data probe failed:', e?.message);
      }
    }
  }

  private async _probePlayServices(report: AndroidFitnessReport): Promise<void> {
    // We can't directly check GMS without a native lib, but the deep link
    // for the Play Store works only if Play Services is present.
    try {
      const can = await Linking.canOpenURL('market://details?id=com.google.android.gms');
      report.playServicesPresent = can ? 'ok' : 'unavailable';
      log(`[PlayServices] ${can ? 'available' : 'unavailable'}`);
      if (!can) {
        report.notes.push(
          'Google Play Services not detected — Health Connect and Google Fit will be unavailable.'
        );
      }
    } catch {
      report.playServicesPresent = 'unknown';
    }
  }

  /* ── Recommendation ──────────────────────────────────── */

  private _computeRecommendation(r: AndroidFitnessReport): void {
    if (r.pedometerHardware !== 'ok' && r.healthConnectInstalled !== 'ok') {
      r.recommendedAction = 'unsupported-device';
      r.notes.push('No step sensor hardware and no Health Connect — only manual workouts + BMR estimation possible.');
      return;
    }
    if (r.healthConnectInstalled === 'ok' && r.healthConnectModulePresent === 'ok') {
      r.recommendedAction = 'use-health-connect';
      r.notes.push('Health Connect available — using as primary data source.');
      return;
    }
    if (r.healthConnectInstalled !== 'ok' && r.pedometerHardware === 'ok') {
      r.recommendedAction = 'install-health-connect';
      r.notes.push('Health Connect not installed — install for best tracking quality. Pedometer used as fallback.');
      return;
    }
    if (r.pedometerPermission !== 'ok') {
      r.recommendedAction = 'request-permission';
      return;
    }
    r.recommendedAction = 'use-pedometer-watcher';
  }
}

export const AndroidFitnessDiagnostics = new _AndroidFitnessDiagnostics();
