"""
Unit tests for the Version 2 (Production Extensions) data contracts and the
strictly-additive V2 fields on the V1 ``AnalysisResult`` (Task 18.5).

Covers:
  • Requirement 52.3 — every existing data contract is preserved unchanged when
    the V2 components are added: an ``AnalysisResult`` constructed WITHOUT the
    additive V2 fields (``review_status``, ``score_explanations``) serializes
    (both ``model_dump`` and ``model_dump_json``) byte-for-byte identically to
    the V1 schema (the V2 keys are absent). When the V2 fields are populated,
    they appear in the serialized output.
  • Requirement 52.6 — each V2 contract is an independently testable type:
    every V2 model round-trips losslessly through
    ``model_dump``/``model_validate`` (and JSON), enum members are stable, and
    the privacy/bound constraints (factor-weight [0,100];
    ``CostRecord``/``BenchmarkSample`` ``extra="forbid"``) are enforced.
  • Requirement 52.7 — the V2 additive fields do not disturb existing
    serialized behavior, so existing consumers/tests observe an unchanged
    contract.
"""

import json

import pytest
from pydantic import BaseModel, ValidationError

from app.analysis import contracts as C
from app.analysis_v2 import models_v2 as V2


# ── Sample V2 contract instances ───────────────────────────────────────────
# One valid, constraint-satisfying instance per V2 contract model. Used to
# drive the parametrized round-trip tests (Req 52.6).

def _compression_metadata() -> V2.CompressionMetadata:
    return V2.CompressionMetadata(
        original_size=10_000_000,
        compressed_size=2_500_000,
        compression_ratio=0.25,
        compression_time_ms=850.0,
    )


def _upload_chunk() -> V2.UploadChunk:
    return V2.UploadChunk(
        index=0,
        size_bytes=1_048_576,
        sha256="a" * 64,
        verified=True,
    )


def _cost_record() -> V2.CostRecord:
    return V2.CostRecord(
        processing_time_ms=4200.0,
        gpu_memory_mb=3072.0,
        vram_usage_mb=2048.0,
        frame_count=120,
        model_used="qwen-vl-1",
        token_count=1500,
        estimated_inference_cost=0.0123,
        worker_id="worker-7",
        queue_wait_ms=300.0,
    )


def _benchmark_sample() -> V2.BenchmarkSample:
    return V2.BenchmarkSample(
        image_hash="f" * 64,
        exercise="squat",
        prediction="squat",
        ground_truth="squat",
        confidence=0.92,
        reason="depth and bar path consistent with a squat",
        manual_correction="",
        pipeline_version="v2",
    )


def _score_explanation() -> V2.ScoreExplanation:
    return V2.ScoreExplanation(
        score_name="movement_score",
        factors={
            "range_of_motion": 30.0,
            "tempo": 20.0,
            "balance": 20.0,
            "stability": 15.0,
            "symmetry": 15.0,
        },
    )


def _device_capability_profile() -> V2.DeviceCapabilityProfile:
    return V2.DeviceCapabilityProfile(
        tier="high-end",
        resolution=1080,
        frame_sampling_rate=30,
        upload_quality=90,
        compression_target=70,
        detection_completed=True,
    )


def _multi_camera_input() -> V2.MultiCameraInput:
    return V2.MultiCameraInput(
        angles={V2.CameraAngle.front: "ref-front", V2.CameraAngle.side: "ref-side"},
        fusion_input=None,
    )


ALL_V2_CONTRACT_INSTANCES = [
    _compression_metadata(),
    _upload_chunk(),
    _cost_record(),
    _benchmark_sample(),
    _score_explanation(),
    _device_capability_profile(),
    _multi_camera_input(),
]


# ── Requirement 52.6: V2 contract round-trips ──────────────────────────────

@pytest.mark.parametrize("instance", ALL_V2_CONTRACT_INSTANCES, ids=lambda m: type(m).__name__)
def test_v2_contract_dict_round_trip(instance: BaseModel):
    """model_dump -> model_validate reconstructs an equal model (lossless)."""
    dumped = instance.model_dump()
    assert isinstance(dumped, dict)
    restored = type(instance).model_validate(dumped)
    assert restored == instance


@pytest.mark.parametrize("instance", ALL_V2_CONTRACT_INSTANCES, ids=lambda m: type(m).__name__)
def test_v2_contract_json_round_trip(instance: BaseModel):
    """model_dump_json -> model_validate_json reconstructs an equal model."""
    as_json = instance.model_dump_json()
    assert isinstance(as_json, str)
    restored = type(instance).model_validate_json(as_json)
    assert restored == instance


# ── Requirement 52.6: enum membership is stable ────────────────────────────

def test_review_status_enum_membership():
    """ReviewStatus is exactly the two human-review states (Req 42.5)."""
    assert {s.value for s in V2.ReviewStatus} == {"Confident", "Needs Review"}
    assert V2.ReviewStatus("Confident") is V2.ReviewStatus.confident
    assert V2.ReviewStatus("Needs Review") is V2.ReviewStatus.needs_review


def test_offline_queue_state_enum_membership():
    """OfflineQueueState covers the five lifecycle states (Req 45.3)."""
    assert {s.value for s in V2.OfflineQueueState} == {
        "Queued", "Uploading", "Processing", "Completed", "Failed",
    }
    assert V2.OfflineQueueState("Queued") is V2.OfflineQueueState.queued


def test_camera_angle_enum_membership():
    """CameraAngle covers the three supported angles (Req 50.1)."""
    assert {a.value for a in V2.CameraAngle} == {"Front", "Side", "Rear"}
    assert V2.CameraAngle("Front") is V2.CameraAngle.front


@pytest.mark.parametrize(
    "enum_cls, bad_value",
    [
        (V2.ReviewStatus, "confident"),       # wrong case — not a member
        (V2.OfflineQueueState, "Done"),       # not a defined state
        (V2.CameraAngle, "Top"),              # unsupported angle
    ],
)
def test_enum_rejects_unknown_values(enum_cls, bad_value):
    with pytest.raises(ValueError):
        enum_cls(bad_value)


# ── Requirement 52.6: bound + privacy constraints are enforced ─────────────

def test_score_explanation_factor_weight_bounds_enforced():
    """Each factor weight is bounded to [0, 100] (Req 49.2)."""
    with pytest.raises(ValidationError):
        V2.ScoreExplanation(score_name="movement_score", factors={"tempo": 100.1})
    with pytest.raises(ValidationError):
        V2.ScoreExplanation(score_name="movement_score", factors={"tempo": -0.1})
    # Boundary values are accepted.
    ok = V2.ScoreExplanation(score_name="movement_score", factors={"a": 0.0, "b": 100.0})
    assert ok.factors == {"a": 0.0, "b": 100.0}


def test_benchmark_sample_confidence_bounds_enforced():
    """BenchmarkSample.confidence is bounded to [0,1] (Req 41.2)."""
    with pytest.raises(ValidationError):
        V2.BenchmarkSample(
            image_hash="f" * 64, exercise="squat", prediction="squat",
            ground_truth="squat", confidence=1.5, reason="r",
            manual_correction="", pipeline_version="v2",
        )


def test_cost_record_forbids_extra_fields():
    """CostRecord forbids any extra (privacy-violating) field (Req 40.2, 40.4)."""
    base = _cost_record().model_dump()
    for leak in ("user_id", "video", "frame", "pose"):
        with pytest.raises(ValidationError):
            V2.CostRecord(**{**base, leak: "leaked"})


def test_benchmark_sample_forbids_extra_fields():
    """BenchmarkSample forbids any extra (privacy-violating) field (Req 41.6)."""
    base = _benchmark_sample().model_dump()
    for leak in ("user_id", "video", "frame", "pose"):
        with pytest.raises(ValidationError):
            V2.BenchmarkSample(**{**base, leak: "leaked"})


# ── Requirement 52.3 / 52.7: AnalysisResult additive-field invariants ──────

# The exact set of keys in the V1 AnalysisResult schema (before the additive V2
# fields existed). A V1-equivalent result MUST serialize to exactly these keys.
V1_ANALYSIS_RESULT_KEYS = {
    "exercise_id",
    "analysis_date",
    "overall_score",
    "movement_score",
    "range_of_motion",
    "tempo",
    "stability",
    "symmetry",
    "joint_alignment",
    "strengths",
    "mistakes",
    "corrections",
    "safety_warnings",
    "improvement_tips",
    "training_advice",
    "movement_metrics",
    "repetition_summary",
    "overall_confidence",
    "low_confidence",
    "user_corrections",
    "analysisVersion",
    "poseEngineVersion",
    "visionModelVersion",
    "reasoningModelVersion",
    "pipelineVersion",
}


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


def _repetition_summary() -> C.RepetitionSummary:
    return C.RepetitionSummary(
        rep_count=5,
        phase_timestamps=[[C.MovementPhase(phase="Eccentric", start_ms=0.0, end_ms=500.0)]],
        avg_rep_duration_ms=1200.0,
        movement_consistency=0.8,
    )


def _analysis_result(**overrides) -> C.AnalysisResult:
    fields = dict(
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
    fields.update(overrides)
    return C.AnalysisResult(**fields)


def test_analysis_result_without_v2_fields_matches_v1_dump_keys():
    """
    Req 52.3: a result built WITHOUT the V2 fields serializes to EXACTLY the
    V1 schema — the V2 keys are absent from model_dump().
    """
    dumped = _analysis_result().model_dump()
    assert set(dumped.keys()) == V1_ANALYSIS_RESULT_KEYS
    assert "review_status" not in dumped
    assert "score_explanations" not in dumped


def test_analysis_result_without_v2_fields_matches_v1_json_keys():
    """Req 52.3: model_dump_json() of a V1-equivalent result omits the V2 keys."""
    payload = json.loads(_analysis_result().model_dump_json())
    assert set(payload.keys()) == V1_ANALYSIS_RESULT_KEYS
    assert "review_status" not in payload
    assert "score_explanations" not in payload


def test_analysis_result_default_constructed_v2_fields_are_dropped():
    """
    Explicitly passing the V2 fields at their DEFAULT values is identical to
    omitting them — the serialized shape is still pure V1 (Req 52.3, 52.7).
    """
    explicit_defaults = _analysis_result(review_status=None, score_explanations=[])
    omitted = _analysis_result()
    assert explicit_defaults.model_dump() == omitted.model_dump()
    assert explicit_defaults.model_dump_json() == omitted.model_dump_json()


def test_analysis_result_populated_review_status_appears():
    """When review_status is populated it appears in the serialized output."""
    result = _analysis_result(review_status=V2.ReviewStatus.needs_review)
    dumped = result.model_dump()
    assert dumped["review_status"] == V2.ReviewStatus.needs_review
    # score_explanations still at default ⇒ remains absent.
    assert "score_explanations" not in dumped
    payload = json.loads(result.model_dump_json())
    assert payload["review_status"] == "Needs Review"


def test_analysis_result_populated_score_explanations_appear():
    """When score_explanations is populated it appears in the serialized output."""
    result = _analysis_result(score_explanations=[_score_explanation()])
    dumped = result.model_dump()
    assert "score_explanations" in dumped
    assert len(dumped["score_explanations"]) == 1
    assert dumped["score_explanations"][0]["score_name"] == "movement_score"
    # review_status still at default ⇒ remains absent.
    assert "review_status" not in dumped
    payload = json.loads(result.model_dump_json())
    assert payload["score_explanations"][0]["factors"]["range_of_motion"] == 30.0


def test_analysis_result_with_both_v2_fields_round_trips():
    """A fully-populated result round-trips losslessly (Req 52.6)."""
    result = _analysis_result(
        review_status=V2.ReviewStatus.confident,
        score_explanations=[_score_explanation()],
    )
    restored = C.AnalysisResult.model_validate(result.model_dump())
    assert restored == result
    restored_json = C.AnalysisResult.model_validate_json(result.model_dump_json())
    assert restored_json == result
