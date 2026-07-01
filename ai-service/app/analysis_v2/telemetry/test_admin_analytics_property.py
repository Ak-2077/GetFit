"""
Property tests for Stage 45 · Admin_Analytics_Service (Req 46.1, 46.5, 46.6).

These tests drive `AdminAnalyticsService` end-to-end by feeding real recorded
state into the composed sources — the V1 `AnalyticsService`
(`record_analysis`), the V2 `CostTrackingService` (recording terminal
`AnalysisJob`s via ``asyncio.run``), a `BenchmarkDatasetBuilder`, and a
`StaticOperationalMetricsProvider` whose gauges may each be ``None`` — then
call `collect()` and assert bounds, privacy, and unavailable-consistency across
many inputs. Also covers the empty/disabled case (all value metrics
unavailable).

Mirrors the established property-test style in this package (`hypothesis`
`@given` + `@settings(max_examples=..., deadline=None)`).

# Feature: ai-exercise-analysis, Property 55: Admin metrics are within declared
# bounds and contain no user-identifying data. For any collection of raw
# operational events, every computed Admin_Analytics metric lies within its
# declared range (percentages in [0, 100], counts greater than or equal to 0,
# confidence in [0.0, 1.0]), and every stored metric is an aggregate that
# excludes user-identifiable information and stores no per-user record.
#
# Validates: Requirements 46.1, 46.5, 46.6
"""

from __future__ import annotations

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.analytics import AnalyticsService, InMemoryAnalyticsSink
from app.analysis.jobs import AnalysisJob, JobState
from app.analysis_v2.models_v2 import BenchmarkSample, CostRecord
from app.analysis_v2.telemetry.admin_analytics import (
    AdminAnalyticsService,
    AdminMetricsSnapshot,
    OperationalGauges,
    StaticOperationalMetricsProvider,
    _UNAVAILABLE_CANDIDATES,
)
from app.analysis_v2.telemetry.benchmark_builder import (
    BenchmarkDatasetBuilder,
    InMemoryBenchmarkSink,
)
from app.analysis_v2.telemetry.cost_tracking import (
    CostTrackingService,
    InMemoryCostSink,
)

# Minimum iterations mandated for these property tests.
_MIN_ITER = 150

_TERMINAL = (JobState.completed, JobState.failed)

# Fields that must NEVER appear on the anonymous admin snapshot (Req 46.5, 46.6).
_FORBIDDEN_SUBSTRINGS = ("user", "video", "frame", "pose", "job_id")

# Percentage / confidence metric bounds declared by the contract (Req 46.1).
_PCT_METRICS = ("failure_rate_pct", "worker_utilization_pct", "gpu_utilization_pct")
_COUNT_METRICS = (
    "sample_count",
    "queue_length",
    "camera_issue_frequency",
    "retry_count",
    "benchmark_sample_count",
    "interval_seconds",
    "window_minutes",
)


# ─────────────────────────────────────────────────────────────────────────
# Smart generators — constrained to the meaningful input space
# ─────────────────────────────────────────────────────────────────────────

_finite_floats = st.floats(
    min_value=0.0, max_value=1e6, allow_nan=False, allow_infinity=False
)
_pct = st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False)
_conf = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
_counts = st.integers(min_value=0, max_value=100_000)
_ids = st.text(min_size=1, max_size=16)
_nonempty = st.text(min_size=1, max_size=16)
_exercises = st.sampled_from(["squat", "pushup", "lunge", "plank", "deadlift", ""])
_models = st.sampled_from(["gpt-4o", "gemini-1.5", "llava-next", "qwen-vl"])


@st.composite
def _analysis_events(draw) -> dict:
    """One anonymous analytics observation within its declared ranges."""
    return dict(
        exercise_id=draw(_exercises),
        processing_time_ms=draw(_finite_floats),
        duration_ms=draw(_finite_floats),
        queue_wait_ms=draw(_finite_floats),
        overall_confidence=draw(_conf),
        failed=draw(st.booleans()),
        cleanup_failed=draw(st.booleans()),
    )


@st.composite
def _cost_records(draw) -> CostRecord:
    return CostRecord(
        processing_time_ms=draw(_finite_floats),
        gpu_memory_mb=draw(_finite_floats),
        vram_usage_mb=draw(_finite_floats),
        frame_count=draw(_counts),
        model_used=draw(_models),
        token_count=draw(_counts),
        estimated_inference_cost=draw(_finite_floats),
        worker_id=draw(_ids),
        queue_wait_ms=draw(_finite_floats),
    )


@st.composite
def _terminal_jobs(draw) -> AnalysisJob:
    return AnalysisJob(
        job_id=draw(_ids),
        user_id=draw(_ids),
        state=draw(st.sampled_from(_TERMINAL)),
    )


@st.composite
def _benchmark_samples(draw) -> BenchmarkSample:
    """A fully-populated, acceptable `BenchmarkSample` (every field non-empty)."""
    return BenchmarkSample(
        image_hash=draw(_nonempty),
        exercise=draw(_nonempty),
        prediction=draw(_nonempty),
        ground_truth=draw(_nonempty),
        confidence=draw(_conf),
        reason=draw(_nonempty),
        manual_correction=draw(_nonempty),
        pipeline_version=draw(_nonempty),
    )


@st.composite
def _gauges(draw) -> OperationalGauges:
    """Operational gauges where each field may independently be ``None``."""

    def opt(strat):
        return draw(st.one_of(st.none(), strat))

    return OperationalGauges(
        queue_length=opt(_counts),
        worker_utilization_pct=opt(_pct),
        gpu_utilization_pct=opt(_pct),
        camera_issue_frequency=opt(_counts),
        retry_count=opt(_counts),
    )


# ─────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────

def _build_service(
    analysis_events,
    cost_pairs,
    bench_samples,
    gauges,
    *,
    enabled: bool = True,
) -> AdminAnalyticsService:
    """Compose an `AdminAnalyticsService` over freshly-populated sources."""
    analytics = AnalyticsService(InMemoryAnalyticsSink())
    for event in analysis_events:
        analytics.record_analysis(**event)

    cost = CostTrackingService(InMemoryCostSink(), enabled=True)
    for job, metrics in cost_pairs:
        # record(...) is async; drive it synchronously (mirrors cost tests).
        asyncio.run(cost.record(job, metrics))

    bench = BenchmarkDatasetBuilder(InMemoryBenchmarkSink(), enabled=True)
    for sample in bench_samples:
        bench.record(sample)

    provider = StaticOperationalMetricsProvider(gauges)
    return AdminAnalyticsService(
        analytics,
        cost,
        benchmark_builder=bench,
        gauges_provider=provider,
        enabled=enabled,
    )


def _assert_bounds(snapshot: AdminMetricsSnapshot) -> None:
    """Every numeric metric lies within its declared range (Req 46.1)."""
    # Confidence in [0.0, 1.0].
    if snapshot.avg_confidence is not None:
        assert 0.0 <= snapshot.avg_confidence <= 1.0

    # Processing time is a count-like non-negative magnitude.
    if snapshot.avg_processing_time_ms is not None:
        assert snapshot.avg_processing_time_ms >= 0.0

    # Percentages in [0, 100].
    for name in _PCT_METRICS:
        value = getattr(snapshot, name)
        if value is not None:
            assert 0.0 <= value <= 100.0, f"{name}={value} out of [0,100]"

    # Counts >= 0.
    for name in _COUNT_METRICS:
        value = getattr(snapshot, name)
        if value is not None:
            assert value >= 0, f"{name}={value} is negative"

    # Category maps: counts per coarse label are non-negative.
    for count in snapshot.exercise_popularity.values():
        assert count >= 0
    for count in snapshot.model_usage.values():
        assert count >= 0


def _assert_privacy(snapshot: AdminMetricsSnapshot) -> None:
    """The snapshot is aggregate-only with no user/video/frame/pose (Req 46.5, 46.6)."""
    dumped = snapshot.model_dump()
    allowed = set(AdminMetricsSnapshot.model_fields.keys())

    # extra="forbid" plus a closed field set ⇒ only the declared aggregate
    # fields can ever appear (no per-user row, no raw-artifact field).
    assert set(dumped.keys()) == allowed

    # No field name carries a user/video/frame/pose/job identifier.
    for field_name in dumped:
        lowered = field_name.lower()
        for forbidden in _FORBIDDEN_SUBSTRINGS:
            assert forbidden not in lowered, f"field {field_name!r} leaks {forbidden!r}"


def _assert_unavailable_consistency(snapshot: AdminMetricsSnapshot) -> None:
    """A candidate metric is None IFF listed in unavailable_metrics (Req 46.7)."""
    listed = set(snapshot.unavailable_metrics)

    # Only known candidate metrics may be listed.
    assert listed <= set(_UNAVAILABLE_CANDIDATES)

    for name in _UNAVAILABLE_CANDIDATES:
        is_none = getattr(snapshot, name) is None
        if is_none:
            assert name in listed, f"{name} is None but not listed unavailable"
        else:
            assert name not in listed, f"{name} is available but listed unavailable"


# ─────────────────────────────────────────────────────────────────────────
# Property 55 — bounds + privacy + unavailable-consistency, never raises
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    analysis_events=st.lists(_analysis_events(), max_size=8),
    cost_pairs=st.lists(st.tuples(_terminal_jobs(), _cost_records()), max_size=6),
    bench_samples=st.lists(_benchmark_samples(), max_size=5),
    gauges=_gauges(),
)
def test_admin_snapshot_bounds_privacy_and_unavailability(
    analysis_events, cost_pairs, bench_samples, gauges
) -> None:
    """For any recorded state + any gauges, collect() is bounded, anonymous,
    unavailable-consistent, and never raises.

    # Feature: ai-exercise-analysis, Property 55: Admin metrics are within
    # declared bounds and contain no user-identifying data.
    Validates: Requirements 46.1, 46.5, 46.6
    """
    service = _build_service(analysis_events, cost_pairs, bench_samples, gauges)

    # Never raises — composing the snapshot is a contained read (Req 46.7).
    snapshot = service.collect()

    _assert_bounds(snapshot)
    _assert_privacy(snapshot)
    _assert_unavailable_consistency(snapshot)


# ─────────────────────────────────────────────────────────────────────────
# Property 55 — gauge availability round-trips exactly (Req 46.1, 46.7)
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    analysis_events=st.lists(_analysis_events(), max_size=6),
    gauges=_gauges(),
)
def test_supplied_gauges_map_to_bounded_available_metrics(
    analysis_events, gauges
) -> None:
    """A supplied (non-None) gauge appears bounded and NOT unavailable; a None
    gauge is None AND listed unavailable.

    # Feature: ai-exercise-analysis, Property 55: Admin metrics are within
    # declared bounds and contain no user-identifying data.
    Validates: Requirements 46.1, 46.5, 46.6
    """
    service = _build_service(analysis_events, [], [], gauges)
    snapshot = service.collect()

    gauge_fields = (
        "queue_length",
        "worker_utilization_pct",
        "gpu_utilization_pct",
        "camera_issue_frequency",
        "retry_count",
    )
    for name in gauge_fields:
        supplied = getattr(gauges, name)
        observed = getattr(snapshot, name)
        assert observed == supplied  # gauge round-trips into the snapshot
        if supplied is None:
            assert name in snapshot.unavailable_metrics
        else:
            assert name not in snapshot.unavailable_metrics

    _assert_bounds(snapshot)
    _assert_privacy(snapshot)


# ─────────────────────────────────────────────────────────────────────────
# Property 55 — empty and disabled snapshots mark value metrics unavailable
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(enabled=st.booleans())
def test_empty_or_disabled_marks_all_value_metrics_unavailable(enabled) -> None:
    """With no recorded state (and no gauges), every Optional value metric is
    None AND listed unavailable — whether the service is enabled or disabled.

    # Feature: ai-exercise-analysis, Property 55: Admin metrics are within
    # declared bounds and contain no user-identifying data.
    Validates: Requirements 46.1, 46.5, 46.6
    """
    # Empty sources + all-None gauges (NullOperationalMetricsProvider default).
    service = _build_service([], [], [], OperationalGauges(), enabled=enabled)
    snapshot = service.collect()

    # Every candidate value metric is unavailable in the empty/disabled window.
    assert set(snapshot.unavailable_metrics) == set(_UNAVAILABLE_CANDIDATES)
    for name in _UNAVAILABLE_CANDIDATES:
        assert getattr(snapshot, name) is None

    # Always-present aggregate fields stay bounded and non-negative.
    assert snapshot.sample_count == 0
    assert snapshot.benchmark_sample_count == 0
    assert snapshot.exercise_popularity == {}
    assert snapshot.model_usage == {}

    _assert_bounds(snapshot)
    _assert_privacy(snapshot)
