"""
Analysis Job & Progress Models
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The async job model already sketched in `ai-service/app/routers/video.py`
(submit → `job_id` → poll `/result/{job_id}`) formalized into a real
`Job_State` lifecycle and the `Analysis_Job` record that the
`Job_Queue_Adapter` (see `adapters/job_queue.py`) enqueues, tracks, and
completes.

`JobState` enumerates every observable state of an analysis job (Req 19.x,
20.x). A freshly submitted job starts in `queued` before any stage runs
(Req 19.1); each analytical stage maps to its own in-flight state; a run
terminates in either `completed` (with a result) or `failed` (with a
Structured_Error).

Mirrors the Pydantic v2 conventions used across `app/analysis/contracts.py`
and `app/models/schemas.py`.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel

from .base import StructuredError
from .contracts import AnalysisResult


class JobState(str, Enum):
    """
    The complete set of observable analysis-job states (Req 19.x, 20.x).

    `queued` is the initial state returned by submission before any stage runs
    (Req 19.1). The middle members map one-to-one to the analytical pipeline
    stages. `completed` and `failed` are the two terminal outcomes (Req 19.5,
    19.6).
    """
    queued = "queued"
    validating = "validating"
    extracting_frames = "extracting_frames"
    frame_quality = "frame_quality"
    selecting_keyframes = "selecting_keyframes"
    detecting_exercise = "detecting_exercise"
    extracting_pose = "extracting_pose"
    building_timeline = "building_timeline"
    biomechanics = "biomechanics"
    reasoning = "reasoning"
    generating_feedback = "generating_feedback"
    cleaning_up = "cleaning_up"
    completed = "completed"
    failed = "failed"
    #: A job the End_User explicitly cancelled before it reached a terminal
    #: outcome (runtime reliability). Additive — never produced by the pipeline
    #: itself, only by an explicit cancel request.
    cancelled = "cancelled"


#: Human-readable progress labels per state (Req 20.3). Excludes raw
#: video/frames/pose — only the bounded label is ever surfaced (Req 20.6).
PROGRESS_LABELS: dict[JobState, str] = {
    JobState.queued: "Uploading",
    JobState.validating: "Validating",
    JobState.extracting_frames: "Extracting Frames",
    JobState.selecting_keyframes: "Selecting Key Frames",
    JobState.detecting_exercise: "Detecting Exercise",
    JobState.extracting_pose: "Extracting Pose",
    JobState.building_timeline: "Building Timeline",
    JobState.biomechanics: "Computing Biomechanics",
    JobState.generating_feedback: "Generating Feedback",
    JobState.cleaning_up: "Cleaning Temporary Files",
    JobState.completed: "Complete",
}


class ProgressEvent(BaseModel):
    """
    A single progress observation for an in-flight job (Req 20.x).

    Carries only the bounded state/label/percent — never raw video, frames, or
    pose data (Req 20.6).
    """
    job_id: str
    state: JobState
    label: str
    percent: float | None = None


class AnalysisJob(BaseModel):
    """
    The tracked record of one analysis request (Req 19.x).

    A job is created in `queued` (Req 19.1), associated with the submitting
    `user_id` (Req 13.4), and carries either its terminal `result` (on
    `completed`) or `error` (on `failed`) — never both.
    """
    job_id: str
    user_id: str
    state: JobState = JobState.queued
    result: AnalysisResult | None = None
    error: StructuredError | None = None
    #: Fetchable reference (http(s) URL or local path) to the recording the
    #: Background_Worker acquires, probes, analyzes, then deletes. Optional so
    #: existing callers/tests that construct a job without it keep working.
    video_ref: str | None = None
    #: Optional exercise hint supplied at submission to assist detection.
    exercise_hint: str | None = None
    #: Optional SHA-256 hex digest the upload boundary computed for the
    #: recording. When present, the acquisition seam recomputes the digest of
    #: the fetched bytes and fails the job with INTEGRITY_MISMATCH on mismatch,
    #: guaranteeing the analyzed bytes are exactly what was uploaded. Optional so
    #: existing callers/tests that omit it keep working unchanged.
    expected_sha256: str | None = None
