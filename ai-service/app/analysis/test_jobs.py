"""
Property-based tests for the Analysis_Job lifecycle (app/analysis/jobs.py)
driven through the Job_Queue_Adapter (app/analysis/adapters/job_queue.py).

Covers design Property 22 — "Job lifecycle — valid states, terminal outcomes,
and query round-trip" — using Hypothesis with a minimum of 100 iterations.

Validates: Requirements 16.4, 18.2, 19.1, 19.3, 19.4, 19.5, 19.6, 19.8
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.adapters.job_queue import BullMQJobQueueAdapter
from app.analysis.base import StructuredError
from app.analysis.contracts import (
    AnalysisResult,
    ObjectiveMetrics,
    RepetitionSummary,
)
from app.analysis.jobs import AnalysisJob, JobState


# ── Generators ───────────────────────────────────────────────────────────
# Smart generators that constrain to the valid input space: identifiers are
# non-empty tokens, every confidence/score stays bounded, and the lifecycle
# transitions are drawn only from the non-terminal Job_State members so the
# terminal outcome is chosen exactly once by the property itself.

_finite = {"allow_nan": False, "allow_infinity": False}
_tokens = st.text(min_size=1, max_size=12).filter(lambda s: s.strip() != "")
_confidence = st.floats(min_value=0.0, max_value=1.0, **_finite)
_metric = st.floats(min_value=-1e3, max_value=1e3, **_finite)
_non_negative = st.floats(min_value=0.0, max_value=1e6, **_finite)

#: Job_State members that are NOT terminal outcomes — the states a job may
#: legitimately move through before it completes or fails (Req 19.3, 19.4).
_NON_TERMINAL_STATES = [
    s for s in JobState if s not in (JobState.completed, JobState.failed)
]

_str_float_map = st.dictionaries(_tokens, _metric, max_size=4)


objective_metrics = st.builds(
    ObjectiveMetrics,
    joint_angles=_str_float_map,
    bar_path=st.lists(st.lists(_metric, min_size=2, max_size=2), max_size=4),
    depth=_metric,
    range_of_motion=_str_float_map,
    tempo=_metric,
    symmetry=_metric,
    center_of_mass=st.lists(_metric, min_size=2, max_size=3),
    balance=_metric,
    confidence=_confidence,
)

repetition_summary = st.builds(
    RepetitionSummary,
    rep_count=st.integers(min_value=0, max_value=50),
    phase_timestamps=st.just([]),
    avg_rep_duration_ms=_non_negative,
    movement_consistency=_confidence,
)

analysis_result = st.builds(
    AnalysisResult,
    exercise_id=_tokens,
    analysis_date=_tokens,
    overall_score=_metric,
    movement_score=_metric,
    range_of_motion=_str_float_map,
    tempo=_metric,
    stability=_metric,
    symmetry=_metric,
    joint_alignment=_str_float_map,
    strengths=st.lists(_tokens, max_size=3),
    mistakes=st.lists(_tokens, max_size=3),
    corrections=st.lists(_tokens, max_size=3),
    safety_warnings=st.lists(_tokens, max_size=3),
    improvement_tips=st.lists(_tokens, max_size=3),
    training_advice=st.lists(_tokens, max_size=3),
    movement_metrics=objective_metrics,
    repetition_summary=repetition_summary,
    overall_confidence=_confidence,
    low_confidence=st.booleans(),
    analysisVersion=_tokens,
    poseEngineVersion=_tokens,
    visionModelVersion=_tokens,
    reasoningModelVersion=_tokens,
    pipelineVersion=_tokens,
)

structured_error = st.builds(
    StructuredError,
    code=_tokens,
    message=_tokens,
    stage=_tokens,
)

# A job submitted for analysis. job_id is sometimes blank (the adapter assigns
# one) and sometimes pre-set, so both enqueue paths are exercised.
analysis_jobs = st.builds(
    AnalysisJob,
    job_id=st.one_of(st.just(""), _tokens),
    user_id=_tokens,
)

# An ordered run of intermediate states the worker advances through before the
# terminal outcome (Req 19.3, 19.4).
transition_sequences = st.lists(st.sampled_from(_NON_TERMINAL_STATES), max_size=6)


# ── Property 22 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 22: Job lifecycle — valid states,
# terminal outcomes, and query round-trip
@given(
    job=analysis_jobs,
    transitions=transition_sequences,
    succeeds=st.booleans(),
    result=analysis_result,
    error=structured_error,
)
@settings(max_examples=200)
def test_job_lifecycle_states_terminal_outcomes_and_query_round_trip(
    job: AnalysisJob,
    transitions: list[JobState],
    succeeds: bool,
    result: AnalysisResult,
    error: StructuredError,
):
    async def scenario() -> None:
        adapter = BullMQJobQueueAdapter()

        # A query for an unknown id round-trips to nothing (Req 19.8).
        assert await adapter.get("does-not-exist") is None

        # Submission returns a Job_Id and the job is observable as queued
        # before any stage runs (Req 19.1).
        job_id = await adapter.enqueue(job)
        assert isinstance(job_id, str) and job_id != ""

        queued = await adapter.get(job_id)
        assert queued is not None
        assert queued.job_id == job_id
        assert queued.state == JobState.queued
        assert queued.state in JobState

        # Advancing through the mapped intermediate states: each observation is
        # a valid Job_State member and round-trips by Job_Id (Req 19.3, 19.4).
        for state in transitions:
            await adapter.set_state(job_id, state)
            observed = await adapter.get(job_id)
            assert observed is not None
            assert observed.state == state
            assert observed.state in JobState
            assert observed.job_id == job_id

        if succeeds:
            # Successful run terminates in completed with the result retrievable
            # by Job_Id, and never carries an error (Req 19.5, 19.8).
            await adapter.set_result(job_id, result)
            done = await adapter.get(job_id)
            assert done is not None
            assert done.state == JobState.completed
            assert done.state in JobState
            assert done.result == result
            assert done.error is None
        else:
            # Failed run terminates in failed with the Structured_Error
            # retrievable by Job_Id, and never carries a result (Req 19.6, 19.8).
            await adapter.set_error(job_id, error)
            failed = await adapter.get(job_id)
            assert failed is not None
            assert failed.state == JobState.failed
            assert failed.state in JobState
            assert failed.error == error
            assert failed.result is None

    asyncio.run(scenario())
