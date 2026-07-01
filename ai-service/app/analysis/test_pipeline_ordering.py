"""
Property-based tests for the Analysis_Pipeline orchestrator
(app/analysis/pipeline.py).

Covers design Property 21 — "Pipeline executes stages in canonical order,
stopping on error" — using Hypothesis with a minimum of 100 iterations.

The pipeline is driven end-to-end with stub stages injected through the
constructor's per-stage override kwargs. Each stub records its own invocation
into a shared order list and returns a valid typed StageResult, and Hypothesis
chooses which stage (if any) fails. We then assert:

  • executed analytical stages are exactly the canonical-order prefix up to and
    including the failing stage (or the full sequence on a clean run);
  • no stage after the failing one runs;
  • the Cleanup_Service ALWAYS runs (success or failure);
  • on failure the returned StageResult.success is False and carries the
    failing stage's Structured_Error;
  • on a clean run every stage runs and success is True.

Validates: Requirements 3.1, 8.3, 10.1, 18.1, 18.3, 19.2, 21.3, 22.1, 25.1, 25.4
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.adapters.progress import Progress_Service
from app.analysis.base import StageResult, StructuredError
from app.analysis.contracts import (
    AnalysisResult,
    CameraGuidance,
    CleanupReport,
    Detection,
    Frame,
    FrameLandmarks,
    FrameQuality,
    FrameSet,
    KeyFrames,
    Landmark,
    Landmarks,
    MovementPhases,
    MovementTimeline,
    ObjectiveMetrics,
    OverallConfidence,
    QualityScoredFrame,
    QualityScoredFrames,
    RepetitionSummary,
    ReasoningOutput,
    TimelineEntry,
    VideoMeta,
)
from app.analysis.pipeline import Analysis_Pipeline


# ── Canonical analytical-stage order (Req 18.1) ───────────────────────────
# The exact sequence the orchestrator executes, matching the design Property 21
# order: validation → frame extraction → frame quality → key frame selection →
# camera guidance → exercise detection → pose extraction → pose confidence →
# landmark validation → smoothing → movement timeline → phases → reps →
# biomechanics → reasoning → fusion → feedback. Cleanup runs after, always.
CANONICAL_STAGES: list[str] = [
    "video_validation",
    "frame_extraction",
    "frame_quality",
    "key_frame_selection",
    "camera_guidance",
    "exercise_detection",
    "pose_extraction",
    "pose_confidence",
    "landmark_validation",
    "smoothing",
    "movement_timeline",
    "movement_phase",
    "rep_counting",
    "biomechanics",
    "reasoning",
    "confidence_fusion",
    "feedback",
]

CLEANUP_STAGE = "cleanup"
STUB_FAIL_CODE = "STUB_FAIL"


# ── Valid, typed per-stage outputs ─────────────────────────────────────────
# Each stub stage returns the contract object its real counterpart would, so
# the orchestrator's between-stage attribute access (e.g. building the
# ConfidenceSources, ReasoningInput, FeedbackInput) never trips on a stub.

_VIDEO = VideoMeta(
    container_format="mp4",
    codec="h264",
    duration_sec=10.0,
    width=1080,
    height=1920,
    fps=30.0,
    size_bytes=1_000_000,
    orientation="portrait",
)

_FRAME = Frame(index=0, timestamp_ms=0.0)
_FRAME_SET = FrameSet(frames=[_FRAME], source_meta=_VIDEO)

_QUALITY = FrameQuality(
    blur=0.9,
    brightness=0.9,
    contrast=0.9,
    motion_blur=0.9,
    camera_shake=0.9,
    body_visibility=0.9,
    occlusion=0.9,
)
_SCORED_FRAMES = QualityScoredFrames(
    frames=[QualityScoredFrame(frame=_FRAME, quality=_QUALITY, retained=True)],
    source_meta=_VIDEO,
)

_KEY_FRAMES = KeyFrames(frames=[_FRAME], source_meta=_VIDEO)
_CAMERA_GUIDANCE = CameraGuidance(suitable=True, issues=[])
_DETECTION = Detection(exercise_id="squat", confidence=0.9, alternatives=[])

_LANDMARKS = Landmarks(
    frames=[
        FrameLandmarks(
            timestamp_ms=0.0,
            landmarks=[Landmark(x=0.5, y=0.5, z=0.0, confidence=0.9)],
            overall_confidence=0.9,
        )
    ],
    source_meta=_VIDEO,
    pose_engine="stub",
)

_TIMELINE = MovementTimeline(
    entries=[
        TimelineEntry(
            timestamp_ms=0.0,
            joint_positions={},
            joint_angles={},
            joint_velocity={},
            joint_acceleration={},
            movement_direction={},
        )
    ]
)

_PHASES = MovementPhases(phases=[])
_REPS = RepetitionSummary(
    rep_count=1,
    phase_timestamps=[],
    avg_rep_duration_ms=1000.0,
    movement_consistency=0.9,
)
_METRICS = ObjectiveMetrics(
    joint_angles={"knee": 90.0},
    bar_path=[[0.5, 0.5]],
    depth=0.5,
    range_of_motion={"knee": 120.0},
    tempo=1.0,
    symmetry=0.9,
    center_of_mass=[0.5, 0.5],
    balance=0.9,
    confidence=0.9,
)
_REASONING = ReasoningOutput(confidence=0.9)
_OVERALL = OverallConfidence(overall=0.9)
_CLEANUP_REPORT = CleanupReport(job_id="job", deleted=[], failed=[], complete=True)

_ANALYSIS_RESULT = AnalysisResult(
    exercise_id="squat",
    analysis_date="2024-01-01T00:00:00+00:00",
    overall_score=80.0,
    movement_score=90.0,
    range_of_motion={"knee": 120.0},
    tempo=1.0,
    stability=0.9,
    symmetry=0.9,
    joint_alignment={"knee": 90.0},
    strengths=[],
    mistakes=[],
    corrections=[],
    safety_warnings=[],
    improvement_tips=[],
    training_advice=[],
    movement_metrics=_METRICS,
    repetition_summary=_REPS,
    overall_confidence=0.9,
    low_confidence=False,
    analysisVersion="1.0.0",
    poseEngineVersion="stub",
    visionModelVersion="stub",
    reasoningModelVersion="stub",
    pipelineVersion="1.0.0",
)

#: The valid output each named stage produces on success.
_STAGE_OUTPUTS = {
    "video_validation": _VIDEO,
    "frame_extraction": _FRAME_SET,
    "frame_quality": _SCORED_FRAMES,
    "key_frame_selection": _KEY_FRAMES,
    "camera_guidance": _CAMERA_GUIDANCE,
    "exercise_detection": _DETECTION,
    "pose_extraction": _LANDMARKS,
    "pose_confidence": _LANDMARKS,
    "landmark_validation": _LANDMARKS,
    "smoothing": _LANDMARKS,
    "movement_timeline": _TIMELINE,
    "movement_phase": _PHASES,
    "rep_counting": _REPS,
    "biomechanics": _METRICS,
    "reasoning": _REASONING,
    "confidence_fusion": _OVERALL,
    "feedback": _ANALYSIS_RESULT,
    "cleanup": _CLEANUP_REPORT,
}


class _StubStage:
    """A recording stub for a single pipeline stage.

    On ``run`` it appends its own name to a shared order list (proving it
    executed and in what order), then returns either its canned successful
    output or a Structured_Error attributed to itself.
    """

    def __init__(self, name: str, order: list[str], *, fail: bool) -> None:
        self.name = name
        self._order = order
        self._fail = fail

    async def run(self, data):  # noqa: ANN001 - stub accepts any stage input
        self._order.append(self.name)
        if self._fail:
            return StageResult(
                success=False,
                error=StructuredError(
                    code=STUB_FAIL_CODE,
                    message="stub-induced failure",
                    stage=self.name,
                ),
            )
        return StageResult(success=True, output=_STAGE_OUTPUTS[self.name])


def _build_pipeline(order: list[str], fail_stage: str | None) -> Analysis_Pipeline:
    """Wire an Analysis_Pipeline whose every stage is a recording stub.

    ``fail_stage`` (when not None) is the single stage configured to return a
    failed StageResult; every other stage succeeds. Cleanup is also stubbed so
    its (always-run) invocation is recorded in ``order``.
    """
    stage_overrides = {
        name: _StubStage(name, order, fail=(name == fail_stage))
        for name in CANONICAL_STAGES
    }
    cleanup_stub = _StubStage(CLEANUP_STAGE, order, fail=False)

    # The four injectable seams are unused because every stage is overridden;
    # pass inert sentinels to satisfy the required constructor signature.
    return Analysis_Pipeline(
        pixel_source=object(),
        camera_signal_source=object(),
        classifier=object(),
        reasoner=object(),
        progress_service=Progress_Service(active_transport="poll"),
        cleanup=cleanup_stub,
        **stage_overrides,
    )


# ── Property 21 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 21: Pipeline executes stages in
# canonical order, stopping on error.
@given(fail_stage=st.one_of(st.none(), st.sampled_from(CANONICAL_STAGES)))
@settings(max_examples=100)
def test_pipeline_executes_in_canonical_order_halting_on_error(
    fail_stage: str | None,
):
    order: list[str] = []
    pipeline = _build_pipeline(order, fail_stage)

    result = asyncio.run(pipeline.run(_VIDEO, job_id="job"))

    if fail_stage is None:
        # Clean run: every analytical stage executes in canonical order, then
        # cleanup, and the run succeeds carrying the result (Req 18.1, 18.2).
        assert order == CANONICAL_STAGES + [CLEANUP_STAGE]
        assert result.success is True
        assert result.error is None
        assert result.output is not None
    else:
        # On failure the executed analytical stages are EXACTLY the canonical
        # prefix up to and including the failing stage (Req 18.3) — nothing
        # after it runs — and cleanup still runs afterwards (Req 12.3, 31.1).
        cutoff = CANONICAL_STAGES.index(fail_stage) + 1
        expected = CANONICAL_STAGES[:cutoff] + [CLEANUP_STAGE]
        assert order == expected

        # No analytical stage after the failing one executed.
        for later in CANONICAL_STAGES[cutoff:]:
            assert later not in order

        # The failure is surfaced as a failed StageResult carrying the failing
        # stage's Structured_Error (Req 18.3, 19.2).
        assert result.success is False
        assert result.output is None
        assert result.error is not None
        assert result.error.code == STUB_FAIL_CODE
        assert result.error.stage == fail_stage

    # Cleanup ALWAYS runs, on every termination path (Req 12.3, 31.1).
    assert CLEANUP_STAGE in order
    assert order[-1] == CLEANUP_STAGE
    # And exactly once.
    assert order.count(CLEANUP_STAGE) == 1
