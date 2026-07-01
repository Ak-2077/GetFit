"""
Unit tests for Analysis_Versioning metadata on AnalysisResult (Requirement 29).

Covers:
  • 29.1 — AnalysisResult carries analysisVersion, poseEngineVersion,
    visionModelVersion, reasoningModelVersion, and pipelineVersion.
  • 29.2 — the version fields are additive metadata on the persisted model
    (Req 13 model still present and unchanged).
  • 29.3 — the persisted record excludes raw video/frames/pose/temp data.
plus the build_analysis_versioning helper that assembles the five fields.
"""

from app.analysis.contracts import (
    ANALYSIS_VERSION,
    PIPELINE_VERSION,
    AnalysisResult,
    ObjectiveMetrics,
    RepetitionSummary,
    build_analysis_versioning,
)

VERSION_FIELDS = (
    "analysisVersion",
    "poseEngineVersion",
    "visionModelVersion",
    "reasoningModelVersion",
    "pipelineVersion",
)

# Raw-artifact tokens that must never appear as a field name token (Req 29.3).
# Tokens are matched against the underscore-split parts of each key so that
# legitimate fields like ``tempo`` (token "tempo") are not flagged for merely
# containing a substring like "temp".
FORBIDDEN_TOKENS = {
    "video",
    "frame",
    "frames",
    "image",
    "images",
    "temp",
    "tmp",
    "artifact",
    "artifacts",
}


def _metrics() -> ObjectiveMetrics:
    return ObjectiveMetrics(
        joint_angles={"left_knee": 90.0},
        bar_path=[[0.0, 0.0]],
        depth=0.5,
        range_of_motion={"left_knee": 120.0},
        tempo=2.0,
        symmetry=0.9,
        center_of_mass=[0.5, 0.5],
        balance=0.8,
        confidence=0.7,
    )


def _reps() -> RepetitionSummary:
    return RepetitionSummary(
        rep_count=0,
        phase_timestamps=[],
        avg_rep_duration_ms=0.0,
        movement_consistency=0.5,
    )


def _result(**version_overrides: str) -> AnalysisResult:
    versions = build_analysis_versioning(
        pose_engine_version="mediapipe-stub-0.0.0",
        vision_model_version="qwen2.5-vl",
        reasoning_model_version="qwen3:14b",
        **version_overrides,
    )
    return AnalysisResult(
        exercise_id="squat",
        analysis_date="2024-01-01T00:00:00Z",
        overall_score=0.8,
        movement_score=0.8,
        range_of_motion={"left_knee": 120.0},
        tempo=2.0,
        stability=0.9,
        symmetry=0.9,
        joint_alignment={"spine": 0.95},
        strengths=[],
        mistakes=[],
        corrections=[],
        safety_warnings=[],
        improvement_tips=[],
        training_advice=[],
        movement_metrics=_metrics(),
        repetition_summary=_reps(),
        overall_confidence=0.7,
        low_confidence=False,
        **versions,
    )


def test_analysis_result_has_all_five_version_fields():
    # Req 29.1: every version field is present on the model.
    result = _result()
    for field in VERSION_FIELDS:
        assert field in AnalysisResult.model_fields
        assert hasattr(result, field)


def test_version_fields_carry_supplied_values():
    # Req 29.1/29.2: the additive metadata round-trips the supplied identifiers.
    result = _result()
    assert result.analysisVersion == ANALYSIS_VERSION
    assert result.pipelineVersion == PIPELINE_VERSION
    assert result.poseEngineVersion == "mediapipe-stub-0.0.0"
    assert result.visionModelVersion == "qwen2.5-vl"
    assert result.reasoningModelVersion == "qwen3:14b"


def test_persisted_record_excludes_raw_artifacts():
    # Req 29.3: serialized record carries no video/frame/pose/temp data.
    dumped = _result().model_dump()
    for key in dumped:
        tokens = set(key.lower().split("_"))
        assert not (tokens & FORBIDDEN_TOKENS), f"raw-artifact field leaked: {key}"


def test_builder_returns_exactly_the_five_fields():
    versions = build_analysis_versioning(
        pose_engine_version="movenet-stub-0.0.0",
        vision_model_version="moondream",
        reasoning_model_version="qwen3:8b",
    )
    assert set(versions) == set(VERSION_FIELDS)
    assert versions["analysisVersion"] == ANALYSIS_VERSION
    assert versions["pipelineVersion"] == PIPELINE_VERSION
    assert versions["poseEngineVersion"] == "movenet-stub-0.0.0"


def test_builder_allows_overriding_analysis_and_pipeline_versions():
    versions = build_analysis_versioning(
        pose_engine_version="mediapipe-stub-0.0.0",
        vision_model_version="qwen2.5-vl",
        reasoning_model_version="qwen3:14b",
        analysis_version="1.2.3",
        pipeline_version="4.5.6",
    )
    assert versions["analysisVersion"] == "1.2.3"
    assert versions["pipelineVersion"] == "4.5.6"
