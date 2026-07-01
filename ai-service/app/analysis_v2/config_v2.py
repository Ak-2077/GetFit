"""
Analysis Pipeline — Version 2 Configuration (Production Extensions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**Strictly additive** configuration for the Version 2 components. Nothing here
modifies, removes, or overrides any key in `app/core/config.py` (Req 52) — the
V1 `Settings` object is left byte-for-byte intact. These settings live entirely
in the new `app/analysis_v2/` package and follow the same conventions as V1:
a `pydantic_settings.BaseSettings` class with `Field` defaults, reading the
same `.env` file (extra/unrelated env keys are ignored).

Every V2 key ships with a documented **safe default** (design.md "V2
Configuration"), so the system behaves correctly when an operator sets nothing.
Absent or invalid values fall back to these defaults (Req 37.8, 42.6, 48.5).

Requirement coverage:
  • Video compression .............. Req 32 (32.3)
  • Chunked upload ................. Req 33 (33.1) — chunk size bounded [1, 50] MB
  • Duplicate detection ............ Req 34 (34.2)
  • Abuse / exercise-content gate ... Req 47 (47.5)
  • Recording assistant ............ Req 35 / 46 (46.1)
  • Retry & recovery ............... Req 36 (36.3)
  • GPU failure recovery ........... Req 37 (35.5, 37.8)
  • Frame / pose caches ............ Req 38 / 39 (38.1, 39.1)
  • Human review gate .............. Req 42 (42.3)
  • Active model selection ......... Req 43 (43.4)
  • Offline queue .................. Req 45 (45.6)
  • Admin analytics intervals ...... Req 39 / 46 (39.1)
  • Cost tracking .................. Req 40 (40.1)
  • Secure temporary storage ....... Req 51 (51.5)
  • Benchmark dataset builder ...... Req 41 (51.5)

Validation note: the bounded keys (compression target size [5, 15] MB, chunk
size [1, 50] MB, retry count [0, 10], review threshold [0, 1]) are validated
here; an out-of-range supplied value is clamped/rejected to the documented safe
default rather than allowed to destabilise the pipeline.
"""

from __future__ import annotations

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings


class SettingsV2(BaseSettings):
    """Additive Version 2 settings — see module docstring for Req mapping."""

    # ── Video Compression (Req 32) ──
    # Target downscale resolution (vertical pixels) the recorded video is
    # transcoded to before upload (e.g. 1080p → 720p).
    COMPRESSION_TARGET_RESOLUTION: int = 720
    COMPRESSION_TARGET_FPS: int = 30
    COMPRESSION_CODEC: str = "h264"
    COMPRESSION_TARGET_BITRATE_KBPS: int = 2500
    COMPRESSION_TARGET_QUALITY: float = 0.85
    # Target compressed size; must remain within the documented [5, 15] MB band.
    COMPRESSION_TARGET_SIZE_MB: float = 10.0
    COMPRESSION_TARGET_SIZE_MIN_MB: float = 5.0
    COMPRESSION_TARGET_SIZE_MAX_MB: float = 15.0
    # Max wall-clock time allotted to compression before falling back to
    # uploading the original (Req 32 fallback path).
    COMPRESSION_MAX_TIME_MS: int = 30_000

    # ── Chunked Upload (Req 33) ──
    # Per-chunk size; bounded to [1, 50] MB (Req 33.1).
    CHUNK_SIZE_MB: float = 5.0
    CHUNK_SIZE_MIN_MB: float = 1.0
    CHUNK_SIZE_MAX_MB: float = 50.0
    CHUNK_MAX_RETRIES: int = 3
    # Resume window: an interrupted upload may resume from the first unverified
    # chunk within this window; afterwards the session expires (Req 33).
    UPLOAD_RESUME_WINDOW_HOURS: int = 24

    # ── Duplicate Detection (Req 34) / Abuse Protection (Req 47) ──
    # Max time to look up an existing analysis by (user, video_hash, version)
    # before bypassing the cache and running the pipeline normally (Req 34.2).
    DUPLICATE_LOOKUP_TIMEOUT_MS: int = 2_000
    # Minimum exercise-content confidence; below this the content is treated as
    # non-exercise / abusive and rejected (Req 47.5).
    ABUSE_CONTENT_THRESHOLD: float = 0.6

    # ── Recording Assistant (Req 35 / 46) ──
    # How often the live camera preview is analysed (Req 35.1, 35.5).
    RECORDING_REFRESH_INTERVAL_MS: int = 300
    # Max latency to return updated guidance after analysing a preview frame.
    RECORDING_MAX_ANALYSIS_LATENCY_MS: int = 200
    # Configured severity ranking used to order corrective instructions
    # (Req 35.3); most-blocking conditions first.
    RECORDING_SEVERITY_ORDER: list[str] = Field(
        default_factory=lambda: [
            "multiple_people",
            "body_cropped",
            "head_missing",
            "feet_missing",
            "distance_too_far",
            "distance_too_close",
            "camera_too_low",
            "camera_too_high",
            "wrong_orientation",
            "poor_lighting",
            "backlight",
            "camera_shaking",
        ]
    )

    # ── Retry Manager (Req 36) ──
    # Max retry attempts (bounded [0, 10]); exponential backoff with jitter
    # (Req 36.3).
    RETRY_MAX: int = 3
    RETRY_MAX_LIMIT: int = 10
    RETRY_INITIAL_DELAY_MS: int = 200
    RETRY_MULTIPLIER: float = 2.0
    RETRY_MAX_DELAY_MS: int = 10_000
    RETRY_MAX_JITTER_MS: int = 250

    # ── GPU Failure Recovery (Req 37) ──
    GPU_MAX_RESTART_ATTEMPTS: int = 3
    # Worker is marked unhealthy when failures exceed GPU_FAILURE_LIMIT within
    # GPU_FAILURE_WINDOW_MS (Req 37 health monitor).
    GPU_FAILURE_LIMIT: int = 5
    GPU_FAILURE_WINDOW_MS: int = 300_000
    # Fallback model selected when the active model fails to recover (Req 35.5).
    GPU_FALLBACK_MODEL: str = "movenet"
    WORKER_HEALTH_POLL_S: int = 15

    # ── Caches (Req 38, 39) ──
    # LRU capacity for the frame and pose caches; absent/invalid → safe default
    # (Req 37.8, 38.1).
    FRAME_CACHE_MAX: int = 2_000
    POSE_CACHE_MAX: int = 2_000

    # ── Human Review (Req 42) / Active Models (Req 43) ──
    # Confidence at/above which a result is Confident; below → Needs Review.
    # Bounded to [0, 1] (Req 42.3); an out-of-range value falls back to default.
    REVIEW_THRESHOLD: float = 0.6
    # Config-selectable active models behind the common registry interface
    # (Req 43.4).
    ACTIVE_VISION_MODEL: str = "mediapipe"
    ACTIVE_POSE_MODEL: str = "mediapipe"
    ACTIVE_REASONING_MODEL: str = "default"

    # ── Offline Queue (Req 45) / Admin (Req 39/46) / Secure Storage (Req 51) ──
    # Max upload retries for an offline-queued recording before it is marked
    # Failed and retained in local storage (Req 45.6).
    OFFLINE_MAX_UPLOAD_RETRIES: int = 5
    # Max time to detect restored connectivity before draining the queue.
    OFFLINE_RECONNECT_DETECT_S: int = 30
    # Admin analytics metric emission / aggregation intervals (Req 39.1, 46.1).
    # Emission interval must not exceed 60 s and the rolling aggregation window
    # is 5 minutes (Req 46.1). Interval values are informational for the
    # aggregate view — collection is a cheap, off-hot-path composition.
    ADMIN_METRIC_INTERVAL_S: int = 60
    ADMIN_AGGREGATION_WINDOW_MIN: int = 5
    # Whether the Admin_Analytics_Service composes and exposes the aggregate
    # admin metrics snapshot (Req 46). When False it is a no-op that surfaces an
    # empty, all-unavailable snapshot — no client flow is ever affected.
    ADMIN_ANALYTICS_ENABLED: bool = True
    # Secure-delete bounds: max retries and the post-termination deadline within
    # which every temporary artifact must be securely deleted (Req 51.5).
    SECURE_DELETE_MAX_RETRIES: int = 3
    SECURE_DELETE_DEADLINE_S: int = 5

    # ── Cost Tracking (Req 40) ──
    # Whether per-analysis cost telemetry is recorded at terminal job state
    # (Req 40.1). When False the service is a no-op — the client result is
    # never affected (Req 40.3, 40.5).
    COST_TRACKING_ENABLED: bool = True
    # Deadline within which exactly one Cost_Record must be recorded after a
    # job reaches a terminal state (Req 40.1). Recording is a cheap, off-hot-
    # path operation, so this bound is informational/observability only.
    COST_RECORD_DEADLINE_S: int = 5

    # ── Benchmark Dataset Builder (Req 41) ──
    # Whether incorrect predictions (via manual correction) are recorded as
    # benchmark samples for future training (never stores the original video).
    BENCHMARK_ENABLED: bool = True

    # ── Bounds validators — clamp/reset out-of-range values to safe defaults ──

    @field_validator("COMPRESSION_TARGET_SIZE_MB")
    @classmethod
    def _validate_compression_size(cls, v: float) -> float:
        # Documented band is [5, 15] MB; reset to the safe default otherwise.
        if not (5.0 <= v <= 15.0):
            return 10.0
        return v

    @field_validator("CHUNK_SIZE_MB")
    @classmethod
    def _validate_chunk_size(cls, v: float) -> float:
        # Chunk size must be within [1, 50] MB (Req 33.1).
        if not (1.0 <= v <= 50.0):
            return 5.0
        return v

    @field_validator("RETRY_MAX")
    @classmethod
    def _validate_retry_max(cls, v: int) -> int:
        # Retry count is bounded [0, 10] (Req 36.3).
        if not (0 <= v <= 10):
            return 3
        return v

    @field_validator("REVIEW_THRESHOLD", "ABUSE_CONTENT_THRESHOLD", "COMPRESSION_TARGET_QUALITY")
    @classmethod
    def _validate_unit_interval(cls, v: float) -> float:
        # Confidence/quality thresholds must lie in [0, 1] (Req 42.3, 47.5).
        if not (0.0 <= v <= 1.0):
            return 0.6
        return v

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings_v2 = SettingsV2()
