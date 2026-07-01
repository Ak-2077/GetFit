/**
 * Thin, ISOLATED real adapter for the Device_Capability_Service.
 *
 * This is the ONLY place that touches native modules (`expo-device`,
 * `expo-constants`). It is intentionally kept out of the pure
 * `deviceCapability.ts` logic module so that unit/property tests never import
 * native code.
 *
 * Native modules are loaded lazily via `require` inside functions, so merely
 * importing type declarations from this file does not pull in native code.
 * All tier classification, settings selection and the timeout / safe-default
 * fallback live in `deviceCapability.ts` and are exercised by tests with a
 * fake probe + injected clock.
 *
 * Requirements: 48.1–48.5 (adapter wiring only).
 */

import type { DeviceMetrics, DeviceProbe } from "./deviceCapability";

/**
 * Real device {@link DeviceProbe} backed by `expo-device` / `expo-constants`.
 *
 * Derives a coarse dimensionless benchmark score from the device's reported
 * performance class / total memory. The concrete score derivation is kept
 * deliberately simple; the pure logic maps the score to a tier via the
 * configured thresholds. Any native failure propagates as a rejection, which
 * the pure `detectCapability` logic maps to the low-end safe default
 * (Req 48.5).
 */
export function createExpoDeviceProbe(): DeviceProbe {
  return {
    async measure(): Promise<DeviceMetrics> {
      // Lazy require keeps native code out of the test import graph.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Device = require("expo-device") as {
        totalMemory?: number | null;
        DeviceType?: Record<string, number>;
        deviceType?: number | null;
      };

      // Total memory in bytes -> gibibytes; used as a rough capability proxy.
      const totalMemoryBytes =
        typeof Device.totalMemory === "number" ? Device.totalMemory : 0;
      const memoryGb = totalMemoryBytes / (1024 * 1024 * 1024);

      // Map memory (GB) onto the dimensionless benchmark score scale used by
      // the classifier thresholds (MID_RANGE_MIN_SCORE / HIGH_END_MIN_SCORE).
      // ~2GB -> ~25, ~4GB -> ~50, ~6GB -> ~75, clamped to [0, 100].
      const benchmarkScore = Math.max(0, Math.min(100, Math.round(memoryGb * 12.5)));

      return { benchmarkScore };
    },
  };
}
