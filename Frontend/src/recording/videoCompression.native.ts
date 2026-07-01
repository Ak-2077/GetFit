/**
 * Thin, ISOLATED real adapter for the Video_Compression_Service.
 *
 * This is the ONLY place that touches native modules (`expo-file-system`, and
 * where available a platform transcoder). It is intentionally kept out of the
 * pure `videoCompression.ts` logic module so that unit/property tests never
 * import native code.
 *
 * Native modules are loaded lazily via `require` inside functions, so merely
 * importing type declarations from this file does not pull in native code.
 * The pure decision logic (resolution ceiling, size/quality bounds, ratio
 * math, failure fallback, metadata) lives entirely in `videoCompression.ts`
 * and is exercised by tests with a fake encoder.
 *
 * Requirements: 32.1–32.9 (adapter wiring only).
 */

import type {
  EncodeRequest,
  EncodedResult,
  TempStore,
  VideoEncoder,
} from "./videoCompression";

/**
 * TempStore backed by `expo-file-system`. Used to securely remove the
 * transient compressed artifact after upload (Req 32.8).
 */
export function createExpoTempStore(): TempStore {
  return {
    async delete(uri: string): Promise<void> {
      // Lazy require keeps native code out of the test import graph.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const FileSystem = require("expo-file-system") as {
        deleteAsync?: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
      };
      if (typeof FileSystem.deleteAsync === "function") {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    },
  };
}

/**
 * Real device {@link VideoEncoder}. Wiring point for a native transcoder
 * (e.g. an `expo-av` / native module bridge). The concrete transcode call is
 * injected as `transcode` so this adapter stays decoupled from any specific
 * native library; the caller supplies the platform implementation.
 *
 * On any native failure this rejects, which the pure `compress` logic maps to
 * a `COMPRESSION_FAILED` StructuredError with the original retained as the
 * upload fallback (Req 32.6).
 */
export function createNativeVideoEncoder(
  transcode: (request: EncodeRequest) => Promise<EncodedResult>
): VideoEncoder {
  return {
    encode(request: EncodeRequest): Promise<EncodedResult> {
      return transcode(request);
    },
  };
}
