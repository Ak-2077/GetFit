from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen3:14b"
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"
    REDIS_URL: str = "redis://localhost:6379/0"
    API_PORT: int = 8100
    DEBUG: bool = True

    # ── Multi-Model Specialization ──
    # FAST: tiny model for routing, intent classification, topic detection (~1-2B params)
    OLLAMA_FAST_MODEL: str = "qwen3:1.7b"
    # MAIN: primary generation model (default OLLAMA_MODEL)
    # EVALUATOR: independent evaluation model
    OLLAMA_EVALUATOR_MODEL: str = "qwen3:8b"
    # COMPRESSOR: lightweight model for memory summarization/compression
    OLLAMA_COMPRESSOR_MODEL: str = "qwen3:1.7b"
    # VISION: model for food image recognition (must support vision capability)
    # Fast vision model (moondream ~1.7GB) for quick food identification
    OLLAMA_VISION_FAST_MODEL: str = "moondream"
    # Fallback/heavy vision model (qwen3.6 36B MoE) — slower but more detailed
    OLLAMA_VISION_MODEL: str = "qwen3.6"

    # ── Vision Adapter (modular vision backend) ──
    # Primary vision model for food analysis. Options: "qwen2.5-vl", "moondream", "gemini", "florence2"
    VISION_PRIMARY: str = "qwen2.5-vl"
    # Fallback vision model used if primary fails/times out/unavailable
    VISION_FALLBACK: str = "moondream"
    # Ollama model tag for Qwen2.5-VL (pull with: ollama pull qwen2.5vl:7b)
    OLLAMA_QWEN_VL_MODEL: str = "qwen2.5vl:7b"
    # Per-request vision timeout (seconds)
    VISION_TIMEOUT: float = 60.0
    # Fallback vision timeout (seconds) — shorter since it's the safety net
    VISION_FALLBACK_TIMEOUT: float = 30.0
    # Gemini Vision API key (future)
    GEMINI_API_KEY: str = ""
    # Nutrition estimation model — text-only, uses qwen3:8b for structured JSON
    OLLAMA_NUTRITION_MODEL: str = "qwen3:8b"
    # Keep-alive duration (seconds) — keeps models loaded in VRAM
    # 24h = models stay warm, avoids cold-start latency on first request
    OLLAMA_KEEP_ALIVE: int = 86400

    # Semantic cache TTL defaults (seconds)
    CACHE_TTL_SHORT: int = 1800     # 30min for casual/motivation
    CACHE_TTL_DEFAULT: int = 21600  # 6h for general
    CACHE_TTL_LONG: int = 86400     # 24h for factual/education

    # ── AI Exercise Analysis Pipeline ──
    # Engine / strategy selection (config-driven, swappable per Req 7/19/20/25/30)
    # Active pose engine: mediapipe|movenet|blazepose|openpose
    POSE_ENGINE: str = "mediapipe"
    # Landmark smoothing algorithm: one_euro|kalman|savitzky_golay|moving_average
    SMOOTHING_ALGORITHM: str = "one_euro"
    # Background job queue backend: bullmq|redis|rabbitmq|sqs
    QUEUE_BACKEND: str = "bullmq"
    # Progress delivery transport: poll|push|both
    PROGRESS_TRANSPORT: str = "poll"
    # Frame sampling strategy: every|every_n|every_ms|adaptive
    FRAME_SAMPLING: str = "every_n"

    # Video validation thresholds (Req 3.x) — all read from config, never hardcoded
    SUPPORTED_FORMATS: list[str] = Field(default_factory=lambda: ["mp4", "mov"])
    SUPPORTED_CODECS: list[str] = Field(default_factory=lambda: ["h264", "hevc"])
    MIN_DURATION_SEC: float = 2.0
    MAX_DURATION_SEC: float = 60.0
    # Resolution bounds (Req 2.4) — min/max frame dimensions in pixels
    MIN_WIDTH: int = 240
    MIN_HEIGHT: int = 240
    MAX_WIDTH: int = 3840
    MAX_HEIGHT: int = 3840
    # Frame-rate bounds (Req 2.4) — frames per second
    MIN_FPS: float = 10.0
    MAX_FPS: float = 120.0
    # File-size bound (Req 2.4) — maximum accepted upload size in bytes (200 MiB)
    MAX_SIZE_BYTES: int = 209_715_200

    # Frame extraction / key-frame selection (Req 4.x, 5.x)
    FRAME_SAMPLE_N: int = 5          # sample every Nth frame (every_n strategy)
    FRAME_SAMPLE_MS: float = 200.0   # sample every N ms (every_ms strategy)
    MAX_KEYFRAMES: int = 30          # max key frames passed downstream
    # Key-frame near-duplicate threshold (Req 5.2): two frames are near-duplicates
    # when the distance between their feature vectors is below this value.
    KEYFRAME_SIMILARITY_THRESHOLD: float = 0.05

    # Frame quality thresholds (Req 4.x, 22.4) — minimum acceptable score per metric
    QUALITY_THRESHOLDS: dict = Field(
        default_factory=lambda: {
            "blur": 0.3,
            "brightness": 0.2,
            "contrast": 0.2,
            "motion_blur": 0.3,
            "camera_shake": 0.5,
            "body_visibility": 0.5,
            "occlusion": 0.5,
        }
    )
    MIN_BRIGHTNESS: float = 0.2
    MAX_CAMERA_SHAKE: float = 0.5

    # Camera guidance thresholds (Req 22.x) — recording-setup detection, all
    # read from configuration (Req 22.4); never hardcoded in the stage.
    CAMERA_MIN_BODY_COVERAGE: float = 0.95   # below → body cut off (fraction of body kept in frame)
    CAMERA_MIN_BODY_AREA: float = 0.15       # below → body too small (fraction of frame area filled)
    CAMERA_MAX_BODY_AREA: float = 0.80       # above → body too close (fraction of frame area filled)
    CAMERA_MAX_VIEW_ANGLE_DEG: float = 30.0  # above → incorrect recording angle (degrees off frontal)
    CAMERA_MIN_BRIGHTNESS: float = 0.2       # below → poor lighting (mean luminance, 0..1)
    CAMERA_MAX_SHAKE: float = 0.5            # above → excessive camera shake (normalized, 0..1)
    CAMERA_EXPECTED_ORIENTATION: str = "portrait"  # mismatch → incorrect orientation
    CAMERA_MAX_PEOPLE: int = 1               # above → multiple people present

    # ── Person Validation Layer (additive, false "multiple people" fix) ──────
    # Distinguishes a real moving athlete from static printed people (posters,
    # banners, wall graphics), mirror reflections, TV screens, and background
    # spectators. Only 2+ genuine athletes cause a MULTIPLE_PEOPLE rejection.
    # All thresholds are config-driven and normalized to the frame (0..1).
    PERSON_VALIDATION_ENABLED: bool = True
    # A tracked person qualifies as a REAL athlete only when ALL hold:
    PV_ATHLETE_MIN_MOTION: float = 0.006     # mean per-frame centroid travel (normalized)
    PV_ATHLETE_MIN_POSE_CONFIDENCE: float = 0.45  # mean pose confidence
    PV_ATHLETE_MIN_AREA: float = 0.08        # mean bbox area as a fraction of the frame
    PV_ATHLETE_MIN_VISIBLE_FRACTION: float = 0.6  # seen in ≥60% of processed frames
    PV_ATHLETE_MAX_CENTER_DIST: float = 0.45 # mean center within this radius of frame center
    # Classification helpers (best-effort labels for logging/telemetry):
    PV_STATIC_MOTION_MAX: float = 0.004      # below → treated as a static/printed person
    PV_SPECTATOR_MAX_AREA: float = 0.15      # small background people are ignored
    PV_MIRROR_MIN_ANTICORR: float = 0.5      # anti-correlated horizontal motion → mirror
    # Frame-to-frame tracker association distance (normalized centroid distance).
    PV_TRACK_MATCH_DIST: float = 0.15
    # Composite primary-athlete selection weights (Stage 5). Must sum to 1.0.
    PV_SELECTION_WEIGHTS: dict = Field(
        default_factory=lambda: {
            "motion": 0.40,
            "pose_confidence": 0.25,
            "area": 0.15,
            "centered": 0.10,
            "visible_duration": 0.10,
        }
    )


    # Confidence thresholds (Req 6.x, 21.x)
    DETECTION_CONFIDENCE_MIN: float = 0.5       # exercise detection gate (Req 6.3)
    POSE_LANDMARK_CONFIDENCE_MIN: float = 0.3   # per-landmark reject (Req 21.1)
    POSE_OVERALL_CONFIDENCE_MIN: float = 0.5    # overall pose gate (Req 21.5)

    # Reasoning confidence thresholds (Req 10.4, 15.5) — config-driven, never
    # hardcoded in the Reasoning_Service.
    # When the supporting Objective_Metrics Confidence_Score is below this value,
    # the Reasoning_Service marks its output low confidence (Req 10.4) but still
    # returns it.
    REASONING_CONFIDENCE_MIN: float = 0.5
    # When the overall analysis Confidence_Score is below this value, the
    # Reasoning_Service returns a Structured_Error with code `LOW_CONFIDENCE`
    # (Req 15.5). Kept at or below REASONING_CONFIDENCE_MIN so that a borderline
    # result is marked low-confidence before it becomes a fatal failure.
    OVERALL_CONFIDENCE_MIN: float = 0.3

    # Landmark validation (Req 26.x) — every anatomical/transition threshold is
    # read from configuration so the Landmark_Validation_Service hardcodes none
    # of them (Req 26.4, 26.5).
    # Max normalized inter-frame displacement of any single landmark (Req 26.3).
    MAX_LANDMARK_JUMP: float = 0.25
    # Anatomical bone-length plausibility (Req 26.2): each bone's length is
    # measured RELATIVE to the subject's torso reference length (mid-shoulder to
    # mid-hip) and must lie within these ratio bounds. Expressing the bounds as a
    # ratio to a body-scale reference keeps the check resolution-independent
    # (Req 7.4) — a bone collapsing toward zero or stretching far beyond the
    # torso is anatomically impossible regardless of how large the subject
    # appears in frame.
    BONE_LENGTH_MIN_RATIO: float = 0.05
    BONE_LENGTH_MAX_RATIO: float = 3.0
    # Anatomical joint-angle bounds in degrees (Req 26.1): the unsigned angle at
    # each hinge joint, formed by its two connected bones, must lie within
    # [min, max]. Defaults span the full geometric range so a valid pose is never
    # falsely rejected; tighten per deployment to enforce stricter limb
    # orientation limits. The bounds are fully config-driven (Req 26.5).
    ANATOMICAL_ANGLE_BOUNDS: dict = Field(
        default_factory=lambda: {
            "left_elbow": [0.0, 180.0],
            "right_elbow": [0.0, 180.0],
            "left_knee": [0.0, 180.0],
            "right_knee": [0.0, 180.0],
        }
    )

    # Confidence fusion weights (Req 27.x) — must sum to 1.0; no single source dominates
    FUSION_WEIGHTS: dict = Field(
        default_factory=lambda: {
            "vision": 0.15,
            "pose": 0.2,
            "detection": 0.15,
            "movement_quality": 0.15,
            "biomechanics": 0.2,
            "reasoning": 0.15,
        }
    )
    FUSION_MAX_SINGLE_WEIGHT: float = 0.4   # cap so no single source dominates (Req 27.3)

    # Rep counting (Req 23.x) — generic movement-cycle detection parameters, all
    # read from configuration (Req 23.4); never hardcoded in the stage. The
    # detector reasons about a single exercise-agnostic 1-D movement signal (the
    # vertical position of the hips, falling back to the whole-body centroid),
    # the same reference convention the Movement_Phase_Service uses (Req 23.2 —
    # no exercise-specific rules).
    # Minimum oscillation amplitude (in normalized units) below which the signal
    # is treated as static — no measurable travel, so zero reps are detected.
    REP_MIN_AMPLITUDE: float = 1e-3
    # Hysteresis band width as a fraction of the signal's full range. A rep is
    # only counted when the signal travels from one zone, past this central dead
    # zone, to the opposite zone and back. A wider band rejects more noise.
    REP_HYSTERESIS_FRACTION: float = 0.3

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
