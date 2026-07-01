"""
Analysis_Pipeline — orchestrator (Req 16.1, 16.2, 18.1, 18.2, 18.3, 31.1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Executes every analytical `Pipeline_Stage` in the canonical order defined by
Requirement 18.1 — with the Stage 19–30 additions woven in additively per the
design.md "Pipeline Stage Sequence":

    validation
      → frame extraction
      → frame quality
      → key frame selection
      → camera guidance            (before pose, Req 22.1)
      → exercise detection
      → pose extraction
      → pose confidence validation (Req 21.x)
      → landmark validation        (Req 26.x)
      → smoothing                  (Req 25.x)
      → movement timeline
      → movement phases            (Req 24.x, reuses the timeline)
      → rep counting               (Req 23.x, reuses the timeline)
      → biomechanics
      → reasoning
      → confidence fusion          (Req 27.x)
      → feedback
      → cleanup                    (always, via try/finally — Req 12.3)

Behavior contract
-----------------
  • Progress (Req 18.x, 20.1): the orchestrator emits a `Progress_Event` to the
    `Progress_Service` at the start AND finish of each stage, mapping every
    stage to its corresponding `Job_State`. Woven-in stages that have no
    dedicated `Job_State` (camera guidance, confidence/landmark validation,
    smoothing, phases, reps, fusion) report progress under the surrounding
    canonical state, so the externally observable state set stays exactly the
    one enumerated in Req 19.3.

  • Error halting (Req 18.3): on ANY `StageResult(success=False)` the pipeline
    stops every subsequent analytical stage, still runs the `Cleanup_Service`
    (via `try/finally`), and surfaces the originating `Structured_Error`. The
    sanitized `{code, message}` payload (Req 15.6) is produced with
    `sanitize_error` for the boundary/log; the full `Structured_Error` is kept
    on the returned `StageResult` so the `Background_Worker` can associate it
    with the `Analysis_Job` (Req 19.6).

  • Reuse (Req 16.2): intermediate outputs are passed forward and reused, never
    recomputed — the extracted `FrameSet` feeds both quality scoring and camera
    guidance, and the single `Movement_Timeline` feeds phases, reps, and
    biomechanics.

  • Privacy (Req 1.3, 1.4, 31.1): only frames / derived data cross to engines —
    pose extraction receives `KeyFrames` (index + timestamp only) and reasoning
    receives only the `Movement_Timeline` + `Objective_Metrics`. The
    `Cleanup_Service` removes every tracked artifact on every termination path
    so nothing of the recording lingers.

Testability
-----------
Stages that need injected seams — the frame pixel source, camera signal source,
exercise classifier, and reasoner — are supplied through the constructor, so
the whole pipeline can be driven end-to-end with stubs. Every constructed stage
is also exposed as a public attribute and may be overridden via constructor
kwargs for fine-grained testing.

Like the stages it drives, this orchestrator never raises on a domain failure;
it returns a `StageResult[AnalysisResult]` (and, via `run_job`, an
`AnalysisJob` terminating in `completed` or `failed`).
"""

from __future__ import annotations

import logging

from app.core.config import Settings, settings

from .adapters.progress import Progress_Service
from .base import StageResult, StructuredError
from .contracts import (
    AnalysisResult,
    CameraGuidance,
    CleanupReport,
    ConfidenceSources,
    Detection,
    FrameSet,
    KeyFrames,
    Landmarks,
    MovementPhases,
    MovementTimeline,
    ObjectiveMetrics,
    QualityScoredFrames,
    RepetitionSummary,
    VideoMeta,
)
from .errors import SanitizedError, sanitize_error
from .jobs import AnalysisJob, JobState
from .stages.biomechanics import BiomechanicsService
from .stages.camera_guidance import CameraGuidanceService, CameraSignalSource
from .stages.cleanup import ArtifactRegistry, ArtifactStore, CleanupService
from .stages.confidence_fusion import ConfidenceFusionService
from .stages.exercise_detection import ExerciseClassifier, ExerciseDetectionService
from .stages.feedback import FeedbackInput, FeedbackService
from .stages.frame_extraction import FrameDecoder, FrameExtractionService
from .stages.frame_quality import FramePixelSource, FrameQualityService
from .stages.key_frame_selector import KeyFrameSelector
from .stages.landmark_validation import LandmarkValidationService
from .stages.movement_phase import MovementPhaseService
from .stages.movement_timeline import MovementTimelineService
from .stages.pose_confidence_validator import PoseConfidenceValidator
from .stages.pose_extraction import PoseExtractionService
from .stages.reasoning import Reasoner, ReasoningInput, ReasoningService
from .stages.rep_counting import RepCountingService
from .stages.smoothing_adapter import SmoothingAdapter
from .stages.video_validation import VideoValidationService

logger = logging.getLogger("getfit-ai")

#: Stable code used for the (defensive) unexpected-failure guard. Stages never
#: raise on domain failures, so this only fires if the orchestrator itself hits
#: an unexpected exception — it is surfaced like any other Structured_Error.
PIPELINE_ERROR: str = "PIPELINE_ERROR"

#: Coarse completion percentage published alongside each canonical Job_State so
#: a polling client sees monotonically advancing progress. Woven-in stages
#: reuse the percentage of the canonical state they belong to.
STATE_PERCENT: dict[JobState, float] = {
    JobState.queued: 0.0,
    JobState.validating: 5.0,
    JobState.extracting_frames: 15.0,
    JobState.frame_quality: 25.0,
    JobState.selecting_keyframes: 35.0,
    JobState.detecting_exercise: 45.0,
    JobState.extracting_pose: 55.0,
    JobState.building_timeline: 70.0,
    JobState.biomechanics: 80.0,
    JobState.reasoning: 88.0,
    JobState.generating_feedback: 94.0,
    JobState.cleaning_up: 98.0,
    JobState.completed: 100.0,
}


def _clamp01(value: float) -> float:
    """Clamp a value into the closed interval [0.0, 1.0]."""
    return max(0.0, min(1.0, value))


class Analysis_Pipeline:
    """Orchestrates every analytical stage end-to-end (Req 18.1).

    Construct with the four injectable seams the stages require, then call
    :meth:`run` (returns a ``StageResult[AnalysisResult]``) or :meth:`run_job`
    (returns a terminal :class:`AnalysisJob`).
    """

    def __init__(
        self,
        *,
        pixel_source: FramePixelSource,
        camera_signal_source: CameraSignalSource,
        classifier: ExerciseClassifier,
        reasoner: Reasoner,
        config: Settings | None = None,
        progress_service: Progress_Service | None = None,
        frame_decoder: FrameDecoder | None = None,
        artifact_store: ArtifactStore | None = None,
        # Optional fully-built stage overrides (testing / custom wiring). When
        # omitted each stage is constructed from the seams + configuration.
        video_validation: VideoValidationService | None = None,
        frame_extraction: FrameExtractionService | None = None,
        frame_quality: FrameQualityService | None = None,
        key_frame_selection: KeyFrameSelector | None = None,
        camera_guidance: CameraGuidanceService | None = None,
        exercise_detection: ExerciseDetectionService | None = None,
        pose_extraction: PoseExtractionService | None = None,
        pose_confidence: PoseConfidenceValidator | None = None,
        landmark_validation: LandmarkValidationService | None = None,
        smoothing: SmoothingAdapter | None = None,
        movement_timeline: MovementTimelineService | None = None,
        movement_phase: MovementPhaseService | None = None,
        rep_counting: RepCountingService | None = None,
        biomechanics: BiomechanicsService | None = None,
        reasoning: ReasoningService | None = None,
        confidence_fusion: ConfidenceFusionService | None = None,
        feedback: FeedbackService | None = None,
        cleanup: CleanupService | None = None,
    ) -> None:
        self._cfg = config or settings
        self.progress = progress_service or Progress_Service(config=self._cfg)

        # ── Analytical stages (canonical order) ──
        self.video_validation = video_validation or VideoValidationService(self._cfg)
        self.frame_extraction = frame_extraction or FrameExtractionService(frame_decoder)
        self.frame_quality = frame_quality or FrameQualityService(pixel_source)
        self.key_frame_selection = key_frame_selection or KeyFrameSelector()
        self.camera_guidance = camera_guidance or CameraGuidanceService(camera_signal_source)
        self.exercise_detection = exercise_detection or ExerciseDetectionService(classifier)
        self.pose_extraction = pose_extraction or PoseExtractionService(self._cfg)
        self.pose_confidence = pose_confidence or PoseConfidenceValidator()
        self.landmark_validation = landmark_validation or LandmarkValidationService(self._cfg)
        self.smoothing = smoothing or SmoothingAdapter(self._cfg)
        self.movement_timeline = movement_timeline or MovementTimelineService()
        self.movement_phase = movement_phase or MovementPhaseService()
        self.rep_counting = rep_counting or RepCountingService()
        self.biomechanics = biomechanics or BiomechanicsService()
        self.reasoning = reasoning or ReasoningService(reasoner)
        self.confidence_fusion = confidence_fusion or ConfidenceFusionService()
        self.feedback = feedback or FeedbackService()
        self.cleanup = cleanup or CleanupService(artifact_store)

        # The sanitized form of the most recent failure, surfaced across the
        # stage boundary (Req 15.6). None on a clean run.
        self.last_error: SanitizedError | None = None
        # Retained outputs of the additive woven-in stages, populated as a run
        # proceeds so callers can surface them alongside the result/progress.
        self.last_camera_guidance: CameraGuidance | None = None
        self.last_movement_phases: MovementPhases | None = None
        self.last_cleanup_report: CleanupReport | None = None

    # ── Public entrypoints ────────────────────────────────────────────────

    async def run(
        self,
        video: VideoMeta,
        *,
        job_id: str,
        artifacts: ArtifactRegistry | None = None,
    ) -> StageResult[AnalysisResult]:
        """Execute the full pipeline for one probed video (Req 18.1, 18.2, 18.3).

        Returns a successful ``StageResult`` carrying the bounded
        ``AnalysisResult`` (Req 18.2), or a failed ``StageResult`` carrying the
        originating ``Structured_Error`` (Req 18.3). The ``Cleanup_Service``
        runs on either path (Req 12.3, 31.1).

        Args:
            video: the validated/probed input metadata (the first stage input).
            job_id: identifier the emitted ``Progress_Event``s are keyed by.
            artifacts: optional pre-seeded artifact registry (e.g. already
                holding the original video path / working dir). When omitted a
                fresh registry is created for the job.
        """
        from .contracts import AnalysisResult  # local import avoids cycle noise

        registry = artifacts or ArtifactRegistry(job_id)
        self.last_error = None

        outcome: StageResult[AnalysisResult]
        try:
            outcome = await self._execute(video, job_id, registry)
        except Exception as exc:  # pragma: no cover - defensive; stages never raise
            logger.exception("Analysis_Pipeline crashed for job %s", job_id)
            outcome = StageResult(
                success=False,
                error=StructuredError(
                    code=PIPELINE_ERROR,
                    message="The analysis pipeline failed unexpectedly.",
                    stage="pipeline",
                ),
            )
        finally:
            # Cleanup is guaranteed on every termination path (Req 12.3, 31.1).
            await self._run_cleanup(registry, job_id)

        if outcome.success:
            # Terminal success state (Req 20.5). Published after cleanup so the
            # observable order is ...cleaning_up → completed.
            await self.progress.publish(job_id, JobState.completed, STATE_PERCENT[JobState.completed])
        elif outcome.error is not None:
            # Surface the sanitized {code, message} across the boundary (Req 15.6).
            self.last_error = sanitize_error(outcome.error)
            logger.info(
                "Analysis_Pipeline job %s failed: %s", job_id, self.last_error
            )

        return outcome

    async def run_job(
        self,
        video: VideoMeta,
        *,
        job_id: str,
        user_id: str = "",
        artifacts: ArtifactRegistry | None = None,
    ) -> AnalysisJob:
        """Run the pipeline and fold the outcome into a terminal ``AnalysisJob``.

        Mirrors what the ``Background_Worker`` records (Req 19.5, 19.6): a
        ``completed`` job carrying the ``Analysis_Result`` on success, or a
        ``failed`` job carrying the ``Structured_Error`` on failure.
        """
        result = await self.run(video, job_id=job_id, artifacts=artifacts)
        if result.success:
            return AnalysisJob(
                job_id=job_id,
                user_id=user_id,
                state=JobState.completed,
                result=result.output,
            )
        return AnalysisJob(
            job_id=job_id,
            user_id=user_id,
            state=JobState.failed,
            error=result.error,
        )

    # ── Core orchestration ────────────────────────────────────────────────

    async def _execute(
        self,
        video: VideoMeta,
        job_id: str,
        registry: ArtifactRegistry,
    ) -> StageResult[AnalysisResult]:
        """Run the analytical stages in canonical order, halting on first error."""

        async def stage(state: JobState, runner, data):
            """Emit start/finish progress around a single stage; halt on failure.

            Returns the stage's ``StageResult``. The caller inspects
            ``.success`` and short-circuits the pipeline when it is False
            (Req 18.3).
            """
            percent = STATE_PERCENT[state]
            await self.progress.publish(job_id, state, percent)  # start (Req 20.1)
            result = await runner.run(data)
            if result.success:
                await self.progress.publish(job_id, state, percent)  # finish (Req 20.1)
            return result

        # 1. Validation (Req 18.1) ─────────────────────────────────────────
        validated = await stage(JobState.validating, self.video_validation, video)
        if not validated.success:
            return self._halt(validated)
        meta: VideoMeta = validated.output

        # 2. Frame extraction ──────────────────────────────────────────────
        extracted = await stage(JobState.extracting_frames, self.frame_extraction, meta)
        if not extracted.success:
            return self._halt(extracted)
        frame_set: FrameSet = extracted.output

        # 3. Frame quality ─────────────────────────────────────────────────
        quality = await stage(JobState.frame_quality, self.frame_quality, frame_set)
        if not quality.success:
            return self._halt(quality)
        scored: QualityScoredFrames = quality.output

        # 4. Key frame selection ───────────────────────────────────────────
        selected = await stage(JobState.selecting_keyframes, self.key_frame_selection, scored)
        if not selected.success:
            return self._halt(selected)
        key_frames: KeyFrames = selected.output

        # Camera guidance — runs before pose extraction (Req 22.1), reusing the
        # extracted FrameSet (Req 16.2). It is additive and informational: it
        # never returns a Structured_Error, so it cannot halt the pipeline; its
        # guidance is retained for surfacing alongside the result/progress.
        guidance = await stage(JobState.selecting_keyframes, self.camera_guidance, frame_set)
        if not guidance.success:
            return self._halt(guidance)
        self.last_camera_guidance = guidance.output

        # 5. Exercise detection ────────────────────────────────────────────
        detected = await stage(JobState.detecting_exercise, self.exercise_detection, key_frames)
        if not detected.success:
            return self._halt(detected)
        detection: Detection = detected.output

        # 6. Pose extraction ───────────────────────────────────────────────
        posed = await stage(JobState.extracting_pose, self.pose_extraction, key_frames)
        if not posed.success:
            return self._halt(posed)
        landmarks: Landmarks = posed.output

        # Pose confidence validation → landmark validation → smoothing.
        # All three are additive Landmarks→Landmarks stages woven between pose
        # extraction and the timeline; each can halt with a Structured_Error
        # (e.g. LOW_CONFIDENCE, INVALID_POSE). They report under extracting_pose.
        confidence_checked = await stage(JobState.extracting_pose, self.pose_confidence, landmarks)
        if not confidence_checked.success:
            return self._halt(confidence_checked)
        landmarks = confidence_checked.output

        validated_landmarks = await stage(JobState.extracting_pose, self.landmark_validation, landmarks)
        if not validated_landmarks.success:
            return self._halt(validated_landmarks)
        landmarks = validated_landmarks.output

        smoothed = await stage(JobState.extracting_pose, self.smoothing, landmarks)
        if not smoothed.success:
            return self._halt(smoothed)
        landmarks = smoothed.output

        # 7. Movement timeline ─────────────────────────────────────────────
        timeline_result = await stage(JobState.building_timeline, self.movement_timeline, landmarks)
        if not timeline_result.success:
            return self._halt(timeline_result)
        timeline: MovementTimeline = timeline_result.output

        # Movement phases + rep counting both reuse the single timeline (Req
        # 16.2) and report under building_timeline.
        phases_result = await stage(JobState.building_timeline, self.movement_phase, timeline)
        if not phases_result.success:
            return self._halt(phases_result)
        self.last_movement_phases = phases_result.output

        reps_result = await stage(JobState.building_timeline, self.rep_counting, timeline)
        if not reps_result.success:
            return self._halt(reps_result)
        reps: RepetitionSummary = reps_result.output

        # 8. Biomechanics ──────────────────────────────────────────────────
        biomech_result = await stage(JobState.biomechanics, self.biomechanics, timeline)
        if not biomech_result.success:
            return self._halt(biomech_result)
        metrics: ObjectiveMetrics = biomech_result.output

        # 9. Reasoning — receives ONLY the timeline + metrics (Req 10.2, 10.3).
        reasoning_result = await stage(
            JobState.reasoning,
            self.reasoning,
            ReasoningInput(timeline=timeline, metrics=metrics),
        )
        if not reasoning_result.success:
            return self._halt(reasoning_result)
        reasoning_output = reasoning_result.output

        # Confidence fusion — combine the six per-source confidences into one
        # bounded overall score (Req 27.x), reusing already-computed outputs.
        sources = self._confidence_sources(scored, landmarks, detection, reps, metrics, reasoning_output)
        fusion_result = await stage(JobState.reasoning, self.confidence_fusion, sources)
        if not fusion_result.success:
            return self._halt(fusion_result)
        overall_confidence = fusion_result.output.overall

        # 10. Feedback — assemble the bounded AnalysisResult (Req 11.x). Every
        # field is a projection of metrics/timeline/reasoning produced upstream.
        feedback_result = await stage(
            JobState.generating_feedback,
            self.feedback,
            FeedbackInput(
                reasoning=reasoning_output,
                metrics=metrics,
                timeline=timeline,
                exercise_id=detection.exercise_id,
                repetition_summary=reps,
                overall_confidence=overall_confidence,
            ),
        )
        if not feedback_result.success:
            return self._halt(feedback_result)

        # Success (Req 18.2): the bounded AnalysisResult. Cleanup still runs in
        # the caller's finally before the terminal completed event is emitted.
        return feedback_result

    # ── Helpers ────────────────────────────────────────────────────────────

    def _halt(self, failed: StageResult) -> StageResult:
        """Halt analytical stages on a stage failure (Req 18.3).

        Returns the failed ``StageResult`` unchanged so its originating
        ``Structured_Error`` is preserved for job association (Req 19.6); the
        caller's ``finally`` guarantees cleanup runs (Req 12.3).
        """
        if failed.error is not None:
            logger.info("Pipeline halting at stage '%s' (%s)", failed.error.stage, failed.error.code)
        return failed

    async def _run_cleanup(self, registry: ArtifactRegistry, job_id: str) -> None:
        """Run the Cleanup_Service over every tracked artifact (Req 12.3, 31.1).

        Always invoked from :meth:`run`'s ``finally`` block. Publishes the
        ``cleaning_up`` progress state, then deletes the tracked artifact set.
        The cleanup report is retained on ``last_cleanup_report`` so the worker
        can record a cleanup failure (Req 30.1) without affecting the outcome.
        """
        await self.progress.publish(job_id, JobState.cleaning_up, STATE_PERCENT[JobState.cleaning_up])
        report = await self.cleanup.run(registry.as_artifact_set())
        self.last_cleanup_report = report.output

    def _confidence_sources(
        self,
        scored: QualityScoredFrames,
        landmarks: Landmarks,
        detection: Detection,
        reps: RepetitionSummary,
        metrics: ObjectiveMetrics,
        reasoning_output,
    ) -> ConfidenceSources:
        """Assemble the six bounded per-source confidences for fusion (Req 27.1).

        Each source is derived from an output already produced upstream (Req
        16.2): visual quality from the retained frames, pose reliability from
        the landmark overall-confidence, detection from the Detection score,
        movement quality from the rep consistency, and biomechanics/reasoning
        from their own self-reported confidences.
        """
        return ConfidenceSources(
            vision=self._vision_confidence(scored),
            pose=self._pose_confidence(landmarks),
            detection=_clamp01(detection.confidence),
            movement_quality=_clamp01(reps.movement_consistency),
            biomechanics=_clamp01(metrics.confidence),
            reasoning=_clamp01(reasoning_output.confidence),
        )

    @staticmethod
    def _vision_confidence(scored: QualityScoredFrames) -> float:
        """Mean visual-quality confidence across retained frames, in [0,1]."""
        retained = scored.retained
        if not retained:
            return 0.0
        total = 0.0
        for sf in retained:
            q = sf.quality
            total += (
                q.blur
                + q.brightness
                + q.contrast
                + q.motion_blur
                + q.camera_shake
                + q.body_visibility
                + q.occlusion
            ) / 7.0
        return _clamp01(total / len(retained))

    @staticmethod
    def _pose_confidence(landmarks: Landmarks) -> float:
        """Mean per-frame overall pose confidence, in [0,1]."""
        if not landmarks.frames:
            return 0.0
        return _clamp01(
            sum(fl.overall_confidence for fl in landmarks.frames) / len(landmarks.frames)
        )
