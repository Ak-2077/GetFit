"""
Analysis runtime — shared queue/progress + the always-on Background_Worker
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Owns the process-wide singletons the exercise-analysis feature shares between
the HTTP router (which enqueues jobs and serves status/result) and the
`Background_Worker` (which consumes them out-of-band):

  • `queue`    — the `Job_Queue_Adapter` (in-memory by default).
  • `progress` — the `Progress_Service` polled by `/status`.
  • `runner`   — the `RealPipelineRunner` (video acquisition + real pipeline).
  • `worker`   — the `Background_Worker` driving the runner.
  • an in-process ready-queue (`asyncio.Queue`) the router pushes freshly
    enqueued job ids onto and the worker loop pulls from — giving continuous,
    event-driven consumption without a native backend dequeue primitive.

`start()` / `stop()` are called from the FastAPI lifespan for clean startup and
graceful shutdown of the worker task.
"""

from __future__ import annotations

import asyncio
import logging

from .adapters.job_queue import build_job_queue_adapter
from .adapters.progress import Progress_Service
from .jobs import AnalysisJob, JobState
from .real_pipeline import RealPipelineRunner
from .worker import Background_Worker

logger = logging.getLogger("getfit-ai")

#: Job ids the End_User has explicitly cancelled. Checked (a) by the worker loop
#: to skip a still-queued job without running it, and (b) inside the runner
#: before the pipeline starts, so a cancel that arrives while the job is queued
#: never wastes compute. Additive to the existing queue lifecycle.
_cancelled: set[str] = set()


def is_cancelled(job_id: str) -> bool:
    """Return True when ``job_id`` has been marked cancelled (runner/worker use this)."""
    return job_id in _cancelled


# ── Process-wide singletons (shared by the router and the worker) ────────────
queue = build_job_queue_adapter()
progress = Progress_Service()
runner = RealPipelineRunner(progress, cancel_check=is_cancelled)
worker = Background_Worker(
    queue,
    runner,
    meta_provider=runner.meta_provider,
    mirror_progress=True,
    cancel_check=is_cancelled,
)

#: Job ids ready to process, pushed by `submit_job`, pulled by the worker loop.
_ready: "asyncio.Queue[str]" = asyncio.Queue()

_worker_task: asyncio.Task | None = None
_stopping = False


async def submit_job(
    *,
    video_ref: str | None,
    user_id: str = "anonymous",
    exercise_hint: str | None = None,
    video_sha256: str | None = None,
) -> str:
    """Enqueue a new analysis job and hand it to the worker (Req 19.1).

    Stores the job in state `queued`, seeds the first Progress_Event, and pushes
    the job id onto the ready-queue for continuous consumption. ``video_sha256``
    is the optional integrity digest computed at the upload boundary; when
    supplied the runner verifies the downloaded bytes match before processing.
    """
    job = AnalysisJob(
        job_id="",
        user_id=user_id,
        state=JobState.queued,
        video_ref=video_ref,
        exercise_hint=exercise_hint,
        expected_sha256=video_sha256,
    )
    job_id = await queue.enqueue(job)
    await progress.publish(job_id, JobState.queued)
    await _ready.put(job_id)
    return job_id


async def cancel_job(job_id: str) -> bool:
    """Cancel an in-flight or queued analysis job (runtime reliability).

    Marks the job cancelled so (a) the worker skips it if still queued and (b)
    the runner aborts before starting the pipeline, then records the terminal
    `cancelled` state on the queue so `/status` and `/result` observe it. Any
    transient video the runner already acquired is deleted by the runner's own
    finally-block. Returns True when a known, non-terminal job was cancelled;
    False when the job is unknown or already terminal.
    """
    job = await queue.get(job_id)
    if job is None:
        return False
    if job.state in (JobState.completed, JobState.failed, JobState.cancelled):
        return False

    _cancelled.add(job_id)
    # Record the terminal cancelled state. set_error would fold it into `failed`
    # with an error payload; instead set the state directly so it reads as a
    # clean, user-initiated cancellation.
    await queue.set_state(job_id, JobState.cancelled)
    await progress.publish(job_id, JobState.cancelled)
    logger.info("Analysis job %s cancelled by request.", job_id)
    return True


async def _next_ready_job() -> str | None:
    """Block for the next ready job id; yield None when shutting down.

    A job cancelled while still queued is skipped here (and its transient state
    was already set to `cancelled` by :func:`cancel_job`), so the worker never
    starts a pipeline for it.
    """
    while True:
        if _stopping:
            return None
        try:
            job_id = await asyncio.wait_for(_ready.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        if job_id in _cancelled:
            logger.info("Skipping cancelled job %s (was still queued).", job_id)
            _cancelled.discard(job_id)
            continue
        return job_id


async def _run_worker_loop() -> None:
    """Continuously consume queued jobs until shutdown (Req 19.2)."""
    logger.info("Exercise-analysis Background_Worker started.")
    try:
        await worker.run_loop(_next_ready_job, stop=lambda: _stopping)
    except asyncio.CancelledError:  # pragma: no cover - shutdown path
        logger.info("Exercise-analysis Background_Worker cancelled.")
        raise
    except Exception:  # pragma: no cover - defensive; loop never propagates domain errors
        logger.exception("Exercise-analysis Background_Worker crashed.")
    finally:
        logger.info("Exercise-analysis Background_Worker stopped.")


def start() -> None:
    """Start the always-on worker task (idempotent). Called from lifespan startup."""
    global _worker_task, _stopping
    if _worker_task is not None and not _worker_task.done():
        return
    _stopping = False
    _worker_task = asyncio.create_task(_run_worker_loop(), name="exercise-analysis-worker")


async def stop() -> None:
    """Signal the worker to drain and stop, then await/cancel it (graceful shutdown)."""
    global _worker_task, _stopping
    _stopping = True
    task = _worker_task
    if task is None:
        return
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
    except asyncio.TimeoutError:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # pragma: no cover - shutdown path
            pass
    except (asyncio.CancelledError, Exception):  # pragma: no cover - shutdown path
        pass
    finally:
        _worker_task = None
