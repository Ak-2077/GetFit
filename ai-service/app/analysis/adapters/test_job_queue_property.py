"""
Property-based tests for the Job_Queue_Adapter
(app/analysis/adapters/job_queue.py).

Covers design Property 23 — "Queue adapter round-trip preserves job identity
and state" — using Hypothesis with a minimum of 100 iterations. The round-trip
contract is exercised against EVERY backend in the registry (bullmq, redis,
rabbitmq, sqs) so any backend is interchangeable behind the single interface.

Validates: Requirements 19.7
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.adapters.job_queue import build_job_queue_registry
from app.analysis.base import StructuredError
from app.analysis.contracts import (
    AnalysisResult,
    ObjectiveMetrics,
    RepetitionSummary,
)
from app.analysis.jobs import AnalysisJob, JobState


# ── Generators ───────────────────────────────────────────────────────────
# Smart generators that constrain to the adapter's input space: well-formed
# AnalysisJob records, every observable JobState for set_state transitions, and
# valid (NaN-free) AnalysisResult / StructuredError terminal payloads.

# Finite floats only — NaN/inf would break the value-preservation equality
# checks that the round-trip property asserts.
_floats = st.floats(allow_nan=False, allow_infinity=False, width=32)
_bounded = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
_keys = st.text(min_size=1, max_size=8)
_float_map = st.dictionaries(_keys, _floats, max_size=4)

# A job_id is either absent (empty -> adapter assigns one) or caller-supplied.
_job_ids = st.one_of(st.just(""), st.text(min_size=1, max_size=12))
_user_ids = st.text(min_size=1, max_size=12)

analysis_job = st.builds(
    AnalysisJob,
    job_id=_job_ids,
    user_id=_user_ids,
    state=st.just(JobState.queued),
)

# Any member of the defined Job_State set for a set_state transition.
job_states = st.sampled_from(list(JobState))

objective_metrics = st.builds(
    ObjectiveMetrics,
    joint_angles=_float_map,
    bar_path=st.lists(st.lists(_floats, min_size=2, max_size=2), max_size=3),
    depth=_floats,
    range_of_motion=_float_map,
    tempo=_floats,
    symmetry=_floats,
    center_of_mass=st.lists(_floats, min_size=2, max_size=3),
    balance=_floats,
    confidence=_bounded,
)

repetition_summary = st.builds(
    RepetitionSummary,
    rep_count=st.integers(min_value=0, max_value=50),
    phase_timestamps=st.just([]),
    avg_rep_duration_ms=st.floats(
        min_value=0.0, max_value=1e6, allow_nan=False, allow_infinity=False
    ),
    movement_consistency=_bounded,
)

analysis_result = st.builds(
    AnalysisResult,
    exercise_id=st.text(min_size=1, max_size=12),
    analysis_date=st.just("2024-01-01T00:00:00Z"),
    overall_score=_floats,
    movement_score=_floats,
    range_of_motion=_float_map,
    tempo=_floats,
    stability=_floats,
    symmetry=_floats,
    joint_alignment=_float_map,
    strengths=st.lists(st.text(max_size=8), max_size=3),
    mistakes=st.lists(st.text(max_size=8), max_size=3),
    corrections=st.lists(st.text(max_size=8), max_size=3),
    safety_warnings=st.lists(st.text(max_size=8), max_size=3),
    improvement_tips=st.lists(st.text(max_size=8), max_size=3),
    training_advice=st.lists(st.text(max_size=8), max_size=3),
    movement_metrics=objective_metrics,
    repetition_summary=repetition_summary,
    overall_confidence=_bounded,
    low_confidence=st.booleans(),
    user_corrections=st.just([]),
    analysisVersion=st.just("1.0.0"),
    poseEngineVersion=st.just("1.0.0"),
    visionModelVersion=st.just("1.0.0"),
    reasoningModelVersion=st.just("1.0.0"),
    pipelineVersion=st.just("1.0.0"),
)

structured_error = st.builds(
    StructuredError,
    code=st.text(min_size=1, max_size=12),
    message=st.text(max_size=24),
    stage=st.text(min_size=1, max_size=12),
)


# ── Property 23 ────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 23: Queue adapter round-trip
# preserves job identity and state — for every registered backend and any
# analysis job, enqueue returns a Job_Id observable in state `queued` with
# identity preserved; set_state / set_result / set_error are each reflected by
# a subsequent get.
@given(
    job=analysis_job,
    new_state=job_states,
    result=analysis_result,
    error=structured_error,
)
@settings(max_examples=200)
def test_queue_adapter_round_trip_preserves_identity_and_state(
    job: AnalysisJob,
    new_state: JobState,
    result: AnalysisResult,
    error: StructuredError,
):
    # The round-trip contract must hold across ALL registered backends so any
    # backend is interchangeable behind the single interface (Req 19.7).
    registry = build_job_queue_registry()
    assert set(registry) == {"bullmq", "redis", "rabbitmq", "sqs"}

    for name, adapter in registry.items():

        async def scenario():
            # enqueue → returns a Job_Id; the job is observable as `queued`
            # with its identity preserved.
            job_id = await adapter.enqueue(job)
            assert isinstance(job_id, str) and job_id

            stored = await adapter.get(job_id)
            assert stored is not None, f"{name}: enqueued job not retrievable"
            assert stored.job_id == job_id
            assert stored.state == JobState.queued
            assert stored.user_id == job.user_id
            # When the caller supplied a job_id it must be preserved verbatim.
            if job.job_id:
                assert job_id == job.job_id

            # set_state → reflected by a subsequent get (identity unchanged).
            await adapter.set_state(job_id, new_state)
            after_state = await adapter.get(job_id)
            assert after_state is not None
            assert after_state.state == new_state
            assert after_state.job_id == job_id
            assert after_state.user_id == job.user_id

            # set_result → state becomes `completed` and the result round-trips.
            await adapter.set_result(job_id, result)
            after_result = await adapter.get(job_id)
            assert after_result is not None
            assert after_result.state == JobState.completed
            assert after_result.result == result
            assert after_result.job_id == job_id

            # set_error → state becomes `failed` and the error round-trips.
            await adapter.set_error(job_id, error)
            after_error = await adapter.get(job_id)
            assert after_error is not None
            assert after_error.state == JobState.failed
            assert after_error.error == error
            assert after_error.job_id == job_id

            # An unknown id never resolves to a job.
            assert await adapter.get(job_id + "_missing") is None

        asyncio.run(scenario())
