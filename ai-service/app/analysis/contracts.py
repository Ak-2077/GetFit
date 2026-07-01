"""
Analysis Pipeline — Stage Data Contracts (Pydantic v2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Typed, validated, serializable data structures exchanged between pipeline
stages. Every PipelineStage input/output (see `base.py`) is one of these
models, which keeps the pipeline modular and model-agnostic.

Design invariants enforced here via Pydantic `Field` constraints:
  • Landmark coordinates are normalized and resolution-independent (Req 7.4):
    x/y are bounded to [0.0, 1.0]; z is a relative, normalized depth.
  • Every confidence value is bounded to [0.0, 1.0] (Req 21.1, 27.x).

Mirrors the data-model definitions in design.md and follows the Pydantic v2
conventions used across `app/models/schemas.py` and `app/vision/`.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, SerializerFunctionWrapHandler, model_serializer

# V2 (Production Extensions) additive types. Imported (not redefined) so the V2
# optional fields below reuse the single source-of-truth definitions in
# `app/analysis_v2/models_v2.py` (Req 52.6). No import cycle: `models_v2` only
# imports `app.analysis.base` under TYPE_CHECKING, and `base` imports nothing
# from this module — so this runtime import resolves cleanly.
from app.analysis_v2.models_v2 import ReviewStatus, ScoreExplanation


# A bounded probability/confidence in the closed interval [0.0, 1.0].
def _confidence(description: str = "Confidence in [0.0, 1.0]") -> float:
    return Field(..., ge=0.0, le=1.0, description=description)


# ── Video Validation (Video_Validation_Service: VideoRef → VideoMeta) ──

class VideoMeta(BaseModel):
    """Validated metadata describing the input video (Req 2.x)."""
    container_format: str
    codec: str
    duration_sec: float = Field(..., ge=0.0)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)
    fps: float = Field(..., gt=0.0)
    size_bytes: int = Field(..., ge=0)
    orientation: str            # "portrait" | "landscape"


# ── Frame Extraction (Frame_Extraction_Service: VideoMeta → FrameSet) ──

class Frame(BaseModel):
    """
    A single extracted frame reference.

    Pixel data is referenced by a transient path/handle and is NEVER persisted
    (Req 1.x); only the index and relative timestamp are carried in-contract.
    """
    index: int = Field(..., ge=0)
    timestamp_ms: float = Field(..., ge=0.0)   # relative to start of video (Req 3.6)


class FrameSet(BaseModel):
    """An ordered collection of extracted frames plus their source metadata."""
    frames: list[Frame]
    source_meta: VideoMeta


# ── Frame Quality (Frame_Quality_Service: FrameSet → QualityScoredFrames) ──

class FrameQuality(BaseModel):
    """Per-frame visual quality scores (Req 4.1, 4.2)."""
    blur: float
    brightness: float
    contrast: float
    motion_blur: float
    camera_shake: float
    body_visibility: float
    occlusion: float


class QualityScoredFrame(BaseModel):
    """A frame paired with its quality scores and retention decision (Req 4.3)."""
    frame: Frame
    quality: FrameQuality
    retained: bool


class QualityScoredFrames(BaseModel):
    """
    The Frame_Quality_Service output: an ordered collection of quality-scored
    frames plus the source metadata. Frames flagged `retained=False` have been
    discarded for low quality (Req 4.3) and are excluded by the
    Key_Frame_Selector (Req 5.1).
    """
    frames: list[QualityScoredFrame]
    source_meta: VideoMeta

    @property
    def retained(self) -> list[QualityScoredFrame]:
        """The subset of frames that met every configured quality threshold."""
        return [sf for sf in self.frames if sf.retained]


# ── Key Frame Selection (Key_Frame_Selector: QualityScoredFrames → KeyFrames) ──

class KeyFrames(BaseModel):
    """
    The Key_Frame_Selector output: a representative subset of high-quality
    frames in strictly increasing chronological order (Req 5.4), bounded by
    `MAX_KEYFRAMES` (Req 5.1), with near-duplicates removed (Req 5.2) and
    movement-transition frames preferred over static ones (Req 5.3).
    """
    frames: list[Frame]
    source_meta: VideoMeta


# ── Camera Guidance (Camera_Guidance_Service: FrameSet → CameraGuidance) ──

class CameraIssue(BaseModel):
    """
    A single detected recording problem with an actionable correction.

    Covers conditions such as body cut off, body too small/close, incorrect
    angle, poor lighting, excessive shake, wrong orientation, and multiple
    people (Req 22.2).
    """
    issue: str                                  # detected condition identifier
    recommendation: str                         # non-empty actionable correction (Req 22.3)


class CameraGuidance(BaseModel):
    """
    Structured, actionable recording guidance produced before pose extraction.

    When issues are present, `suitable` is False and each issue carries a
    recommendation (Req 22.3); when no issues are detected, `suitable` is True
    and `issues` is empty (Req 22.4).
    """
    suitable: bool
    issues: list[CameraIssue] = []


# ── Pose Extraction (Pose_Extraction_Service: KeyFrames → Landmarks) ──

class Landmark(BaseModel):
    """
    A single body landmark in a normalized, resolution-independent coordinate
    space (Req 7.4). x/y are bounded to [0.0, 1.0]; z is a relative normalized
    depth. `confidence` is the per-landmark Pose_Confidence in [0,1] (Req 21.1).
    """
    x: float = Field(..., ge=0.0, le=1.0)       # normalized [0,1], resolution-independent (Req 7.4)
    y: float = Field(..., ge=0.0, le=1.0)
    z: float = 0.0                              # normalized relative depth
    confidence: float = _confidence("Per-landmark Pose_Confidence in [0,1] (Req 21.1)")


class FrameLandmarks(BaseModel):
    """Landmarks for one frame in fixed joint order (COCO-17 convention)."""
    timestamp_ms: float = Field(..., ge=0.0)
    landmarks: list[Landmark]                   # fixed joint order (COCO-17 convention from pose.py)
    overall_confidence: float = _confidence("Overall pose confidence in [0,1] (Req 21.1)")


class Landmarks(BaseModel):
    """
    The Pose_Extraction_Service output (Req 7.1): an ordered collection of
    per-frame normalized landmarks produced by the active Pose_Engine, plus the
    source metadata and the identifier of the engine that produced them.

    Coordinates are normalized and resolution-independent (enforced per
    `Landmark`, Req 7.4) and every landmark carries a Pose_Confidence (Req 21.1).
    `pose_engine` records which swappable engine produced the data so the
    interface stays stable across engine changes (Req 7.2, 7.3, 31.2) and the
    value can flow into Analysis_Versioning (Req 29.1).
    """
    frames: list[FrameLandmarks]
    source_meta: VideoMeta
    pose_engine: str = ""


# ── Movement Timeline (Timeline_Builder: Landmarks → MovementTimeline) ──

class TimelineEntry(BaseModel):
    """A single time-ordered sample of joint state derived from landmarks."""
    timestamp_ms: float = Field(..., ge=0.0)
    joint_positions: dict[str, list[float]]
    joint_angles: dict[str, float]
    joint_velocity: dict[str, float]
    joint_acceleration: dict[str, float]
    movement_direction: dict[str, float]


class MovementTimeline(BaseModel):
    """Time-ordered movement entries, ordered by timestamp_ms (Req 8.1)."""
    entries: list[TimelineEntry]                # ordered by timestamp_ms (Req 8.1)


# ── Movement Phases (Movement_Phase_Service: MovementTimeline → MovementPhases) ──

class MovementPhase(BaseModel):
    """A generic movement phase with start/end timestamps (Req 24.x)."""
    phase: str                                  # Start|Eccentric|Bottom|Concentric|Top
    start_ms: float = Field(..., ge=0.0)
    end_ms: float = Field(..., ge=0.0)


class MovementPhases(BaseModel):
    """
    The Movement_Phase_Service output: the generic, exercise-agnostic phase
    segmentation of a Movement_Timeline (Req 8.3, 24.x).

    `phases` are drawn from the generic set {Start, Eccentric, Bottom,
    Concentric, Top} (Req 24.1), each carrying its start/end timestamp
    (Req 24.4), in chronological order and non-overlapping (Req 24.4). This
    typed model is the stable, plugin-consumable interface a future
    Exercise_Plugin reads phases from (Req 24.3) — no per-exercise logic is
    embedded in the segmentation itself (Req 24.2).
    """
    phases: list[MovementPhase] = Field(default_factory=list)


# ── Rep Counting (Rep_Counting_Service: MovementTimeline → RepetitionSummary) ──

class RepetitionSummary(BaseModel):
    """Generic movement-cycle repetition summary (Req 23.x)."""
    rep_count: int = Field(..., ge=0)
    phase_timestamps: list[list[MovementPhase]]
    avg_rep_duration_ms: float = Field(..., ge=0.0)
    movement_consistency: float = _confidence("Movement consistency in [0,1]")


# ── Biomechanics (Biomechanics_Service: MovementTimeline → ObjectiveMetrics) ──

class ObjectiveMetrics(BaseModel):
    """
    Deterministic biomechanical metrics computed by the Biomechanics_Service
    (Req 9.x). Math only — no language-model reasoning.
    """
    joint_angles: dict[str, float]
    bar_path: list[list[float]]
    depth: float
    range_of_motion: dict[str, float]
    tempo: float
    symmetry: float
    center_of_mass: list[float]
    balance: float
    confidence: float = _confidence("Metric confidence in [0,1]")


# ── Exercise Detection (Exercise_Detection_Service: KeyFrames → Detection) ──

class Detection(BaseModel):
    """Detected exercise id with confidence and ranked alternatives (Req 6.x)."""
    exercise_id: str
    confidence: float = _confidence("Detection confidence in [0,1]")
    alternatives: list[dict] = []               # [{exercise_id, confidence}], ranked desc


# ── Reasoning (Reasoning_Service: (MovementTimeline, ObjectiveMetrics) → ReasoningOutput) ──

class ReasoningOutput(BaseModel):
    """
    LLM reasoning over structured Objective_Metrics and the Movement_Timeline
    only (Req 10.x). When supporting confidence falls below threshold, the
    output is marked low confidence (Req 10.4).
    """
    strengths: list[str] = []
    mistakes: list[str] = []
    corrections: list[str] = []
    safety_warnings: list[str] = []
    improvement_tips: list[str] = []
    training_advice: list[str] = []
    confidence: float = _confidence("Reasoning confidence in [0,1]")
    low_confidence: bool = False                # Req 10.4


# ── Confidence Fusion (Confidence_Fusion_Service: ConfidenceSources → OverallConfidence) ──

class ConfidenceSources(BaseModel):
    """
    Bounded per-source confidence inputs fused into an overall score (Req 27.x).
    Each source is independently bounded to [0,1].
    """
    vision: float = _confidence("Vision confidence in [0,1]")
    pose: float = _confidence("Pose confidence in [0,1]")
    detection: float = _confidence("Detection confidence in [0,1]")
    movement_quality: float = _confidence("Movement quality confidence in [0,1]")
    biomechanics: float = _confidence("Biomechanics confidence in [0,1]")
    reasoning: float = _confidence("Reasoning confidence in [0,1]")


class OverallConfidence(BaseModel):
    """
    The Confidence_Fusion_Service output: a single calibrated overall
    Confidence_Score fused from the six per-source inputs and bounded to the
    closed interval [0.0, 1.0] (Req 27.1, 27.2). No single source determines
    this value on its own — each source's effective weight is capped before
    fusion (Req 27.3).
    """
    overall: float = _confidence("Fused overall confidence in [0,1] (Req 27.1, 27.2)")


# ── Cleanup (Cleanup_Service: ArtifactSet → CleanupReport) ──

class ArtifactSet(BaseModel):
    """
    The per-job set of Temporary_Artifacts created during processing
    (Req 12.x). Each entry is an opaque transient location — the original video
    file, an extracted-frame handle, a pose image, or a temporary working
    directory (Req 1.1, 1.5). Locations are referenced by handle only; no
    artifact bytes are ever carried in-contract.
    """
    job_id: str
    locations: list[str] = Field(default_factory=list)


class CleanupReport(BaseModel):
    """
    The Cleanup_Service output: the set of artifact locations that were deleted
    (Req 12.4). `deleted` lists every location no longer present after cleanup;
    `failed` lists any location that could not be removed. `complete` is True
    only when nothing remains (`failed` is empty), giving the pipeline a single
    flag to record a cleanup failure (Analytics cleanup-failure count, Req 30.1).
    """
    job_id: str
    deleted: list[str] = Field(default_factory=list)
    failed: list[str] = Field(default_factory=list)
    complete: bool = True


# ── Feedback (Feedback_Service → AnalysisResult) ──

class AnalysisResult(BaseModel):
    """
    The bounded, persisted analysis result (Req 11, Req 13, Req 29).

    EXCLUDES original video, frames, pose images, and temporary files
    (Req 13.2, 29.3) — only the fields below are persisted by the backend.
    """
    exercise_id: str                            # Req 13.1
    analysis_date: str                          # ISO timestamp
    overall_score: float
    # Scores (Req 11.1)
    movement_score: float
    range_of_motion: dict[str, float]
    tempo: float
    stability: float
    symmetry: float
    joint_alignment: dict[str, float]
    # Qualitative feedback (Req 11.2)
    strengths: list[str]
    mistakes: list[str]
    corrections: list[str]
    safety_warnings: list[str]
    improvement_tips: list[str]
    training_advice: list[str]
    # Movement metrics + reps
    movement_metrics: ObjectiveMetrics
    repetition_summary: RepetitionSummary
    overall_confidence: float = _confidence("Overall fused confidence in [0,1]")
    low_confidence: bool                        # Req 11.4
    # User corrections (Req 13.3)
    user_corrections: list[dict] = []
    # Versioning metadata (Req 29.1)
    analysisVersion: str
    poseEngineVersion: str
    visionModelVersion: str
    reasoningModelVersion: str
    pipelineVersion: str
    # ── V2 additive fields (Production Extensions) ───────────────────────────
    # Strictly OPTIONAL and additive (Req 52.3, 52.5): a result constructed
    # WITHOUT these fields serializes to the EXACT V1 shape (see the
    # `_drop_v2_defaults_at_v1_shape` serializer below). These carry only
    # derived scalars/structures — NO video, frame, or pose data is introduced,
    # preserving the persisted-record privacy boundary (Req 13.2, 29.3).
    #
    #   • review_status      — Human_Review_Mode gate outcome (Req 42.1).
    #                          `None` ⇒ not gated ⇒ field omitted (V1 shape).
    #   • score_explanations — Explainable_Feedback per-score factor weightings
    #                          (Req 49.1). `[]` ⇒ nothing explained ⇒ omitted.
    review_status: ReviewStatus | None = None
    score_explanations: list[ScoreExplanation] = Field(default_factory=list)

    @model_serializer(mode="wrap")
    def _drop_v2_defaults_at_v1_shape(
        self, handler: SerializerFunctionWrapHandler
    ) -> dict[str, Any]:
        """
        Preserve the EXACT V1 serialized shape when the additive V2 fields are
        absent (i.e. left at their defaults) (Req 52.3, 52.5).

        Pydantic includes every field by default, which would leak
        ``review_status: null`` / ``score_explanations: []`` into the output of
        a V1-equivalent result. To keep the V2 fields truly additive, this wrap
        serializer drops each one whenever it still holds its default value, so
        ``model_dump()`` / ``model_dump_json()`` of a result built without the
        V2 fields is byte-for-byte identical to the V1 shape. When a field is
        populated (review gating ran, or explanations were attached) it is
        serialized normally.
        """
        data = handler(self)
        if self.review_status is None:
            data.pop("review_status", None)
        if not self.score_explanations:
            data.pop("score_explanations", None)
        return data


# ── Analysis_Versioning (Req 29) ──

#: Version of the analysis result schema/feature itself (Version 1 Foundation).
ANALYSIS_VERSION: str = "1.0.0"
#: Version of the end-to-end Analysis_Pipeline wiring (Version 1 Foundation).
PIPELINE_VERSION: str = "1.0.0"


def build_analysis_versioning(
    *,
    pose_engine_version: str,
    vision_model_version: str,
    reasoning_model_version: str,
    analysis_version: str = ANALYSIS_VERSION,
    pipeline_version: str = PIPELINE_VERSION,
) -> dict[str, str]:
    """
    Assemble the Analysis_Versioning metadata persisted with an AnalysisResult
    (Req 29.1, 29.2).

    The values are sourced from the active engine/model identifiers:
      • `pose_engine_version` ← active Pose_Engine `engine.version`
        (see `adapters/pose_engines.py`).
      • `vision_model_version` / `reasoning_model_version` ← the configured
        vision and reasoning model identifiers.
      • `analysis_version` / `pipeline_version` default to the current
        feature/pipeline versions and may be overridden per deployment.

    Returns ONLY the five version fields as a plain mapping so the
    Feedback_Service can splat it into `AnalysisResult(**scores, **versions)`.
    This is purely additive metadata — it carries no video, frame, pose-image,
    or temporary-file data, preserving the privacy boundary (Req 29.3).
    """
    return {
        "analysisVersion": analysis_version,
        "poseEngineVersion": pose_engine_version,
        "visionModelVersion": vision_model_version,
        "reasoningModelVersion": reasoning_model_version,
        "pipelineVersion": pipeline_version,
    }
