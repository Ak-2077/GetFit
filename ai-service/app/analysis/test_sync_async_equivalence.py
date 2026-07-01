"""
Property-based tests for synchronous vs. asynchronous orchestration of the
Analysis_Pipeline.

Covers design Property 26 — "Synchronous and asynchronous orchestration are
equivalent" — using Hypothesis with a minimum of 100 iterations.

For any input video (including ones that make a stage fail), the pipeline can be
driven two ways:

  • Synchronously / in-line: ``Analysis_Pipeline.run_job(...)`` is awaited
    directly, returning a terminal ``AnalysisJob``.

  • Asynchronously: an equivalent ``AnalysisJob`` is enqueued through the
    in-memory ``Job_Queue_Adapter`` and consumed by the ``Background_Worker``
    (``process_job``), which runs the same pipeline behind the adapter and folds
    the outcome into ``completed`` / ``failed`` on the tracked job.

Both paths MUST yield the EQUIVALENT outcome for the same input: the same
terminal ``JobState`` and an equal ``AnalysisResult`` (on success) or an equal
``Structured_Error`` (on failure), compared via ``model_dump`` equality.

The pipeline is made deterministic by reusing the stub-stage wiring from
``test_pipeline_ordering.py`` (every stage is a recording stub returning a
canned typed output, and Hypothesis chooses which stage — if any — fails), so
any difference between the two paths is attributable to the orchestration mode
alone.

Validates: Requirements 31.3
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.adapters.job_queue import build_job_queue_adapter
from app.analysis.jobs import AnalysisJob, JobState
from app.analysis.worker import Background_Worker

from app.analysis.test_pipeline_ordering import (
    CANONICAL_STAGES,
    _VIDEO,
    _build_pipeline,
)


_USER_ID = "user-1"


async def _run_synchronous(fail_stage: str | None) -> AnalysisJob:
    """Run the pipeline in-line via Analysis_Pipeline.run_job (synchronous)."""
    order: list[str] = []
    pipeline = _build_pipeline(order, fail_stage)
    return await pipeline.run_job(_VIDEO, job_id="job-sync", user_id=_USER_ID)


async def _run_asynchronous(fail_stage: str | None) -> AnalysisJob:
    """Run the pipeline via the Background_Worker behind the Job_Queue_Adapter.

    Enqueues an equivalent job, then consumes it with ``process_job`` using the
    same stub-wired pipeline and a ``meta_provider`` that yields the same probed
    ``VideoMeta``. Returns the terminal job re-read through the adapter.
    """
    order: list[str] = []
    pipeline = _build_pipeline(order, fail_stage)

    adapter = build_job_queue_adapter("bullmq")  # self-contained in-memory store
    job_id = await adapter.enqueue(AnalysisJob(job_id="", user_id=_USER_ID))

    async def meta_provider(_job: AnalysisJob):
        return _VIDEO

    worker = Background_Worker(adapter, pipeline, meta_provider=meta_provider)
    terminal = await worker.process_job(job_id)
    assert terminal is not None  # the job we just enqueued must exist
    return terminal


# ── Property 26 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 26: Synchronous and asynchronous
# orchestration are equivalent.
@given(fail_stage=st.one_of(st.none(), st.sampled_from(CANONICAL_STAGES)))
@settings(max_examples=100)
def test_sync_and_async_orchestration_are_equivalent(fail_stage: str | None):
    sync_job = asyncio.run(_run_synchronous(fail_stage))
    async_job = asyncio.run(_run_asynchronous(fail_stage))

    # Same terminal state on both orchestration paths.
    assert sync_job.state == async_job.state

    if fail_stage is None:
        # Clean run: both terminate in `completed` with an equal AnalysisResult
        # and no error (Req 31.3).
        assert sync_job.state == JobState.completed
        assert sync_job.result is not None
        assert async_job.result is not None
        assert sync_job.result.model_dump() == async_job.result.model_dump()
        assert sync_job.error is None
        assert async_job.error is None
    else:
        # Failing run: both terminate in `failed` with an equal Structured_Error
        # and no result (Req 31.3).
        assert sync_job.state == JobState.failed
        assert sync_job.error is not None
        assert async_job.error is not None
        assert sync_job.error.model_dump() == async_job.error.model_dump()
        assert sync_job.result is None
        assert async_job.result is None
