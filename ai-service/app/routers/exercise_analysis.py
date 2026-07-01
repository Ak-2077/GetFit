"""
Exercise Analysis Router — submit → job_id → poll status/result (Req 18, 19, 20)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HTTP surface for the AI exercise-analysis pipeline. The router only *enqueues*
work and *queries* it — the actual pipeline execution happens out-of-band in the
`Background_Worker` (see `app/analysis/worker.py`, Req 19.2). It follows the
proven submit → `job_id` → poll pattern sketched in `app/routers/video.py`,
formalized onto the real `Job_Queue_Adapter` lifecycle (`app/analysis/jobs.py`).

Endpoints (mounted in `app/main.py` WITHOUT an extra prefix — this router owns
its own `/exercise-analysis` prefix to avoid double-prefixing):

  • POST /exercise-analysis/submit          → enqueue an Analysis_Job, return
                                               { job_id, state: "queued" } (Req 19.1, 18.2)
  • GET  /exercise-analysis/status/{job_id} → current Job_State + latest
                                               Progress_Event (Req 19.8, 20.4)
  • GET  /exercise-analysis/result/{job_id} → the AnalysisResult once completed,
                                               else the current state

The Job_Queue_Adapter and Progress_Service are built ONCE at import time so the
default in-memory store persists across requests within the process. Selecting a
different backend is purely a configuration concern (Req 19.7).
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.analysis import runtime
from app.analysis.contracts import AnalysisResult
from app.analysis.jobs import JobState, ProgressEvent

router = APIRouter(prefix="/exercise-analysis", tags=["Exercise Analysis"])

# The queue, progress service, and Background_Worker are owned by the shared
# `app.analysis.runtime` module so the HTTP router (enqueue + status/result) and
# the always-on worker (consume) operate on the SAME in-process state (Req 19.7,
# 20.4). The worker is started/stopped from the FastAPI lifespan.
_queue = runtime.queue
_progress = runtime.progress


# ── Request / Response models ────────────────────────────────────────────────

class ExerciseAnalysisSubmitRequest(BaseModel):
    """Submission payload for a new analysis job (Req 18.2).

    The recording is referenced by handle/URL — raw bytes are never carried in
    the request. `exercise_hint` is an optional prior to assist detection.
    """
    video_url: Optional[str] = Field(
        default=None, description="URL/handle of the recording to analyze."
    )
    video_ref: Optional[str] = Field(
        default=None, description="Alternative opaque reference to the recording."
    )
    exercise_hint: Optional[str] = Field(
        default=None, description="Optional exercise hint to assist detection."
    )
    video_sha256: Optional[str] = Field(
        default=None,
        description="Optional SHA-256 hex digest of the recording, computed at "
        "the upload boundary, used to verify integrity before processing.",
    )
    user_id: str = Field(
        default="anonymous", description="Submitting user id (Req 13.4)."
    )


class ExerciseAnalysisSubmitResponse(BaseModel):
    """Returned immediately on submission — the job starts in `queued` (Req 19.1)."""
    job_id: str
    state: JobState = JobState.queued


class ExerciseAnalysisStatusResponse(BaseModel):
    """Current job state plus the latest progress observation (Req 19.8, 20.4)."""
    job_id: str
    state: JobState
    progress: Optional[ProgressEvent] = None
    #: On a `failed` job, the sanitized error (code + message) so the client can
    #: show the real reason instead of a generic message. None otherwise.
    error: Optional[dict] = None


class ExerciseAnalysisResultResponse(BaseModel):
    """Terminal result when completed, else the current state (Req 19.5, 19.8).

    `result` is populated only when `state == completed`. On `failed`, `error`
    carries the sanitized, human-safe error code/message.
    """
    job_id: str
    state: JobState
    result: Optional[AnalysisResult] = None
    error: Optional[dict] = None


class ExerciseAnalysisCancelResponse(BaseModel):
    """Outcome of a cancellation request (runtime reliability).

    `cancelled` is True when a known, non-terminal job was transitioned to the
    terminal `cancelled` state; False when the job was unknown or already
    terminal (in which case `state` reflects its current/last-known state).
    """
    job_id: str
    cancelled: bool
    state: JobState


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/submit", response_model=ExerciseAnalysisSubmitResponse)
async def submit_exercise_analysis(
    request: ExerciseAnalysisSubmitRequest,
) -> ExerciseAnalysisSubmitResponse:
    """Enqueue an Analysis_Job and return its `job_id` in state `queued`.

    The pipeline itself runs out-of-band in the Background_Worker (Req 19.2);
    this handler only enqueues the job through the Job_Queue_Adapter, which
    stores it in `queued` before any stage runs (Req 19.1, 18.2).
    """
    if not (request.video_url or request.video_ref):
        raise HTTPException(
            status_code=422,
            detail="A video_url or video_ref is required to submit an analysis.",
        )

    # Enqueue through the shared runtime: stores the job in `queued`, seeds the
    # first Progress_Event, and hands the job id to the always-on worker for
    # continuous, out-of-band processing (Req 19.1, 19.2).
    job_id = await runtime.submit_job(
        video_ref=request.video_url or request.video_ref,
        user_id=request.user_id,
        exercise_hint=request.exercise_hint,
        video_sha256=request.video_sha256,
    )

    return ExerciseAnalysisSubmitResponse(job_id=job_id, state=JobState.queued)


@router.get("/status/{job_id}", response_model=ExerciseAnalysisStatusResponse)
async def get_exercise_analysis_status(job_id: str) -> ExerciseAnalysisStatusResponse:
    """Return the tracked Job_State plus the latest Progress_Event (Req 19.8, 20.4)."""
    job = await _queue.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    progress = await _progress.latest(job_id)
    return ExerciseAnalysisStatusResponse(
        job_id=job_id,
        state=job.state,
        progress=progress,
        error=job.error.model_dump() if job.error is not None else None,
    )


@router.get("/result/{job_id}", response_model=ExerciseAnalysisResultResponse)
async def get_exercise_analysis_result(job_id: str) -> ExerciseAnalysisResultResponse:
    """Return the AnalysisResult when completed, else the current state.

    On `completed` the bounded `result` is returned (Req 19.5); on `failed` the
    sanitized `error` is surfaced (Req 19.6); otherwise only the in-flight state
    is reported so the client keeps polling (Req 19.8).
    """
    job = await _queue.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    return ExerciseAnalysisResultResponse(
        job_id=job_id,
        state=job.state,
        result=job.result if job.state == JobState.completed else None,
        error=job.error.model_dump() if job.error is not None else None,
    )


@router.post("/cancel/{job_id}", response_model=ExerciseAnalysisCancelResponse)
async def cancel_exercise_analysis(job_id: str) -> ExerciseAnalysisCancelResponse:
    """Cancel a queued or in-flight Analysis_Job (runtime reliability).

    Transitions a known, non-terminal job to the terminal `cancelled` state so
    the worker never (or no longer) runs it and any transient video is deleted.
    Returns 404 when the job is unknown. When the job already reached a terminal
    state, `cancelled` is False and the current state is echoed back.
    """
    job = await _queue.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    cancelled = await runtime.cancel_job(job_id)
    # Re-read so the response reflects the (possibly updated) terminal state.
    latest = await _queue.get(job_id)
    return ExerciseAnalysisCancelResponse(
        job_id=job_id,
        cancelled=cancelled,
        state=latest.state if latest is not None else job.state,
    )
