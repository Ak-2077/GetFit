/**
 * Shared Structured_Error contract for Version 2 frontend services.
 *
 * Mirrors the AI service `StructuredError` (analysis pipeline) so frontend and
 * backend speak the same error shape: a stable machine-readable `code`, a
 * human-readable `message` (no stack details), and the originating `stage`.
 *
 * This module is pure TypeScript with NO native (`react-native` / `expo-*`)
 * imports so it can be unit/property tested in plain Node.
 *
 * Design: .kiro/specs/ai-exercise-analysis/design.md (StructuredError, Error Handling)
 */

/** Stable, machine-readable error code (see design Error Handling table). */
export type StructuredErrorCode =
  | "COMPRESSION_FAILED"
  // Chunk_Upload_Service (Req 33): retry exhausted / resume-window expired.
  | "CHUNK_UPLOAD_FAILED"
  | "UPLOAD_SESSION_EXPIRED"
  // Recording_Assistant_Service (Req 35.6): preview unavailable / analysis
  // failed. Non-blocking — the End_User may still begin recording.
  | "GUIDANCE_UNAVAILABLE"
  // Offline_Queue_Service (Req 45.7): local persistent storage is unavailable
  // or full, so the recording could not be queued — submission is rejected and
  // the state is NOT set to Queued.
  | "STORAGE_UNAVAILABLE"
  // Offline_Queue_Service (Req 45.6): an offline-queued recording exhausted its
  // upload retry budget; the recording is retained in local storage and marked
  // Failed, and the affected recording is identified to the End_User.
  | "OFFLINE_UPLOAD_FAILED"
  // Device_Capability_Service (Req 48.5): device capability detection could not
  // complete within the allotted time budget or otherwise failed, so a low-end
  // safe-default Device_Capability_Profile was produced instead.
  | "DEVICE_DETECTION_INCOMPLETE"
  // additional V2 frontend codes are appended here as later stages land.
  | (string & {});

/**
 * Structured domain error. V2 components never throw on domain failure; they
 * return a `StructuredError` instead (matching the AI service convention).
 */
export interface StructuredError {
  /** Stable error code, e.g. `COMPRESSION_FAILED`. */
  code: StructuredErrorCode;
  /** Human-readable message. Must not include stack traces or PII. */
  message: string;
  /** Name of the originating stage/service, e.g. `video_compression`. */
  stage: string;
}

/** Construct a `StructuredError` with the standard shape. */
export function makeStructuredError(
  code: StructuredErrorCode,
  message: string,
  stage: string
): StructuredError {
  return { code, message, stage };
}

/**
 * Type guard: narrows a `T | StructuredError` union to the error branch.
 * A value is treated as a StructuredError when it carries the `code`/`message`/
 * `stage` triple.
 */
export function isStructuredError(value: unknown): value is StructuredError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StructuredError).code === "string" &&
    typeof (value as StructuredError).message === "string" &&
    typeof (value as StructuredError).stage === "string"
  );
}
