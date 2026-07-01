"""
Property-based tests for downstream-transmission privacy.

Covers design Property 2 — "Downstream transmission excludes raw video and
frames" — using Hypothesis with a minimum of 100 iterations per property.

The single privacy invariant is checked across the three downstream channels
the analysis pipeline exposes:

  • the Reasoning_Service input (a `Reasoner` only ever receives the structured
    Movement_Timeline + Objective_Metrics — there is no field through which raw
    video, frames, or pose images could enter);
  • any emitted `ProgressEvent` (carries only bounded job/state metadata);
  • any stored analytics metric / aggregate (`AnalysisMetricRecord` is closed
    via `extra="forbid"` and exposes only anonymous, aggregate counters).

Validates: Requirements 1.3, 1.4, 3.7, 10.2, 10.3, 20.6, 30.2, 30.3, 31.4
"""

import asyncio

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from app.analysis.analytics import (
    AnalysisMetricRecord,
    AnalyticsAggregate,
    ExerciseCount,
)
from app.analysis.contracts import (
    MovementTimeline,
    ObjectiveMetrics,
    ReasoningOutput,
    TimelineEntry,
)
from app.analysis.jobs import JobState, ProgressEvent
from app.analysis.stages.reasoning import (
    Reasoner,
    ReasoningInput,
    ReasoningService,
)


# ── Forbidden raw-artifact / identity tokens ───────────────────────────────
# Any field name (at any nesting depth) that carries one of these substrings
# would represent leakage of the original video, an extracted frame, a pose
# image, or pixel data into a downstream payload (Req 1.3, 1.4, 10.3, 20.6,
# 30.2, 30.3, 31.4). Structured analytical field names (joint_angles, bar_path,
# tempo, timestamp_ms, …) contain none of these.
_RAW_ARTIFACT_TOKENS = (
    "video",
    "frame",
    "pose",
    "image",
    "pixel",
    "landmark",
    "bytes",
    "blob",
)


def _all_keys(obj) -> set[str]:
    """Recursively collect every mapping key in a serialized payload."""
    keys: set[str] = set()
    if isinstance(obj, dict):
        for key, value in obj.items():
            keys.add(str(key))
            keys |= _all_keys(value)
    elif isinstance(obj, (list, tuple)):
        for item in obj:
            keys |= _all_keys(item)
    return keys


def _assert_no_raw_artifacts(payload) -> None:
    """Assert no key in `payload` references a raw video/frame/pose artifact."""
    for key in _all_keys(payload):
        lowered = key.lower()
        for token in _RAW_ARTIFACT_TOKENS:
            assert token not in lowered, (
                f"raw-artifact field {key!r} leaked into downstream payload"
            )


# ── Smart generators (constrained to the real input space) ─────────────────

_finite = st.floats(min_value=-1e4, max_value=1e4, allow_nan=False, allow_infinity=False)
_nonneg = st.floats(min_value=0.0, max_value=1e6, allow_nan=False, allow_infinity=False)
_unit = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
_joint_names = st.sampled_from(["knee", "hip", "elbow", "shoulder", "ankle", "wrist"])
_angle_dict = st.dictionaries(_joint_names, _finite, max_size=4)


objective_metrics = st.builds(
    ObjectiveMetrics,
    joint_angles=_angle_dict,
    bar_path=st.lists(st.lists(_finite, min_size=2, max_size=2), max_size=5),
    depth=_finite,
    range_of_motion=_angle_dict,
    tempo=_finite,
    symmetry=_finite,
    center_of_mass=st.lists(_finite, min_size=2, max_size=3),
    balance=_finite,
    confidence=_unit,
)

timeline_entry = st.builds(
    TimelineEntry,
    timestamp_ms=_nonneg,
    joint_positions=st.dictionaries(
        _joint_names, st.lists(_finite, min_size=3, max_size=3), max_size=4
    ),
    joint_angles=_angle_dict,
    joint_velocity=_angle_dict,
    joint_acceleration=_angle_dict,
    movement_direction=_angle_dict,
)

movement_timeline = st.builds(
    MovementTimeline, entries=st.lists(timeline_entry, max_size=4)
)

progress_event = st.builds(
    ProgressEvent,
    job_id=st.text(max_size=24),
    state=st.sampled_from(list(JobState)),
    label=st.text(max_size=32),
    percent=st.one_of(st.none(), st.floats(0.0, 100.0, allow_nan=False)),
)

metric_record = st.builds(
    AnalysisMetricRecord,
    exercise_id=st.text(max_size=20),
    processing_time_ms=_nonneg,
    duration_ms=_nonneg,
    queue_wait_ms=_nonneg,
    overall_confidence=_unit,
    low_confidence=st.booleans(),
    failed=st.booleans(),
    cleanup_failed=st.booleans(),
)


# ── Spy Reasoner: captures exactly what the stage hands the seam ───────────

class SpyReasoner(Reasoner):
    """A `Reasoner` that records precisely the inputs it was invoked with."""

    def __init__(self) -> None:
        self.received_timeline: MovementTimeline | None = None
        self.received_metrics: ObjectiveMetrics | None = None
        self.call_count = 0

    async def reason(
        self, timeline: MovementTimeline, metrics: ObjectiveMetrics
    ) -> ReasoningOutput:
        self.received_timeline = timeline
        self.received_metrics = metrics
        self.call_count += 1
        # Strong confidence so the stage never short-circuits before invoking us.
        return ReasoningOutput(confidence=1.0)


# Feature: ai-exercise-analysis, Property 2: Downstream transmission excludes raw video and frames
@given(timeline=movement_timeline, metrics=objective_metrics)
@settings(max_examples=150)
def test_reasoning_seam_receives_only_structured_inputs(
    timeline: MovementTimeline, metrics: ObjectiveMetrics
):
    # The Reasoning_Service input contract is structurally limited to the two
    # analytical inputs — there is no field for raw video/frames/pose (Req 10.2,
    # 10.3, 1.4).
    assert set(ReasoningInput.model_fields) == {"timeline", "metrics"}

    spy = SpyReasoner()
    stage = ReasoningService(spy, overall_confidence_min=0.0)
    data = ReasoningInput(timeline=timeline, metrics=metrics)
    result = asyncio.run(stage.run(data))
    assert result.success is True

    # The seam was handed EXACTLY the timeline + metrics it was given — nothing
    # else, and the same structured objects (no raw artifacts injected).
    assert spy.call_count == 1
    assert spy.received_timeline is data.timeline
    assert spy.received_metrics is data.metrics

    # Whatever the seam received serializes to only structured data: top-level
    # keys are exactly {timeline, metrics} and no nested key references a raw
    # video/frame/pose artifact (Req 10.3, 31.4).
    transmitted = data.model_dump()
    assert set(transmitted.keys()) == {"timeline", "metrics"}
    _assert_no_raw_artifacts(transmitted)


# Feature: ai-exercise-analysis, Property 2: Downstream transmission excludes raw video and frames
@given(event=progress_event)
@settings(max_examples=150)
def test_progress_event_excludes_raw_artifacts(event: ProgressEvent):
    # Progress events carry only bounded job/state metadata (Req 20.6, 3.7).
    assert set(ProgressEvent.model_fields) == {"job_id", "state", "label", "percent"}

    payload = event.model_dump()
    assert set(payload.keys()) == {"job_id", "state", "label", "percent"}
    _assert_no_raw_artifacts(payload)


# Feature: ai-exercise-analysis, Property 2: Downstream transmission excludes raw video and frames
@given(record=metric_record)
@settings(max_examples=150)
def test_analytics_metric_excludes_raw_artifacts_and_identity(
    record: AnalysisMetricRecord,
):
    # A stored analytics metric exposes only anonymous, aggregate-friendly
    # fields — no raw video/frames/pose and no End_User identity (Req 30.2,
    # 30.3). The permitted key set is closed and bounded.
    payload = record.model_dump()
    permitted = {
        "exercise_id",
        "processing_time_ms",
        "duration_ms",
        "queue_wait_ms",
        "overall_confidence",
        "low_confidence",
        "failed",
        "cleanup_failed",
    }
    assert set(payload.keys()) == permitted
    _assert_no_raw_artifacts(payload)
    # No identity field is present (anonymity, Req 30.2/30.3).
    assert "user_id" not in payload
    assert "job_id" not in payload


# Feature: ai-exercise-analysis, Property 2: Downstream transmission excludes raw video and frames
_FORBIDDEN_KEYS = st.sampled_from(
    [
        "video",
        "frames",
        "raw_frames",
        "pose",
        "pose_image",
        "pose_images",
        "image",
        "pixels",
        "user_id",
        "job_id",
        "file_path",
        "video_path",
    ]
)


@given(key=_FORBIDDEN_KEYS, value=st.text(max_size=16))
@settings(max_examples=120)
def test_analytics_metric_rejects_forbidden_fields(key: str, value: str):
    # The `extra="forbid"` config makes the privacy boundary structural: any
    # attempt to attach a raw artifact or identifying field is rejected at
    # construction time rather than silently leaking (Req 30.2, 30.3, 31.4).
    with pytest.raises(ValidationError):
        AnalysisMetricRecord(**{key: value})


# Feature: ai-exercise-analysis, Property 2: Downstream transmission excludes raw video and frames
@given(
    counts=st.lists(
        st.tuples(st.text(max_size=12), st.integers(min_value=0, max_value=10_000)),
        max_size=6,
    ),
    sample_count=st.integers(min_value=0, max_value=10_000),
    avg_processing=_nonneg,
    failure_rate=_unit,
    avg_conf=_unit,
    low_conf_freq=_unit,
    avg_duration=_nonneg,
    cleanup_failures=st.integers(min_value=0, max_value=10_000),
    avg_queue=_nonneg,
)
@settings(max_examples=120)
def test_analytics_aggregate_exposes_only_counters(
    counts,
    sample_count,
    avg_processing,
    failure_rate,
    avg_conf,
    low_conf_freq,
    avg_duration,
    cleanup_failures,
    avg_queue,
):
    # The Maintainer-facing aggregate is built only from counts and bounded
    # statistics — never a per-user row or any raw artifact (Req 30.1, 30.3).
    aggregate = AnalyticsAggregate(
        sample_count=sample_count,
        avg_processing_time_ms=avg_processing,
        failure_rate=failure_rate,
        top_exercises=[ExerciseCount(exercise_id=ex, count=c) for ex, c in counts],
        avg_confidence=avg_conf,
        low_confidence_frequency=low_conf_freq,
        avg_duration_ms=avg_duration,
        cleanup_failure_count=cleanup_failures,
        avg_queue_wait_ms=avg_queue,
    )
    payload = aggregate.model_dump()
    _assert_no_raw_artifacts(payload)
    # Aggregate carries no identity field anywhere in its nested structure.
    assert "user_id" not in _all_keys(payload)
