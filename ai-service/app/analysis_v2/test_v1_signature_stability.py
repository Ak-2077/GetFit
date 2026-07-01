"""
V1 Signature / Contract Stability — Snapshot Test (Task 32.1, Req 52.1/52.2/52.4/52.7)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is a *contract / snapshot* test. It pins the public shape of every V1
component so that adding the Version 2 (Production Extensions) surface CANNOT
silently drift any V1 interface, adapter, or data contract.

What it guards (all against inline, self-contained expected snapshots):

  • V1 `PipelineStage` subclasses (Req 52.1): every V1 stage still subclasses
    `PipelineStage`, still exposes its exact stable `name`, and still exposes a
    `run(self, data)` coroutine with byte-identical parameter names.
  • V1 adapters (Req 52.4): the `JobQueueAdapter`, `PoseEngine`,
    `ProgressTransport`, and `SmoothingAlgorithm` ABCs plus the `Progress_Service`
    facade still expose their exact public methods with byte-identical parameter
    names, and their stable `name`/`version` identifiers are unchanged.
  • V1 data contracts (Req 52.3, verified here to protect 52.2/52.7): every V1
    contract model still declares exactly its recorded field set. For
    `AnalysisResult` specifically, the two V2 fields (`review_status`,
    `score_explanations`) are OPTIONAL/additive, and a result built WITHOUT them
    serializes to the byte-exact V1 shape (no extra keys leak).

If any assertion here fails, a V1 signature/contract has drifted — that is a
REAL regression of Req 52 (the V2 change was not additive), NOT a reason to
loosen the snapshot. The fix is to make the offending V2 change additive again.

Run: venv\\Scripts\\python.exe -m pytest app/analysis_v2/test_v1_signature_stability.py -q
"""

from __future__ import annotations

import inspect
from typing import Any

import pytest

# ── V1 imports (the surfaces under snapshot) ──────────────────────────────────
from app.analysis.base import PipelineStage, StageResult, StructuredError
from app.analysis import contracts as c
from app.analysis.adapters.job_queue import JobQueueAdapter
from app.analysis.adapters.pose_engines import PoseEngine
from app.analysis.adapters.progress import ProgressTransport, Progress_Service
from app.analysis.adapters.smoothing import SmoothingAlgorithm

# Every concrete V1 PipelineStage subclass, imported from its own module so the
# snapshot does not depend on package __all__ re-exports.
from app.analysis.stages.video_validation import VideoValidationService
from app.analysis.stages.frame_extraction import FrameExtractionService
from app.analysis.stages.frame_quality import FrameQualityService
from app.analysis.stages.key_frame_selector import KeyFrameSelector
from app.analysis.stages.exercise_detection import ExerciseDetectionService
from app.analysis.stages.pose_extraction import PoseExtractionService
from app.analysis.stages.pose_confidence_validator import PoseConfidenceValidator
from app.analysis.stages.landmark_validation import LandmarkValidationService
from app.analysis.stages.smoothing_adapter import SmoothingAdapter
from app.analysis.stages.movement_timeline import MovementTimelineService
from app.analysis.stages.movement_phase import MovementPhaseService
from app.analysis.stages.rep_counting import RepCountingService
from app.analysis.stages.biomechanics import BiomechanicsService
from app.analysis.stages.confidence_fusion import ConfidenceFusionService
from app.analysis.stages.reasoning import ReasoningService
from app.analysis.stages.feedback import FeedbackService
from app.analysis.stages.camera_guidance import CameraGuidanceService
from app.analysis.stages.cleanup import CleanupService


# ── Snapshot helpers ─────────────────────────────────────────────────────────

def _param_names(func: Any) -> list[str]:
    """Ordered parameter names of a callable (byte-stable signature proxy).

    Parameter *names* and their order are the observable, caller-facing part of
    a method's contract; annotations are intentionally excluded because V1 uses
    generic TypeVars whose repr is not stable across typing internals.
    """
    return list(inspect.signature(func).parameters.keys())


def _field_names(model: Any) -> set[str]:
    """The declared field set of a Pydantic v2 model."""
    return set(model.model_fields.keys())


# ══════════════════════════════════════════════════════════════════════════════
# 1. V1 PipelineStage subclass signatures (Req 52.1)
# ══════════════════════════════════════════════════════════════════════════════

# Inline snapshot: {StageClass: expected stable `name`}. Every V1 stage exposes
# `run(self, data)` — the shared stage entry point defined by `PipelineStage`.
V1_STAGE_NAMES: dict[type, str] = {
    VideoValidationService: "video_validation",
    FrameExtractionService: "frame_extraction",
    FrameQualityService: "frame_quality",
    KeyFrameSelector: "key_frame_selection",
    ExerciseDetectionService: "exercise_detection",
    PoseExtractionService: "pose_extraction",
    PoseConfidenceValidator: "pose_confidence_validation",
    LandmarkValidationService: "landmark_validation",
    SmoothingAdapter: "smoothing",
    MovementTimelineService: "movement_timeline",
    MovementPhaseService: "movement_phase",
    RepCountingService: "rep_counting",
    BiomechanicsService: "biomechanics",
    ConfidenceFusionService: "confidence_fusion",
    ReasoningService: "reasoning",
    FeedbackService: "feedback",
    CameraGuidanceService: "camera_guidance",
    CleanupService: "cleanup",
}

EXPECTED_RUN_PARAMS = ["self", "data"]


@pytest.mark.parametrize("stage_cls, expected_name", V1_STAGE_NAMES.items())
def test_v1_stage_is_pipeline_stage_subclass(stage_cls: type, expected_name: str) -> None:
    assert issubclass(stage_cls, PipelineStage), (
        f"{stage_cls.__name__} must remain a PipelineStage subclass (Req 52.1)"
    )


@pytest.mark.parametrize("stage_cls, expected_name", V1_STAGE_NAMES.items())
def test_v1_stage_name_is_byte_stable(stage_cls: type, expected_name: str) -> None:
    assert stage_cls.name == expected_name, (
        f"{stage_cls.__name__}.name drifted: {stage_cls.name!r} != {expected_name!r} "
        f"(Req 52.1 — stage identifier must be unchanged after V2)"
    )


@pytest.mark.parametrize("stage_cls, expected_name", V1_STAGE_NAMES.items())
def test_v1_stage_run_signature_is_byte_stable(stage_cls: type, expected_name: str) -> None:
    run = stage_cls.run
    assert inspect.iscoroutinefunction(run), (
        f"{stage_cls.__name__}.run must remain an async coroutine (Req 52.1)"
    )
    assert _param_names(run) == EXPECTED_RUN_PARAMS, (
        f"{stage_cls.__name__}.run signature drifted: {_param_names(run)} "
        f"!= {EXPECTED_RUN_PARAMS} (Req 52.1)"
    )


def test_v1_stage_snapshot_is_complete() -> None:
    """Guard the snapshot itself: exactly 18 V1 stages are pinned."""
    assert len(V1_STAGE_NAMES) == 18
    assert len(set(V1_STAGE_NAMES.values())) == 18, "stage names must be unique"


# ══════════════════════════════════════════════════════════════════════════════
# 2. V1 adapter signatures (Req 52.4)
# ══════════════════════════════════════════════════════════════════════════════

# Inline snapshot of each adapter interface's public methods → parameter names.
ADAPTER_METHOD_SNAPSHOTS: dict[type, dict[str, list[str]]] = {
    JobQueueAdapter: {
        "enqueue": ["self", "job"],
        "get": ["self", "job_id"],
        "set_state": ["self", "job_id", "state"],
        "set_result": ["self", "job_id", "result"],
        "set_error": ["self", "job_id", "error"],
    },
    PoseEngine: {
        "is_available": ["self"],
        "extract": ["self", "frames"],
    },
    ProgressTransport: {
        "publish": ["self", "job_id", "event"],
        "latest": ["self", "job_id"],
    },
    SmoothingAlgorithm: {
        "smooth": ["self", "landmarks"],
    },
    Progress_Service: {
        "label_for": ["state"],
        "publish": ["self", "job_id", "state", "percent"],
        "publish_event": ["self", "event"],
        "latest": ["self", "job_id"],
    },
}


@pytest.mark.parametrize("adapter_cls, methods", ADAPTER_METHOD_SNAPSHOTS.items())
def test_v1_adapter_method_signatures_are_byte_stable(
    adapter_cls: type, methods: dict[str, list[str]]
) -> None:
    for method_name, expected_params in methods.items():
        assert hasattr(adapter_cls, method_name), (
            f"{adapter_cls.__name__}.{method_name} was removed (Req 52.4)"
        )
        func = getattr(adapter_cls, method_name)
        assert _param_names(func) == expected_params, (
            f"{adapter_cls.__name__}.{method_name} signature drifted: "
            f"{_param_names(func)} != {expected_params} (Req 52.4)"
        )


def test_v1_adapter_stable_identifiers_unchanged() -> None:
    """Adapter ABC identifiers/versions used as registry keys are unchanged."""
    assert JobQueueAdapter.name == "base"
    assert PoseEngine.name == "base"
    assert PoseEngine.version == "0.0.0"
    assert ProgressTransport.name == "base"
    assert SmoothingAlgorithm.name == "base"


# ══════════════════════════════════════════════════════════════════════════════
# 3. V1 data contract field sets (Req 52.3 — protecting 52.2 / 52.7)
# ══════════════════════════════════════════════════════════════════════════════

# Inline snapshot of every V1 contract model → its exact declared field set.
CONTRACT_FIELD_SNAPSHOTS: dict[Any, set[str]] = {
    StructuredError: {"code", "message", "stage", "details"},
    StageResult: {"success", "output", "error"},
    c.VideoMeta: {
        "container_format", "codec", "duration_sec", "width", "height",
        "fps", "size_bytes", "orientation",
    },
    c.Frame: {"index", "timestamp_ms"},
    c.FrameSet: {"frames", "source_meta"},
    c.FrameQuality: {
        "blur", "brightness", "contrast", "motion_blur", "camera_shake",
        "body_visibility", "occlusion",
    },
    c.QualityScoredFrame: {"frame", "quality", "retained"},
    c.QualityScoredFrames: {"frames", "source_meta"},
    c.KeyFrames: {"frames", "source_meta"},
    c.CameraIssue: {"issue", "recommendation"},
    c.CameraGuidance: {"suitable", "issues"},
    c.Landmark: {"x", "y", "z", "confidence"},
    c.FrameLandmarks: {"timestamp_ms", "landmarks", "overall_confidence"},
    c.Landmarks: {"frames", "source_meta", "pose_engine"},
    c.TimelineEntry: {
        "timestamp_ms", "joint_positions", "joint_angles", "joint_velocity",
        "joint_acceleration", "movement_direction",
    },
    c.MovementTimeline: {"entries"},
    c.MovementPhase: {"phase", "start_ms", "end_ms"},
    c.MovementPhases: {"phases"},
    c.RepetitionSummary: {
        "rep_count", "phase_timestamps", "avg_rep_duration_ms", "movement_consistency",
    },
    c.ObjectiveMetrics: {
        "joint_angles", "bar_path", "depth", "range_of_motion", "tempo",
        "symmetry", "center_of_mass", "balance", "confidence",
    },
    c.Detection: {"exercise_id", "confidence", "alternatives"},
    c.ReasoningOutput: {
        "strengths", "mistakes", "corrections", "safety_warnings",
        "improvement_tips", "training_advice", "confidence", "low_confidence",
    },
    c.ConfidenceSources: {
        "vision", "pose", "detection", "movement_quality", "biomechanics", "reasoning",
    },
    c.OverallConfidence: {"overall"},
    c.ArtifactSet: {"job_id", "locations"},
    c.CleanupReport: {"job_id", "deleted", "failed", "complete"},
}


@pytest.mark.parametrize(
    "model, expected_fields",
    list(CONTRACT_FIELD_SNAPSHOTS.items()),
    ids=[m.__name__ for m in CONTRACT_FIELD_SNAPSHOTS],
)
def test_v1_contract_field_set_is_byte_stable(model: Any, expected_fields: set[str]) -> None:
    actual = _field_names(model)
    assert actual == expected_fields, (
        f"{model.__name__} field set drifted: added={actual - expected_fields}, "
        f"removed={expected_fields - actual} (Req 52.3)"
    )


# ── AnalysisResult: V1 base fields + strictly additive V2 fields ──────────────

# The 25 V1 base fields, in declaration order, that MUST all still be present.
ANALYSIS_RESULT_V1_FIELDS: set[str] = {
    "exercise_id", "analysis_date", "overall_score",
    "movement_score", "range_of_motion", "tempo", "stability", "symmetry",
    "joint_alignment",
    "strengths", "mistakes", "corrections", "safety_warnings",
    "improvement_tips", "training_advice",
    "movement_metrics", "repetition_summary",
    "overall_confidence", "low_confidence",
    "user_corrections",
    "analysisVersion", "poseEngineVersion", "visionModelVersion",
    "reasoningModelVersion", "pipelineVersion",
}

# The strictly-additive V2 fields (Req 52.3, 52.5) — present but OPTIONAL.
ANALYSIS_RESULT_V2_ADDITIVE_FIELDS: set[str] = {"review_status", "score_explanations"}


def test_analysis_result_v1_fields_all_present() -> None:
    fields = _field_names(c.AnalysisResult)
    missing = ANALYSIS_RESULT_V1_FIELDS - fields
    assert not missing, f"AnalysisResult lost V1 fields {missing} (Req 52.3 — must not remove)"


def test_analysis_result_only_v2_additions_are_new() -> None:
    fields = _field_names(c.AnalysisResult)
    extra = fields - ANALYSIS_RESULT_V1_FIELDS
    assert extra == ANALYSIS_RESULT_V2_ADDITIVE_FIELDS, (
        f"AnalysisResult gained unexpected non-additive fields: "
        f"{extra - ANALYSIS_RESULT_V2_ADDITIVE_FIELDS} (Req 52.1/52.3)"
    )


def test_analysis_result_v2_fields_are_optional() -> None:
    """The V2 additions must be optional (carry defaults), so V1 callers that
    never set them keep constructing results exactly as before (Req 52.3)."""
    for name in ANALYSIS_RESULT_V2_ADDITIVE_FIELDS:
        field = c.AnalysisResult.model_fields[name]
        assert not field.is_required(), (
            f"AnalysisResult.{name} must be optional/additive, not required (Req 52.3)"
        )


def _make_v1_analysis_result() -> c.AnalysisResult:
    """Construct an AnalysisResult using ONLY the V1 fields (no V2 fields set)."""
    metrics = c.ObjectiveMetrics(
        joint_angles={"knee": 90.0},
        bar_path=[[0.5, 0.5]],
        depth=0.5,
        range_of_motion={"knee": 120.0},
        tempo=1.0,
        symmetry=0.9,
        center_of_mass=[0.5, 0.5],
        balance=0.8,
        confidence=0.9,
    )
    reps = c.RepetitionSummary(
        rep_count=5,
        phase_timestamps=[],
        avg_rep_duration_ms=1000.0,
        movement_consistency=0.8,
    )
    return c.AnalysisResult(
        exercise_id="squat",
        analysis_date="2024-01-01T00:00:00Z",
        overall_score=88.0,
        movement_score=90.0,
        range_of_motion={"knee": 120.0},
        tempo=1.0,
        stability=0.9,
        symmetry=0.9,
        joint_alignment={"spine": 0.95},
        strengths=["depth"],
        mistakes=[],
        corrections=[],
        safety_warnings=[],
        improvement_tips=[],
        training_advice=[],
        movement_metrics=metrics,
        repetition_summary=reps,
        overall_confidence=0.9,
        low_confidence=False,
        user_corrections=[],
        analysisVersion="1.0.0",
        poseEngineVersion="mediapipe-1.0.0",
        visionModelVersion="v-1.0.0",
        reasoningModelVersion="r-1.0.0",
        pipelineVersion="1.0.0",
    )


def test_analysis_result_v1_shape_serializes_without_v2_keys() -> None:
    """A result built WITHOUT the V2 fields serializes to the byte-exact V1
    shape: the additive keys are omitted entirely (Req 52.3, 52.5)."""
    result = _make_v1_analysis_result()
    dumped = result.model_dump()

    assert set(dumped.keys()) == ANALYSIS_RESULT_V1_FIELDS, (
        f"V1-shape serialization drifted: unexpected keys "
        f"{set(dumped.keys()) - ANALYSIS_RESULT_V1_FIELDS}, missing "
        f"{ANALYSIS_RESULT_V1_FIELDS - set(dumped.keys())} (Req 52.3)"
    )
    for name in ANALYSIS_RESULT_V2_ADDITIVE_FIELDS:
        assert name not in dumped, (
            f"Additive V2 field {name!r} leaked into V1-shape serialization (Req 52.5)"
        )

    # JSON round-trip must also omit the additive keys (byte-stable wire shape).
    import json

    payload = json.loads(result.model_dump_json())
    assert set(payload.keys()) == ANALYSIS_RESULT_V1_FIELDS
