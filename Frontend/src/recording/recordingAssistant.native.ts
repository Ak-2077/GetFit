/**
 * Thin, ISOLATED real adapter for the Recording_Assistant_Service.
 *
 * This is the ONLY place that touches the native camera preview (`expo-camera`).
 * It is intentionally kept out of the pure `recordingAssistant.ts` logic module
 * so that unit/property tests never import native code.
 *
 * Native modules are loaded lazily via `require` inside functions, so merely
 * importing type declarations from this file does not pull in native code.
 * The pure decision logic (condition-detection thresholds, severity ordering,
 * one-instruction-per-condition mapping, empty-when-ready, non-blocking
 * failure) lives entirely in `recordingAssistant.ts` and is exercised by tests
 * with a fake analyzer.
 *
 * Requirements: 35.1–35.6 (adapter wiring only).
 */

import {
  GUIDANCE_UNAVAILABLE,
  PreviewFrame,
  PreviewSignals,
  PreviewAnalyzer,
  RECORDING_ASSISTANT_STAGE,
} from "./recordingAssistant";
import { makeStructuredError } from "../types/structuredError";

/**
 * Extractor that turns a native preview frame into structured
 * {@link PreviewSignals}. The concrete scene/pose inspection (brightness,
 * pose bounding box, person count, motion, orientation) is injected so this
 * adapter stays decoupled from any specific vision/pose library; the caller
 * supplies the platform implementation (e.g. a `expo-camera` frame processor).
 */
export type NativeSignalExtractor = (frame: PreviewFrame) => PreviewSignals;

/**
 * Build a {@link PreviewAnalyzer} backed by a native signal extractor.
 *
 * On any native failure — extractor throw or an unavailable frame — this
 * returns a non-blocking `GUIDANCE_UNAVAILABLE` StructuredError (Req 35.6)
 * rather than throwing, so the pure `analyzePreview` logic keeps recording
 * unblocked.
 */
export function createNativePreviewAnalyzer(
  extractSignals: NativeSignalExtractor
): PreviewAnalyzer {
  return {
    analyze(frame: PreviewFrame): PreviewSignals | ReturnType<typeof makeStructuredError> {
      if (!frame) {
        return makeStructuredError(
          GUIDANCE_UNAVAILABLE,
          "camera preview frame is unavailable",
          RECORDING_ASSISTANT_STAGE
        );
      }
      try {
        return extractSignals(frame);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "preview analysis failed";
        return makeStructuredError(
          GUIDANCE_UNAVAILABLE,
          message,
          RECORDING_ASSISTANT_STAGE
        );
      }
    },
  };
}

/**
 * Example wiring point that lazily loads `expo-camera`. Kept as a factory so it
 * is only evaluated on device; never imported by tests. The actual per-frame
 * signal extraction is delegated to the injected {@link NativeSignalExtractor}.
 */
export function loadExpoCamera(): unknown {
  // Lazy require keeps native code out of the test import graph.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("expo-camera");
}
