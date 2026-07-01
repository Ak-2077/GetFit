"""
Background_Worker — runs the Analysis_Pipeline behind the Job_Queue_Adapter
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The `Background_Worker` consumes an `Analysis_Job` from the `Job_Queue_Adapter`
and drives the `Analysis_Pipeline` to completion *outside the request/response
cycle* (Req 19.2). It is the glue between the replaceable queue backend and the
orchestrator:

    Job_Queue_Adapter ──(job_id)──▶ Background_Worker ──▶ Analysis_Pipeline
            ▲                              │
            └────── set_state / set_result / set_error ◀──┘

Responsibilities
----------------
  • Consume (Req 19.2): given a `Job_Id` delivered by the queue backend, fetch
    the tracked `Analysis_Job` through the adapter and run the pipeline for it.
    The adapter is the only queue touchpoint, so the backend (BullMQ, Redis,
    RabbitMQ, SQS) is swappable with no change to the worker (Req 31.3).

  • Advance Job_State per stage (Req 19.4): the orchestrator already emits a
    `Progress_Event` to its `Progress_Service` at every stage boundary. The
    worker mirrors each non-terminal state onto the adapter via `set_state`, so
    a query by `Job_Id` observes the job advancing through the canonical states
    (Req 19.8). Terminal states are owned by `set_result` / `set_error` below.

  • Terminate in completed (Req 19.5): on a successful pipeline run the worker
    records the bounded `Analysis_Result` with `set_result`, which moves the
    job to `completed`.

  • Terminate in failed (Req 19.6): on any pipeline failure the worker records
    the originating `Structured_Error` with `set_error`, which moves the job to
    `failed` and associates the error with the job.

Never raises on a domain failure — exactly like the stages and the orchestrator
it drives. A failed probe, a failed pipeline run, or an unexpected exception is
folded into a `failed` job through `set_error`; the worker's public methods do
not propagate domain exceptions to the caller.

Testability
-----------
Every collaborator is injected: the `Job_Queue_Adapter`, the pipeline (or any
object exposing the same `run` seam), the `meta_provider` that yields the probed
`VideoMeta` for a job, and an optional `artifacts_provider` that pre-seeds the
per-job `ArtifactRegistry`. With an in-memory adapter and a stubbed pipeline a
test can drive one job end-to-end and assert the terminal state/result/error.
"""

from __future__ import annotations

import contextlib
import logging
from typing import Awaitable, Callable, Protocol, runtime_checkable

from .adapters.job_queue import JobQueueAdapter
from .base import StageResult, StructuredError
from .contracts import AnalysisResult, VideoMeta
from .jobs import AnalysisJob, JobState
from .stages.cleanup import ArtifactRegistry

logger = logging.getLogger("getfit-ai")

#: Stable code for a job whose probed VideoMeta could not be obtained — the
#: worker cannot run the pipeline without an input, so the job fails cleanly.
WORKER_NO_INPUT_ERROR: str = "WORKER_NO_INPUT"

#: Stable code for an unexpected worker-level failure (defensive). The pipeline
#: never raises on a domain failure, so this only fires if the worker itself or
#: an injected seam raises — it is folded into a `failed` job, never propagated.
WORKER_ERROR: str = "WORKER_ERROR"


@runtime_checkable
class PipelineRunner(Protocol):
    """Minimal seam the worker needs from an `Analysis_Pipeline` (Req 19.2).

    Any object exposing this asynchronous ``run`` signature can be driven by the
    worker, which keeps the worker decoupled from the concrete orchestrator and
    lets a test substitute a lightweight stub.
    """

    async def run(
        self,
        video: VideoMeta,
        *,
        job_id: str,
        artifacts: ArtifactRegistry | None = ...,
    ) -> StageResult[AnalysisResult]:
        ...


#: Yields the probed `VideoMeta` for a job, or None when no input is available
#: (e.g. the recording could not be fetched/probed). Returning None folds the
#: job into `failed` rather than raising.
MetaProvider = Callable[[AnalysisJob], Awaitable[VideoMeta | None]]

#: Optionally pre-seeds the per-job `ArtifactRegistry` (e.g. already holding the
#: original video path / working dir) so the Cleanup_Service has the full set to
#: remove. When omitted the pipeline creates a fresh registry for the job.
ArtifactsProvider = Callable[[AnalysisJob], Awaitable[ArtifactRegistry | None]]

#: Yields the next `Job_Id` to process, or None when the queue is drained / the
#: worker should stop pulling. The `Job_Queue_Adapter` ABC exposes no native
#: dequeue primitive (only enqueue / get / set_*), so the optional processing
#: loop is driven by this injected source — the concrete backend (BullMQ, Redis,
#: RabbitMQ, SQS) supplies one that blocks/polls for the next ready `Job_Id`,
#: keeping the worker decoupled from the backend (Req 31.3).
JobIdSource = Callable[[], Awaitable[str | None]]


class Background_Worker:
    """Consumes an Analysis_Job and runs the Analysis_Pipeline for it (Req 19.2).

    Construct with the queue adapter, the pipeline (or its ``run`` seam), and a
    ``meta_provider``; then call :meth:`process_job` with a ``Job_Id`` delivered
    by the queue backend, or :meth:`run_loop` to drain the queue.
    """

    def __init__(
        self,
        adapter: JobQueueAdapter,
        pipeline: PipelineRunner,
        *,
        meta_provider: MetaProvider,
        artifacts_provider: ArtifactsProvider | None = None,
        mirror_progress: bool = True,
        cancel_check: Callable[[str], bool] | None = None,
    ) -> None:
        self._adapter = adapter
        self._pipeline = pipeline
        self._meta_provider = meta_provider
        self._artifacts_provider = artifacts_provider
        # When True, each non-terminal Progress_Event the pipeline emits is
        # mirrored onto the adapter as a Job_State (Req 19.4). Disable to record
        # only terminal states (still satisfies Req 19.5/19.6).
        self._mirror_progress = mirror_progress
        # Optional predicate: returns True when a job has been cancelled. When it
        # reports a cancellation the worker leaves the (already-recorded)
        # terminal `cancelled` state intact instead of folding the run into
        # `completed`/`failed` (runtime reliability). Defaults to "never
        # cancelled" so existing behavior is unchanged.
        self._cancel_check = cancel_check or (lambda _job_id: False)

    # ── Public entrypoint ──────────────────────────────────────────────────

    async def process_job(self, job_id: str) -> AnalysisJob | None:
        """Consume one job by `Job_Id` and run it to a terminal state.

        Fetches the tracked job through the adapter (Req 19.2), obtains its
        probed `VideoMeta`, runs the pipeline outside the request cycle, mirrors
        each stage's `Job_State` onto the adapter (Req 19.4), and folds the
        outcome into `completed` (Req 19.5) or `failed` (Req 19.6).

        Returns the updated `AnalysisJob` (re-read through the adapter so the
        terminal state/result/error is reflected, Req 19.8), or None when no job
        exists for `job_id`. Never raises on a domain failure.
        """
        job = await self._adapter.get(job_id)
        if job is None:
            # Nothing to consume — the backend handed us an unknown id.
            logger.info("Background_Worker: no job found for id %s", job_id)
            return None

        try:
            await self._run_job(job)
        except Exception:  # pragma: no cover - defensive; nothing here should raise
            logger.exception("Background_Worker crashed for job %s", job_id)
            await self._adapter.set_error(
                job_id,
                StructuredError(
                    code=WORKER_ERROR,
                    message="The analysis worker failed unexpectedly.",
                    stage="worker",
                ),
            )

        # Re-read so the caller sees the terminal state/result/error (Req 19.8).
        return await self._adapter.get(job_id)

    async def run_loop(
        self,
        source: JobIdSource,
        *,
        stop: Callable[[], bool] | None = None,
        max_jobs: int | None = None,
    ) -> int:
        """Dequeue and process jobs until the source is drained or `stop` fires.

        Repeatedly pulls the next `Job_Id` from ``source`` and runs it to a
        terminal state via :meth:`process_job` — each job's pipeline runs outside
        the request/response cycle (Req 19.2) and terminates in `completed`
        (Req 19.5) or `failed` (Req 19.6). The loop ends when:

          • ``source`` yields None (the queue is drained), or
          • the optional ``stop`` predicate returns True (cooperative shutdown),
            checked before each pull, or
          • ``max_jobs`` jobs have been processed (bounded drain; omit for an
            unbounded loop).

        Returns the number of jobs processed. Never raises on a domain failure:
        each job's failure is already folded into a `failed` job by
        :meth:`process_job`, so one bad job does not stop the loop.
        """
        processed = 0
        while True:
            if stop is not None and stop():
                break
            if max_jobs is not None and processed >= max_jobs:
                break
            job_id = await source()
            if job_id is None:
                # Queue drained / source signalled stop.
                break
            await self.process_job(job_id)
            processed += 1
        return processed

    # ── Core processing ─────────────────────────────────────────────────────

    async def _run_job(self, job: AnalysisJob) -> None:
        """Run the pipeline for one job and record its terminal outcome."""
        job_id = job.job_id

        # A job cancelled before it starts is already in the terminal `cancelled`
        # state — do not run the pipeline or overwrite it (runtime reliability).
        if self._cancel_check(job_id):
            logger.info("Background_Worker: job %s already cancelled; not running.", job_id)
            return

        # Obtain the probed input. A missing/None VideoMeta means there is no
        # video to analyze, so the job fails cleanly (Req 19.6) — never raises.
        video = await self._meta_provider(job)
        if video is None:
            # A cancel that landed during acquisition must not be reported as a
            # failure — honor the cancellation instead.
            if self._cancel_check(job_id):
                logger.info("Background_Worker: job %s cancelled during acquisition.", job_id)
                return
            logger.info("Background_Worker: no VideoMeta for job %s; failing", job_id)
            await self._adapter.set_error(
                job_id,
                StructuredError(
                    code=WORKER_NO_INPUT_ERROR,
                    message="No analyzable video input was available for the job.",
                    stage="worker",
                ),
            )
            return

        artifacts = (
            await self._artifacts_provider(job)
            if self._artifacts_provider is not None
            else None
        )

        # Run the orchestrator outside the request/response cycle (Req 19.2),
        # mirroring each non-terminal Job_State onto the adapter (Req 19.4).
        with self._state_mirror(job_id):
            result = await self._pipeline.run(video, job_id=job_id, artifacts=artifacts)

        # If the job was cancelled during the run, the terminal `cancelled` state
        # was already recorded — leave it intact rather than clobbering it with a
        # completed/failed outcome (runtime reliability).
        if self._cancel_check(job_id):
            logger.info("Background_Worker: job %s cancelled during run; preserving state.", job_id)
            return

        if result.success and result.output is not None:
            # Terminal success: record the bounded result → completed (Req 19.5).
            await self._adapter.set_result(job_id, result.output)
            return

        # Terminal failure: associate the originating Structured_Error → failed
        # (Req 19.6). Fall back to a generic error if the pipeline somehow
        # reported failure without one (defensive — it always carries one).
        error = result.error or StructuredError(
            code=WORKER_ERROR,
            message="The analysis pipeline reported a failure without details.",
            stage="pipeline",
        )
        await self._adapter.set_error(job_id, error)

    # ── Job_State mirroring ──────────────────────────────────────────────────

    @contextlib.contextmanager
    def _state_mirror(self, job_id: str):
        """Mirror the pipeline's per-stage Progress_Events onto the adapter.

        The orchestrator publishes a `Progress_Event` at each stage boundary via
        its `Progress_Service`. For the duration of the run we wrap that service's
        ``publish`` so every non-terminal state is also written to the adapter via
        `set_state` (Req 19.4) — leaving the terminal `completed`/`failed`
        transitions to `set_result`/`set_error` so a result/error is never
        clobbered. The original ``publish`` is always restored afterward.

        Degrades gracefully: when mirroring is disabled or the injected pipeline
        exposes no compatible `Progress_Service`, this is a no-op and the worker
        still records the terminal states.
        """
        progress = getattr(self._pipeline, "progress", None)
        original_publish = getattr(progress, "publish", None)
        if not self._mirror_progress or original_publish is None:
            yield
            return

        adapter = self._adapter

        async def mirrored_publish(pub_job_id, state, percent=None):
            event = await original_publish(pub_job_id, state, percent)
            # Only mirror this job's non-terminal advances; terminal states are
            # owned by set_result/set_error.
            if pub_job_id == job_id and state not in (
                JobState.completed,
                JobState.failed,
            ):
                await adapter.set_state(pub_job_id, state)
            return event

        had_own_attr = "publish" in vars(progress)
        progress.publish = mirrored_publish  # type: ignore[attr-defined]
        try:
            yield
        finally:
            if had_own_attr:
                progress.publish = original_publish  # type: ignore[attr-defined]
            else:
                # Remove the instance shadow so the class method is used again.
                with contextlib.suppress(AttributeError):
                    delattr(progress, "publish")
