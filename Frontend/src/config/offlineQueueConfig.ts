/**
 * Offline-queue configuration for the frontend Offline_Queue_Service (Req 45).
 *
 * The default values mirror the AI service reference defaults documented in
 * `ai-service/app/analysis_v2/config_v2.py` (the Offline Queue section):
 *   OFFLINE_MAX_UPLOAD_RETRIES = 5    (Req 45.6)
 *   OFFLINE_RECONNECT_DETECT_S = 30   (Req 45.2)
 * plus the ≤2s state-change reflection deadline (Req 45.4), which is a
 * frontend-only presentation bound and therefore lives here.
 *
 * This module is pure TypeScript with NO Python and NO native
 * (`react-native` / `expo-*`) imports, so it is fully testable in Node.
 *
 * Requirements:
 *  - 45.2  restored connectivity is detected within 30 seconds
 *  - 45.4  a state change is reflected to the End_User within 2 seconds
 *  - 45.6  a failing upload is retried up to 5 times before it is marked Failed
 */

/** Milliseconds in one second. */
export const MS_PER_SECOND = 1000;

/**
 * Maximum number of upload retries for a single offline-queued recording
 * before it is marked Failed and retained in local storage (Req 45.6).
 * Mirrors `OFFLINE_MAX_UPLOAD_RETRIES` in config_v2.py.
 */
export const OFFLINE_MAX_UPLOAD_RETRIES = 5;

/**
 * Maximum time (seconds) to detect restored connectivity before the queue
 * begins draining (Req 45.2). Mirrors `OFFLINE_RECONNECT_DETECT_S`.
 */
export const OFFLINE_RECONNECT_DETECT_S = 30;

/**
 * Maximum time (seconds) within which a state change must be reflected to the
 * End_User (Req 45.4). Frontend presentation bound (no config_v2.py analogue).
 */
export const OFFLINE_STATE_CHANGE_MAX_S = 2;

/**
 * Configuration for the Offline_Queue_Service. All values are read from
 * configuration so behaviour is deterministic and testable.
 */
export interface OfflineQueueConfig {
  /** Max upload retries before a recording is marked Failed (Req 45.6). */
  maxUploadRetries: number;
  /** Reconnect-detection deadline, in seconds (Req 45.2). */
  reconnectDetectSeconds: number;
  /** State-change reflection deadline, in seconds (Req 45.4). */
  stateChangeMaxSeconds: number;
}

/**
 * Default offline-queue configuration.
 * Values mirror config_v2.py:
 *   OFFLINE_MAX_UPLOAD_RETRIES = 5
 *   OFFLINE_RECONNECT_DETECT_S = 30
 * and the frontend presentation bound OFFLINE_STATE_CHANGE_MAX_S = 2.
 */
export const DEFAULT_OFFLINE_QUEUE_CONFIG: OfflineQueueConfig = {
  maxUploadRetries: OFFLINE_MAX_UPLOAD_RETRIES,
  reconnectDetectSeconds: OFFLINE_RECONNECT_DETECT_S,
  stateChangeMaxSeconds: OFFLINE_STATE_CHANGE_MAX_S,
};

/**
 * Resolve a full, validated `OfflineQueueConfig` from partial overrides.
 *
 * Out-of-range or invalid values fall back to the documented safe defaults,
 * mirroring the `config_v2.py` field validators:
 *  - retries fall back to the default when negative or non-finite
 *  - the reconnect/state-change deadlines fall back when <= 0
 */
export function resolveOfflineQueueConfig(
  overrides: Partial<OfflineQueueConfig> = {}
): OfflineQueueConfig {
  const merged: OfflineQueueConfig = { ...DEFAULT_OFFLINE_QUEUE_CONFIG, ...overrides };

  return {
    maxUploadRetries:
      Number.isFinite(merged.maxUploadRetries) && merged.maxUploadRetries >= 0
        ? Math.floor(merged.maxUploadRetries)
        : DEFAULT_OFFLINE_QUEUE_CONFIG.maxUploadRetries,
    reconnectDetectSeconds:
      merged.reconnectDetectSeconds > 0
        ? merged.reconnectDetectSeconds
        : DEFAULT_OFFLINE_QUEUE_CONFIG.reconnectDetectSeconds,
    stateChangeMaxSeconds:
      merged.stateChangeMaxSeconds > 0
        ? merged.stateChangeMaxSeconds
        : DEFAULT_OFFLINE_QUEUE_CONFIG.stateChangeMaxSeconds,
  };
}

/** Convert the configured reconnect-detection window (s) into milliseconds. */
export function reconnectDetectMs(config: OfflineQueueConfig): number {
  return Math.round(config.reconnectDetectSeconds * MS_PER_SECOND);
}

/** Convert the configured state-change deadline (s) into milliseconds. */
export function stateChangeMaxMs(config: OfflineQueueConfig): number {
  return Math.round(config.stateChangeMaxSeconds * MS_PER_SECOND);
}
