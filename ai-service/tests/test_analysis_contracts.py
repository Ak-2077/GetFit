"""
Unit tests for the analysis pipeline data contracts and the core stage
interface (Task 1.4).

Covers:
  • Requirement 14.3 — stages exchange data via defined structured data
    contracts: every contract round-trips losslessly through
    `model_dump`/`model_validate` and through JSON serialization.
  • Requirement 14.4 — `StructuredError` and `StageResult` enforce their
    required fields (validation errors when omitted).
  • Requirement 14.1 — a sample stage with a single responsibility conforms to
    the `PipelineStage` interface and can be executed in isolation.
"""

import asyncio

import pytest
from pydantic import BaseModel, ValidationError

from app.analysis.base import PipelineStage, StageResult, StructuredError
from app.analysis import contracts as C


# ── Sample contract instances ─────────────────────────────────────────────
# One valid, constraint-satisfying instance per contract model. Used to drive
# the parametrized round-trip tests.

def _video_meta() -> C.VideoMeta:
    return C.VideoMeta(
        container_format="mp4",
        codec="h264",
        duration_sec=12.5,
        width=1080,
        height=1920,
        fps=30.0,
        size_bytes=2_500_000,
        orientation="portrait",
    )


def _frame() -> C.Frame:
    return C.Frame(index=3, timestamp_ms=100.0)


def _frame_set() -> C.FrameSet:
    return C.FrameSet(frames=[_frame(), C.Frame(index=4, timestamp_ms=133.3)], source_meta=_video_meta())


def _frame_quality() -> C.FrameQuality:
    return C.FrameQuality(
        blur=0.1,
        brightness=0.6,
        contrast=0.5,
        motion_blur=0.05,
        camera_shake=0.02,
        body_visibility=0.95,
        occlusion=0.0,
    )


def _quality_scored_frame() -> C.QualityScoredFrame:
    return C.QualityScoredFrame(frame=_frame(), quality=_frame_quality(), retained=True)


def _camera_issue() -> C.CameraIssue:
    return C.CameraIssue(issue="body_cut_off", recommendation="Step back so your whole body is visible.")


def _camera_guidance() -> C.CameraGuidance:
    return C.CameraGuidance(suitable=False, issues=[_camera_issue()])


def _landmark() -> C.Landmark:
    return C.Landmark(x=0.5, y=0.25, z=-0.1, confidence=0.9)


def _frame_landmarks() -> C.FrameLandmarks:
    return C.FrameLandmarks(timestamp_ms=100.0, landmarks=[_landmark(), _landmark()], overall_confidence=0.85)


def _timeline_entry() -> C.TimelineEntry:
    return C.TimelineEntry(
        timestamp_ms=100.0,
        joint_positions={"left_knee": [0.4, 0.6, 0.0]},
        joint_angles={"left_knee": 92.5},
        joint_velocity={"left_knee": 0.3},
        joint_acceleration={"left_knee": 0.05},
        movement_direction={"left_knee": -1.0},
    )


def _movement_timeline() -> C.MovementTimeline:
    return C.MovementTimeline(entries=[_timeline_entry()])


def _movement_phase() -> C.MovementPhase:
    return C.MovementPhase(phase="Eccentric", start_ms=0.0, end_ms=500.0)


def _repetition_summary() -> C.RepetitionSummary:
    return C.RepetitionSummary(
        rep_count=5,
        phase_timestamps=[[_movement_phase()]],
        avg_rep_duration_ms=1200.0,
        movement_consistency=0.8,
    )


def _objective_metrics() -> C.ObjectiveMetrics:
    return C.ObjectiveMetrics(
        joint_angles={"left_knee": 92.5},
        bar_path=[[0.5, 0.5], [0.5, 0.4]],
        depth=0.7,
        range_of_motion={"left_knee": 110.0},
        tempo=1.5,
        symmetry=0.9,
        center_of_mass=[0.5, 0.55],
        balance=0.88,
        confidence=0.82,
    )


def _detection() -> C.Detection:
    return C.Detection(
        exercise_id="squat",
        confidence=0.91,
        alternatives=[{"exercise_id": "lunge", "confidence": 0.4}],
    )


def _reasoning_output() -> C.ReasoningOutput:
    return C.ReasoningOutput(
        strengths=["good depth"],
        mistakes=["knees caving"],
        corrections=["push knees out"],
        safety_warnings=[],
        improvement_tips=["slow the tempo"],
        training_advice=["add tempo squats"],
        confidence=0.75,
        low_confidence=False,
    )


def _confidence_sources() -> C.ConfidenceSources:
    return C.ConfidenceSources(
        vision=0.8,
        pose=0.9,
        detection=0.85,
        movement_quality=0.7,
        biomechanics=0.78,
        reasoning=0.75,
    )


def _analysis_result() -> C.AnalysisResult:
    return C.AnalysisResult(
        exercise_id="squat",
        analysis_date="2024-01-01T00:00:00Z",
        overall_score=82.0,
        movement_score=80.0,
        range_of_motion={"left_knee": 110.0},
        tempo=1.5,
        stability=0.88,
        symmetry=0.9,
        joint_alignment={"left_knee": 0.95},
        strengths=["good depth"],
        mistakes=["knees caving"],
        corrections=["push knees out"],
        safety_warnings=[],
        improvement_tips=["slow the tempo"],
        training_advice=["add tempo squats"],
        movement_metrics=_objective_metrics(),
        repetition_summary=_repetition_summary(),
        overall_confidence=0.8,
        low_confidence=False,
        user_corrections=[],
        analysisVersion="1.0.0",
        poseEngineVersion="mediapipe-0.10",
        visionModelVersion="qwen-vl-1",
        reasoningModelVersion="llm-1",
        pipelineVersion="v1",
    )


ALL_CONTRACT_INSTANCES = [
    _video_meta(),
    _frame(),
    _frame_set(),
    _frame_quality(),
    _quality_scored_frame(),
    _camera_issue(),
    _camera_guidance(),
    _landmark(),
    _frame_landmarks(),
    _timeline_entry(),
    _movement_timeline(),
    _movement_phase(),
    _repetition_summary(),
    _objective_metrics(),
    _detection(),
    _reasoning_output(),
    _confidence_sources(),
    _analysis_result(),
]


# ── Requirement 14.3: structured data contract round-trips ─────────────────

@pytest.mark.parametrize("instance", ALL_CONTRACT_INSTANCES, ids=lambda m: type(m).__name__)
def test_contract_dict_round_trip(instance: BaseModel):
    """model_dump -> model_validate reconstructs an equal model (lossless)."""
    dumped = instance.model_dump()
    assert isinstance(dumped, dict)
    restored = type(instance).model_validate(dumped)
    assert restored == instance


@pytest.mark.parametrize("instance", ALL_CONTRACT_INSTANCES, ids=lambda m: type(m).__name__)
def test_contract_json_round_trip(instance: BaseModel):
    """model_dump_json -> model_validate_json reconstructs an equal model."""
    as_json = instance.model_dump_json()
    assert isinstance(as_json, str)
    restored = type(instance).model_validate_json(as_json)
    assert restored == instance


def test_nested_contract_round_trip_preserves_children():
    """A deeply nested contract round-trips with nested children intact."""
    result = _analysis_result()
    restored = C.AnalysisResult.model_validate(result.model_dump())
    assert restored.movement_metrics == result.movement_metrics
    assert restored.repetition_summary.phase_timestamps == result.repetition_summary.phase_timestamps


# ── Requirement 14.3: bounded-field constraints are enforced ───────────────

def test_confidence_bounds_enforced():
    """Confidence fields are constrained to [0.0, 1.0]."""
    with pytest.raises(ValidationError):
        C.Landmark(x=0.5, y=0.5, confidence=1.5)
    with pytest.raises(ValidationError):
        C.ConfidenceSources(
            vision=-0.1, pose=0.5, detection=0.5,
            movement_quality=0.5, biomechanics=0.5, reasoning=0.5,
        )


def test_normalized_landmark_coordinates_enforced():
    """Landmark x/y are normalized to [0.0, 1.0] (resolution-independent)."""
    with pytest.raises(ValidationError):
        C.Landmark(x=1.2, y=0.5, confidence=0.9)
    with pytest.raises(ValidationError):
        C.Landmark(x=0.5, y=-0.3, confidence=0.9)


# ── Requirement 14.4: StructuredError enforces required fields ─────────────

def test_structured_error_round_trip():
    err = StructuredError(code="CORRUPTED_VIDEO", message="The video could not be decoded.", stage="video_validation")
    assert StructuredError.model_validate(err.model_dump()) == err


@pytest.mark.parametrize("missing", ["code", "message", "stage"])
def test_structured_error_requires_all_fields(missing: str):
    fields = {"code": "LOW_CONFIDENCE", "message": "Confidence too low.", "stage": "reasoning"}
    fields.pop(missing)
    with pytest.raises(ValidationError):
        StructuredError(**fields)


# ── Requirement 14.4: StageResult enforces required fields ─────────────────

def test_stage_result_success_round_trip():
    result = StageResult[C.VideoMeta](success=True, output=_video_meta())
    restored = StageResult[C.VideoMeta].model_validate(result.model_dump())
    assert restored == result


def test_stage_result_failure_carries_structured_error():
    err = StructuredError(code="UNSUPPORTED_CODEC", message="Codec not supported.", stage="video_validation")
    result = StageResult(success=False, error=err)
    assert result.output is None
    assert result.error == err


def test_stage_result_requires_success_field():
    with pytest.raises(ValidationError):
        StageResult()  # 'success' is required


def test_stage_result_defaults_output_and_error_to_none():
    result = StageResult(success=True)
    assert result.output is None
    assert result.error is None


# ── Requirement 14.1 / 14.4: sample stage conforms to PipelineStage ────────

class _DoublingStage(PipelineStage[C.Frame, C.Frame]):
    """A minimal single-responsibility stage used to verify the interface."""

    name = "doubling_stage"

    async def run(self, data: C.Frame) -> StageResult[C.Frame]:
        return StageResult[C.Frame](
            success=True,
            output=C.Frame(index=data.index * 2, timestamp_ms=data.timestamp_ms * 2),
        )


def test_sample_stage_is_pipeline_stage_instance():
    stage = _DoublingStage()
    assert isinstance(stage, PipelineStage)
    assert stage.name == "doubling_stage"


def test_pipeline_stage_cannot_be_instantiated_without_run():
    """The abstract `run` method must be implemented by concrete stages."""

    class _IncompleteStage(PipelineStage):
        name = "incomplete"

    with pytest.raises(TypeError):
        _IncompleteStage()  # type: ignore[abstract]


def test_sample_stage_runs_in_isolation():
    """A stage can be executed and tested in isolation (Req 14.4)."""
    stage = _DoublingStage()
    result = asyncio.run(stage.run(C.Frame(index=2, timestamp_ms=50.0)))
    assert result.success is True
    assert result.output == C.Frame(index=4, timestamp_ms=100.0)
