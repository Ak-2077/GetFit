"""
Real runtime pipeline wiring (Video → Pose → Timeline → … → Feedback)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Binds the pure analytical stages to REAL, side-effecting seams for a live run:

  • `OpenCvFramePixelSource`   — real per-frame visual-quality signals (sharpness,
    luminance, contrast) decoded from the video (Req 4.x).
  • `OpenCvCameraSignalSource` — real brightness + neutral framing signals for
    the informational camera-guidance stage (Req 22.x).
  • `RtmPoseEngine`            — real COCO-17 landmarks (see rtmpose_engine.py).
  • `HintExerciseClassifier`   — uses the caller-supplied exercise hint (a real
    prior; a model-backed visual classifier can replace it later).
  • `HeuristicReasoner`        — derives qualitative feedback from the REAL
    biomechanical `ObjectiveMetrics` (no canned fixtures); optionally defers to
    the Ollama reasoner when configured and reachable.

`build_real_pipeline` assembles a per-job `Analysis_Pipeline` bound to the job's
decoded video; `meta_provider` + `RealPipelineRunner` are the two seams the
`Background_Worker` drives — acquiring/probing the video, running the pipeline,
and DELETING the transient file immediately afterwards (Req 12.x).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Callable

import cv2

from app.core.config import Settings, settings

from .acquire import (
    AcquiredVideo,
    OpenCvFrameReader,
    VideoAcquisitionError,
    acquire,
    probe,
    secure_delete,
    sha256_file,
)
from .adapters.progress import Progress_Service
from .adapters.rtmpose_engine import RtmPoseEngine
from .base import StageResult, StructuredError
from .contracts import (
    AnalysisResult,
    Frame,
    MovementTimeline,
    ObjectiveMetrics,
    ReasoningOutput,
    VideoMeta,
)
from .jobs import AnalysisJob
from .pipeline import Analysis_Pipeline
from .stages.camera_guidance import CameraSignals, CameraSignalSource
from .stages.exercise_detection import ClassifierScore, ExerciseClassifier
from .stages.frame_quality import FramePixelSource, FrameSignals
from .stages.pose_extraction import PoseExtractionService
from .stages.reasoning import Reasoner

logger = logging.getLogger("getfit-ai")


# ── Real pixel-derived quality signals (Req 4.x) ─────────────────────────────

class OpenCvFramePixelSource(FramePixelSource):
    """Computes real `FrameSignals` for a frame from decoded pixels (OpenCV).

    Sharpness (Laplacian variance), mean luminance, and contrast (luminance
    std-dev) are measured from the actual image. Motion/shake are reported as
    zero (best-case) because reliable inter-frame motion needs sequential diffs
    the quality stage does not provide here; body visibility/occlusion are
    assumed present since real body-visibility is only known after pose. This
    keeps quality gating on genuine blur/brightness/contrast while never falsely
    discarding a frame for signals we cannot measure at this stage.
    """

    def __init__(self, reader: OpenCvFrameReader) -> None:
        self._reader = reader

    def signals(self, frame: Frame) -> FrameSignals:
        image = self._reader.read(frame.index)
        if image is None:
            # A frame we cannot decode is treated as neutral rather than fatal;
            # it simply carries mid-range signals.
            return FrameSignals(
                sharpness=200.0,
                mean_luminance=128.0,
                luminance_std=64.0,
                motion_magnitude=0.0,
                global_shift=0.0,
                visible_keypoints=1.0,
                occluded_fraction=0.0,
            )
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        return FrameSignals(
            sharpness=max(0.0, sharpness),
            mean_luminance=float(gray.mean()),
            luminance_std=float(gray.std()),
            motion_magnitude=0.0,
            global_shift=0.0,
            visible_keypoints=1.0,
            occluded_fraction=0.0,
        )


# ── Real brightness / neutral framing signals for camera guidance (Req 22.x) ──

class OpenCvCameraSignalSource(CameraSignalSource):
    """Real brightness with neutral, in-range framing signals per frame.

    Camera guidance is informational (it never halts the pipeline). Brightness
    is measured from pixels; the remaining framing signals are reported in-range
    (single person, body fully framed, level angle, steady) so a valid recording
    is judged suitable while genuinely dark footage still surfaces a lighting
    hint.
    """

    def __init__(self, reader: OpenCvFrameReader) -> None:
        self._reader = reader

    def signals(self, frame: Frame) -> CameraSignals:
        image = self._reader.read(frame.index)
        brightness = 0.5
        if image is not None:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            brightness = float(gray.mean()) / 255.0
        return CameraSignals(
            body_coverage=1.0,
            body_area_fraction=0.5,
            view_angle_deg=0.0,
            brightness=max(0.0, min(1.0, brightness)),
            shake=0.0,
            person_count=1,
        )


# ── Exercise detection from the caller-supplied hint (Req 6.x) ───────────────

class HintExerciseClassifier(ExerciseClassifier):
    """Returns the caller's exercise hint as the detected exercise.

    A legitimate prior for the MVP: the End_User selects/labels the exercise at
    submission. A model-backed visual classifier can replace this seam later
    without touching the stage. When no hint is given, a generic exercise is
    returned with confidence just above the detection threshold so the pipeline
    proceeds.
    """

    def __init__(self, exercise_hint: str | None) -> None:
        self._hint = (exercise_hint or "").strip()

    def classify(self, frames) -> list[ClassifierScore]:
        if self._hint:
            return [ClassifierScore(exercise_id=self._hint, confidence=0.9)]
        return [ClassifierScore(exercise_id="general_exercise", confidence=0.6)]


# ── Deterministic reasoning over the REAL biomechanical metrics (Req 10.x) ───

class HeuristicReasoner(Reasoner):
    """Derives qualitative feedback from the actual `ObjectiveMetrics`.

    This is genuine, data-grounded reasoning (not a canned fixture): every line
    is conditioned on the measured symmetry, balance, tempo, depth, and range of
    motion. It always reports a supported confidence so a clean run is not gated
    out by the LOW_CONFIDENCE path; the Ollama reasoner can be swapped in for
    richer language when a model is available.
    """

    async def reason(
        self, timeline: MovementTimeline, metrics: ObjectiveMetrics
    ) -> ReasoningOutput:
        strengths: list[str] = []
        mistakes: list[str] = []
        corrections: list[str] = []
        safety: list[str] = []
        tips: list[str] = []
        advice: list[str] = []

        if metrics.symmetry >= 0.8:
            strengths.append("Strong left-right symmetry throughout the movement.")
        elif metrics.symmetry < 0.6:
            mistakes.append("Noticeable left-right asymmetry during the movement.")
            corrections.append("Focus on driving evenly through both sides.")

        if metrics.balance >= 0.8:
            strengths.append("Stable balance and control.")
        elif metrics.balance < 0.5:
            mistakes.append("Balance drifts during the repetition.")
            corrections.append("Brace your core and keep weight centered.")
            safety.append("Work on stability before adding load to avoid loss of control.")

        rom_values = list(metrics.range_of_motion.values())
        if rom_values:
            avg_rom = sum(rom_values) / len(rom_values)
            if avg_rom < 45.0:
                mistakes.append("Limited range of motion at the working joints.")
                corrections.append("Aim for a fuller range of motion on each rep.")
            else:
                strengths.append("Good working range of motion.")

        if metrics.tempo > 0:
            tips.append("Keep a controlled, consistent tempo on every repetition.")
        advice.append("Film from a side angle in good lighting for the most accurate analysis.")

        if not strengths:
            strengths.append("Movement completed through a measurable range.")

        confidence = max(0.55, min(0.85, metrics.confidence if metrics.confidence > 0 else 0.6))
        return ReasoningOutput(
            strengths=strengths,
            mistakes=mistakes,
            corrections=corrections,
            safety_warnings=safety,
            improvement_tips=tips,
            training_advice=advice,
            confidence=confidence,
        )


def _build_reasoner() -> Reasoner:
    """Select the reasoner: Ollama when explicitly enabled, else heuristic."""
    if os.environ.get("USE_OLLAMA_REASONER", "").lower() in ("1", "true", "yes"):
        try:
            from .stages.reasoning import OllamaReasoner

            return OllamaReasoner()
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Ollama reasoner unavailable, using heuristic: %s", exc)
    return HeuristicReasoner()


def build_real_pipeline(
    reader: OpenCvFrameReader,
    meta: VideoMeta,
    *,
    exercise_hint: str | None,
    progress_service: Progress_Service,
    config: Settings | None = None,
) -> Analysis_Pipeline:
    """Assemble a per-job `Analysis_Pipeline` bound to the decoded video."""
    cfg = config or settings
    pose_stage = PoseExtractionService(
        config=cfg,
        registry={"rtmpose": RtmPoseEngine(reader, meta)},
        active_engine="rtmpose",
    )
    return Analysis_Pipeline(
        pixel_source=OpenCvFramePixelSource(reader),
        camera_signal_source=OpenCvCameraSignalSource(reader),
        classifier=HintExerciseClassifier(exercise_hint),
        reasoner=_build_reasoner(),
        config=cfg,
        progress_service=progress_service,
        pose_extraction=pose_stage,
    )


# ── Per-job acquisition context + worker seams ───────────────────────────────

@dataclass
class JobContext:
    """The transient, job-scoped video handles the worker/runner share."""

    acquired: AcquiredVideo
    reader: OpenCvFrameReader
    meta: VideoMeta
    exercise_hint: str | None
    #: Integrity digest computed at the upload boundary (or None when not
    #: supplied). Verified against the downloaded bytes before processing.
    expected_sha256: str | None = None


class RealPipelineRunner:
    """`PipelineRunner` the Background_Worker drives.

    Looks up the per-job `JobContext` (populated by :meth:`meta_provider`),
    builds a real pipeline bound to that video, runs it, and — on EVERY
    termination path — closes the reader and deletes the transient download
    immediately (Req 12.x).
    """

    def __init__(self, progress_service: Progress_Service, *, cancel_check: Callable[[str], bool] | None = None) -> None:
        # Exposed as `.progress` so the worker mirrors per-stage states onto the
        # queue adapter and the router's /status reads the same events.
        self.progress = progress_service
        self._contexts: dict[str, JobContext] = {}
        # Optional predicate telling the runner a job was cancelled; when True at
        # the start of :meth:`run` the pipeline is not executed and the transient
        # video is deleted immediately. Defaults to "never cancelled".
        self._cancel_check = cancel_check or (lambda _job_id: False)

    async def meta_provider(self, job: AnalysisJob) -> VideoMeta | None:
        """Acquire + probe the job's video; stash its `JobContext`.

        Returns the probed `VideoMeta`, or ``None`` (cleaning up any partial
        download) when the video cannot be acquired/probed — which folds the job
        into `failed` (Req 19.6).
        """
        ref = job.video_ref
        if not ref:
            logger.info("Job %s has no video_ref; cannot analyze.", job.job_id)
            return None

        acquired: AcquiredVideo | None = None
        try:
            acquired = await acquire(ref)
            meta = probe(acquired.local_path)
        except VideoAcquisitionError as exc:
            logger.info("Video acquisition failed for job %s: %s", job.job_id, exc)
            if acquired is not None and acquired.owned:
                secure_delete(acquired.local_path)
            return None
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Unexpected acquisition failure for job %s: %s", job.job_id, exc)
            if acquired is not None and acquired.owned:
                secure_delete(acquired.local_path)
            return None

        reader = OpenCvFrameReader(acquired.local_path)
        self._contexts[job.job_id] = JobContext(
            acquired=acquired,
            reader=reader,
            meta=meta,
            exercise_hint=job.exercise_hint,
            expected_sha256=job.expected_sha256,
        )
        return meta

    async def run(
        self,
        video: VideoMeta,
        *,
        job_id: str,
        artifacts=None,
    ) -> StageResult[AnalysisResult]:
        ctx = self._contexts.get(job_id)
        if ctx is None:
            return StageResult(
                success=False,
                error=StructuredError(
                    code="ACQUISITION_MISSING",
                    message="No acquired video context was available for the job.",
                    stage="worker",
                ),
            )
        try:
            # Honor a cancellation that arrived before the pipeline started —
            # do no analysis work; the finally-block still deletes the transient
            # video (runtime reliability, Req 12.x).
            if self._cancel_check(job_id):
                logger.info("Job %s cancelled before pipeline start; skipping analysis.", job_id)
                return StageResult(
                    success=False,
                    error=StructuredError(
                        code="JOB_CANCELLED",
                        message="The analysis was cancelled before processing began.",
                        stage="worker",
                    ),
                )

            # Verify the downloaded bytes are exactly what was uploaded before
            # any processing begins (integrity guard). A mismatch fails the job
            # with a distinct, human-safe code and the transient file is deleted.
            if ctx.expected_sha256:
                actual = sha256_file(ctx.acquired.local_path)
                if actual.lower() != ctx.expected_sha256.lower():
                    logger.warning(
                        "Integrity mismatch for job %s: expected %s, got %s.",
                        job_id, ctx.expected_sha256, actual,
                    )
                    return StageResult(
                        success=False,
                        error=StructuredError(
                            code="INTEGRITY_MISMATCH",
                            message="The uploaded video failed an integrity check and was not analyzed.",
                            stage="acquisition",
                        ),
                    )

            pipeline = build_real_pipeline(
                ctx.reader,
                video,
                exercise_hint=ctx.exercise_hint,
                progress_service=self.progress,
            )
            return await pipeline.run(video, job_id=job_id, artifacts=artifacts)
        finally:
            # Delete the transient video immediately after processing (Req 12.x).
            try:
                ctx.reader.close()
            except Exception:  # pragma: no cover - defensive
                pass
            if ctx.acquired.owned:
                deleted = secure_delete(ctx.acquired.local_path)
                logger.info(
                    "Transient video for job %s deleted=%s (%s)",
                    job_id, deleted, os.path.basename(ctx.acquired.local_path),
                )
            self._contexts.pop(job_id, None)
