"""
Property tests for Stage 39 · Cost_Tracking_Service (Req 40.1, 40.5).

These tests drive `CostTrackingService` with a real `InMemoryCostSink` and a
deterministically-injected failing sink so the "exactly one record per terminal
job (idempotent) + never blocks on failure" discipline can be asserted exactly
across many inputs. `AnalysisJob`s are generated in both terminal
(`completed`/`failed`) and non-terminal states, paired with fully-populated
`CostRecord`s, and each async `record(...)` call is driven synchronously via
``asyncio.run``.

Mirrors the established property-test style in this package (`hypothesis`
`@given` + `@settings(max_examples=..., deadline=None)`).

# Feature: ai-exercise-analysis, Property 46: Cost tracking records exactly one
# complete record and never blocks. For any Analysis_Job reaching a terminal
# state, the Cost_Tracking_Service records exactly one Cost_Record with all
# fields (processing time, GPU memory, VRAM usage, frame count, model used,
# token count, estimated inference cost, worker identifier, queue wait time)
# populated; if recording fails, the Analysis_Result is returned to the client
# unmodified together with a failure indication identifying the affected job.
#
# Validates: Requirements 40.1, 40.5
"""

from __future__ import annotations

import asyncio

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from app.analysis.jobs import AnalysisJob, JobState
from app.analysis_v2.models_v2 import CostRecord
from app.analysis_v2.telemetry.cost_tracking import (
    CostRecordingFailure,
    CostTrackingService,
    InMemoryCostSink,
)

# Minimum iterations mandated for these property tests.
_MIN_ITER = 200

_TERMINAL = (JobState.completed, JobState.failed)
_NON_TERMINAL = tuple(s for s in JobState if s not in _TERMINAL)


# ─────────────────────────────────────────────────────────────────────────
# Deterministic seam — a sink that always fails on record (Req 40.5)
# ─────────────────────────────────────────────────────────────────────────

class FailingCostSink(InMemoryCostSink):
    """An `InMemoryCostSink` whose `record` always raises (backend failure)."""

    name = "failing"

    def record(self, record: CostRecord) -> None:  # noqa: D401 - test seam
        raise RuntimeError("injected sink failure")


# ─────────────────────────────────────────────────────────────────────────
# Smart generators — constrained to the meaningful input space
# ─────────────────────────────────────────────────────────────────────────

_finite_floats = st.floats(
    min_value=0.0, max_value=1e6, allow_nan=False, allow_infinity=False
)
_counts = st.integers(min_value=0, max_value=100_000)
_ids = st.text(min_size=1, max_size=24)
_models = st.sampled_from(["gpt-4o", "gemini-1.5", "llava-next", "qwen-vl"])


@st.composite
def _cost_records(draw) -> CostRecord:
    """A fully-populated, valid `CostRecord` (every Req-40.1 field present)."""
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
def _non_terminal_jobs(draw) -> AnalysisJob:
    return AnalysisJob(
        job_id=draw(_ids),
        user_id=draw(_ids),
        state=draw(st.sampled_from(_NON_TERMINAL)),
    )


def _service() -> CostTrackingService:
    """A service backed by a fresh in-memory sink, explicitly enabled."""
    return CostTrackingService(InMemoryCostSink(), enabled=True)


# All the fields that must never appear on a CostRecord (Req 40.2, 40.4).
_FORBIDDEN_KEYS = ("user_id", "video", "frames", "frame", "pose", "pose_images")

_VALID_RECORD_KWARGS = dict(
    processing_time_ms=1.0,
    gpu_memory_mb=1.0,
    vram_usage_mb=1.0,
    frame_count=1,
    model_used="gpt-4o",
    token_count=1,
    estimated_inference_cost=1.0,
    worker_id="w-1",
    queue_wait_ms=1.0,
)


# ─────────────────────────────────────────────────────────────────────────
# Property 46 — a terminal job records EXACTLY ONE record, idempotently (Req 40.1)
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(job=_terminal_jobs(), metrics=_cost_records(), repeats=st.integers(1, 6))
def test_terminal_job_records_exactly_one_idempotent(job, metrics, repeats) -> None:
    """Recording a terminal job N times ⇒ sink holds exactly one record.

    # Feature: ai-exercise-analysis, Property 46: Cost tracking records exactly
    # one complete record and never blocks.
    Validates: Requirements 40.1
    """
    service = _service()

    # First record of a terminal job stores exactly one, returns no failure.
    first = asyncio.run(service.record(job, metrics))
    assert first is None
    assert service.snapshot().sample_count == 1

    # Any number of repeats for the SAME job are benign no-ops (idempotent):
    # the count stays at exactly one — "exactly one record per terminal job".
    for _ in range(repeats):
        again = asyncio.run(service.record(job, metrics))
        assert again is None
        assert service.snapshot().sample_count == 1


# ─────────────────────────────────────────────────────────────────────────
# Property 46 — aggregate sample_count == number of distinct terminal jobs (Req 40.1)
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(jobs=st.lists(_terminal_jobs(), min_size=1, max_size=8), metrics=_cost_records())
def test_sample_count_equals_distinct_terminal_jobs(jobs, metrics) -> None:
    """Recording a batch of terminal jobs ⇒ count == # of distinct job_ids.

    # Feature: ai-exercise-analysis, Property 46: Cost tracking records exactly
    # one complete record and never blocks.
    Validates: Requirements 40.1
    """
    service = _service()

    for job in jobs:
        outcome = asyncio.run(service.record(job, metrics))
        assert outcome is None  # every terminal recording succeeds

    distinct_ids = {job.job_id for job in jobs}
    assert service.snapshot().sample_count == len(distinct_ids)


# ─────────────────────────────────────────────────────────────────────────
# Property 46 — a non-terminal job records NOTHING (Req 40.1)
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(job=_non_terminal_jobs(), metrics=_cost_records())
def test_non_terminal_job_records_nothing(job, metrics) -> None:
    """A non-terminal job stores no record and yields a CostRecordingFailure.

    # Feature: ai-exercise-analysis, Property 46: Cost tracking records exactly
    # one complete record and never blocks.
    Validates: Requirements 40.1
    """
    service = _service()

    outcome = asyncio.run(service.record(job, metrics))

    # Non-terminal ⇒ nothing recorded, and the miss is signalled (not raised).
    assert isinstance(outcome, CostRecordingFailure)
    assert outcome.job_id == job.job_id
    assert service.snapshot().sample_count == 0


# ─────────────────────────────────────────────────────────────────────────
# Property 46 — a sink failure never raises; returns a failure indication (Req 40.5)
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(job=_terminal_jobs(), metrics=_cost_records())
def test_sink_failure_is_non_blocking(job, metrics) -> None:
    """An injected sink failure ⇒ CostRecordingFailure, never raises.

    # Feature: ai-exercise-analysis, Property 46: Cost tracking records exactly
    # one complete record and never blocks.
    Validates: Requirements 40.5
    """
    service = CostTrackingService(FailingCostSink(), enabled=True)

    # Never raises on the domain condition — returns a non-blocking indication
    # identifying the affected job (Req 40.5).
    outcome = asyncio.run(service.record(job, metrics))
    assert isinstance(outcome, CostRecordingFailure)
    assert outcome.job_id == job.job_id
    assert outcome.reason  # a diagnostic reason is present

    # The failed job is NOT marked as recorded, so a later (recovered) attempt
    # can still record exactly one — the failure left no partial state.
    assert job.job_id not in service._recorded_jobs

    # The client-facing job record is left completely untouched (Req 40.5).
    assert job.result is None
    assert job.error is None


# ─────────────────────────────────────────────────────────────────────────
# Property 46 — the record is anonymous: no user/video/frame/pose (Req 40.2, 40.4)
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    forbidden_key=st.sampled_from(_FORBIDDEN_KEYS),
    forbidden_value=st.one_of(st.text(max_size=8), st.integers(), st.none()),
)
def test_cost_record_rejects_identifying_fields(forbidden_key, forbidden_value) -> None:
    """CostRecord (extra="forbid") structurally rejects any privacy field.

    # Feature: ai-exercise-analysis, Property 46: Cost tracking records exactly
    # one complete record and never blocks.
    Validates: Requirements 40.1
    """
    kwargs = {**_VALID_RECORD_KWARGS, forbidden_key: forbidden_value}
    # extra="forbid" guarantees a user/video/frame/pose field cannot attach.
    with pytest.raises(ValidationError):
        CostRecord(**kwargs)
