"""
Unit tests for the Analytics_Service (Req 30.1–30.4).

Covers metric collection and aggregation, the anonymity/privacy guarantee
(no video/frames/pose/user-identifying fields), and sink replaceability.
"""

import pytest
from pydantic import ValidationError

from app.analysis.analytics import (
    ANALYTICS_SINK_NAMES,
    AnalysisMetricRecord,
    AnalyticsAggregate,
    AnalyticsService,
    AnalyticsSink,
    InMemoryAnalyticsSink,
    build_analytics_sink_registry,
)
from app.analysis.contracts import AnalysisResult, CleanupReport, ObjectiveMetrics, RepetitionSummary
from app.analysis.jobs import AnalysisJob, JobState


def _objective_metrics() -> ObjectiveMetrics:
    return ObjectiveMetrics(
        joint_angles={}, bar_path=[], depth=0.0, range_of_motion={}, tempo=0.0,
        symmetry=0.0, center_of_mass=[0.0, 0.0], balance=0.0, confidence=0.5,
    )


def _rep_summary() -> RepetitionSummary:
    return RepetitionSummary(
        rep_count=0, phase_timestamps=[], avg_rep_duration_ms=0.0,
        movement_consistency=0.5,
    )


def _result(exercise_id: str, confidence: float, low_confidence: bool) -> AnalysisResult:
    return AnalysisResult(
        exercise_id=exercise_id, analysis_date="2024-01-01T00:00:00Z",
        overall_score=0.0, movement_score=0.0, range_of_motion={}, tempo=0.0,
        stability=0.0, symmetry=0.0, joint_alignment={}, strengths=[], mistakes=[],
        corrections=[], safety_warnings=[], improvement_tips=[], training_advice=[],
        movement_metrics=_objective_metrics(), repetition_summary=_rep_summary(),
        overall_confidence=confidence, low_confidence=low_confidence,
        analysisVersion="1", poseEngineVersion="1", visionModelVersion="1",
        reasoningModelVersion="1", pipelineVersion="1",
    )


# ── Collection & aggregation (Req 30.1) ──────────────────────────────────

def test_empty_snapshot_is_zeroed():
    svc = AnalyticsService(InMemoryAnalyticsSink())
    agg = svc.snapshot()
    assert agg.sample_count == 0
    assert agg.failure_rate == 0.0
    assert agg.top_exercises == []


def test_aggregate_computes_all_required_metrics():
    svc = AnalyticsService(InMemoryAnalyticsSink(), low_confidence_threshold=0.5)
    svc.record_analysis(exercise_id="squat", processing_time_ms=100.0,
                        duration_ms=200.0, queue_wait_ms=10.0, overall_confidence=0.9)
    svc.record_analysis(exercise_id="squat", processing_time_ms=300.0,
                        duration_ms=400.0, queue_wait_ms=30.0, overall_confidence=0.3)
    svc.record_analysis(exercise_id="deadlift", processing_time_ms=200.0,
                        duration_ms=300.0, queue_wait_ms=20.0, overall_confidence=0.6,
                        failed=True, cleanup_failed=True)

    agg = svc.snapshot()
    assert agg.sample_count == 3
    assert agg.avg_processing_time_ms == pytest.approx(200.0)
    assert agg.avg_duration_ms == pytest.approx(300.0)
    assert agg.avg_queue_wait_ms == pytest.approx(20.0)
    assert agg.avg_confidence == pytest.approx((0.9 + 0.3 + 0.6) / 3)
    assert agg.failure_rate == pytest.approx(1 / 3)
    # confidence 0.3 < 0.5 threshold → exactly one low-confidence occurrence
    assert agg.low_confidence_frequency == pytest.approx(1 / 3)
    assert agg.cleanup_failure_count == 1
    # squat analyzed twice → ranked first (most-analyzed)
    assert agg.top_exercises[0].exercise_id == "squat"
    assert agg.top_exercises[0].count == 2


def test_low_confidence_derived_from_threshold():
    svc = AnalyticsService(InMemoryAnalyticsSink(), low_confidence_threshold=0.7)
    rec = svc.record_analysis(overall_confidence=0.6)
    assert rec.low_confidence is True
    rec2 = svc.record_analysis(overall_confidence=0.8)
    assert rec2.low_confidence is False


def test_top_exercises_capped_to_n():
    svc = AnalyticsService(InMemoryAnalyticsSink(), top_exercises_n=2)
    for ex in ["a", "a", "a", "b", "b", "c"]:
        svc.record_analysis(exercise_id=ex, overall_confidence=0.9)
    agg = svc.snapshot()
    assert [e.exercise_id for e in agg.top_exercises] == ["a", "b"]


# ── Privacy / anonymity (Req 30.2, 30.3) ─────────────────────────────────

def test_record_rejects_identifying_or_raw_fields():
    # extra="forbid": user id, job id, raw artifacts cannot be recorded.
    for bad in ("user_id", "job_id", "video", "frames", "pose", "file_path"):
        with pytest.raises(ValidationError):
            AnalysisMetricRecord(**{bad: "leak"})


def test_aggregate_contains_only_anonymous_aggregate_fields():
    allowed = set(AnalyticsAggregate.model_fields)
    # No field name hints at per-user / raw artifact data.
    forbidden_tokens = ("user", "job", "video", "frame", "pose", "id_")
    for field in allowed:
        assert not any(tok in field for tok in forbidden_tokens), field


def test_from_job_strips_identity():
    job = AnalysisJob(job_id="job-123", user_id="user-abc", state=JobState.completed,
                      result=_result("bench", 0.8, False))
    rec = AnalysisMetricRecord.from_job(job, processing_time_ms=50.0)
    # Only the coarse exercise category and bounded stats survive.
    assert rec.exercise_id == "bench"
    assert rec.overall_confidence == 0.8
    assert rec.failed is False
    dumped = rec.model_dump()
    assert "user-abc" not in dumped.values()
    assert "job-123" not in dumped.values()


def test_from_job_marks_failure_and_cleanup_failure():
    job = AnalysisJob(job_id="j", user_id="u", state=JobState.failed)
    report = CleanupReport(job_id="j", deleted=[], failed=["/tmp/x"], complete=False)
    rec = AnalysisMetricRecord.from_job(job, cleanup_report=report)
    assert rec.failed is True
    assert rec.cleanup_failed is True


# ── Replaceability (Req 30.4) ────────────────────────────────────────────

def test_sink_is_replaceable_behind_interface():
    class CountingSink(AnalyticsSink):
        name = "counting"

        def __init__(self):
            self.calls = 0

        def record(self, record):
            self.calls += 1

        def aggregate(self, *, top_n):
            return AnalyticsAggregate(sample_count=self.calls)

        def reset(self):
            self.calls = 0

    sink = CountingSink()
    svc = AnalyticsService(sink)
    svc.record_analysis(overall_confidence=0.9)
    svc.record_analysis(overall_confidence=0.9)
    assert svc.snapshot().sample_count == 2


def test_registry_round_trip():
    registry = build_analytics_sink_registry()
    assert set(registry.keys()) == set(ANALYTICS_SINK_NAMES)
    assert isinstance(registry["in_memory"], InMemoryAnalyticsSink)
