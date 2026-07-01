"""
Unit tests for the Background_Worker (app/analysis/worker.py).

Drive one Analysis_Job end-to-end through an in-memory Job_Queue_Adapter with a
stubbed Analysis_Pipeline, asserting the worker:
  • runs the pipeline outside the request cycle (Req 19.2),
  • mirrors each stage's Job_State onto the adapter (Req 19.4),
  • terminates in `completed` carrying the Analysis_Result (Req 19.5),
  • terminates in `failed` carrying the Structured_Error (Req 19.6),
  • exposes the terminal state/result/error via a Job_Id query (Req 19.8),
  • never raises on a domain failure.
"""

import asyncio

from app.analysis.adapters.job_queue import BullMQJobQueueAdapter
from app.analysis.adapters.progress import Progress_Service
from app.analysis.base import StageResult, StructuredError
from app.analysis.contracts import (
    AnalysisResult,
    ObjectiveMetrics,
    RepetitionSummary,
    VideoMeta,
)
from app.analysis.jobs import AnalysisJob, JobState
from app.analysis.worker import (
    WORKER_NO_INPUT_ERROR,
    Background_Worker,
)


# ── Fixtures / builders ──────────────────────────────────────────────────

def _video() -> VideoMeta:
    return VideoMeta(
        container_format="mp4",
        codec="h264",
        duration_sec=5.0,
        width=720,
        height=1280,
        fps=30.0,
        size_bytes=1024,
        orientation="portrait",
    )


def _result() -> AnalysisResult:
    metrics = ObjectiveMetrics(
        joint_angles={},
        bar_path=[],
        depth=0.0,
        range_of_motion={},
        tempo=1.0,
        symmetry=0.9,
        center_of_mass=[0.5, 0.5],
        balance=0.8,
        confidence=0.9,
    )
    reps = RepetitionSummary(
        rep_count=3,
        phase_timestamps=[],
        avg_rep_duration_ms=1200.0,
        movement_consistency=0.85,
    )
    return AnalysisResult(
        exercise_id="squat",
        analysis_date="2024-01-01T00:00:00Z",
        overall_score=0.88,
        movement_score=0.9,
        range_of_motion={},
        tempo=1.0,
        stability=0.8,
        symmetry=0.9,
        joint_alignment={},
        strengths=["depth"],
        mistakes=[],
        corrections=[],
        safety_warnings=[],
        improvement_tips=[],
        training_advice=[],
        movement_metrics=metrics,
        repetition_summary=reps,
        overall_confidence=0.87,
        low_confidence=False,
        analysisVersion="1.0.0",
        poseEngineVersion="mediapipe-1",
        visionModelVersion="qwen-vl-1",
        reasoningModelVersion="llm-1",
        pipelineVersion="1.0.0",
    )


class _StubPipeline:
    """Minimal Analysis_Pipeline seam that emits progress then returns a result.

    Carries a real Progress_Service so the worker's per-stage state mirroring
    can be exercised, and replays a fixed sequence of stage states before
    returning the configured StageResult.
    """

    def __init__(self, outcome: StageResult, states: list[JobState] | None = None):
        self.progress = Progress_Service(active_transport="poll")
        self._outcome = outcome
        self._states = states or [
            JobState.validating,
            JobState.extracting_frames,
            JobState.building_timeline,
        ]
        self.seen_video: VideoMeta | None = None
        self.seen_job_id: str | None = None

    async def run(self, video, *, job_id, artifacts=None):
        self.seen_video = video
        self.seen_job_id = job_id
        for state in self._states:
            await self.progress.publish(job_id, state)
        return self._outcome


async def _enqueue(adapter: BullMQJobQueueAdapter) -> str:
    return await adapter.enqueue(AnalysisJob(job_id="", user_id="u1"))


# ── Tests ────────────────────────────────────────────────────────────────

def test_successful_run_completes_with_result():
    """A successful pipeline run terminates the job in completed (Req 19.5, 19.8)."""

    async def scenario():
        adapter = BullMQJobQueueAdapter()
        job_id = await _enqueue(adapter)
        result = _result()
        pipeline = _StubPipeline(StageResult[AnalysisResult](success=True, output=result))
        meta = _video()

        worker = Background_Worker(
            adapter, pipeline, meta_provider=lambda job: _async(meta)
        )
        job = await worker.process_job(job_id)

        assert pipeline.seen_video == meta          # ran outside request cycle (Req 19.2)
        assert pipeline.seen_job_id == job_id
        assert job is not None
        assert job.state == JobState.completed       # Req 19.5
        assert job.result == result                  # Req 19.8
        assert job.error is None

    asyncio.run(scenario())


def test_failed_run_records_structured_error():
    """A pipeline failure terminates the job in failed with the error (Req 19.6)."""

    async def scenario():
        adapter = BullMQJobQueueAdapter()
        job_id = await _enqueue(adapter)
        error = StructuredError(code="LOW_CONFIDENCE", message="bad", stage="pose")
        pipeline = _StubPipeline(StageResult[AnalysisResult](success=False, error=error))

        worker = Background_Worker(
            adapter, pipeline, meta_provider=lambda job: _async(_video())
        )
        job = await worker.process_job(job_id)

        assert job is not None
        assert job.state == JobState.failed          # Req 19.6
        assert job.error == error
        assert job.result is None

    asyncio.run(scenario())


def test_per_stage_states_are_mirrored_onto_adapter():
    """Each non-terminal stage state is set on the adapter as the job advances (Req 19.4)."""

    async def scenario():
        adapter = BullMQJobQueueAdapter()
        job_id = await _enqueue(adapter)

        seen: list[JobState] = []
        original_set_state = adapter.set_state

        async def recording_set_state(jid, state):
            seen.append(state)
            await original_set_state(jid, state)

        adapter.set_state = recording_set_state  # type: ignore[assignment]

        states = [JobState.validating, JobState.extracting_pose, JobState.biomechanics]
        pipeline = _StubPipeline(
            StageResult[AnalysisResult](success=True, output=_result()),
            states=states,
        )
        worker = Background_Worker(
            adapter, pipeline, meta_provider=lambda job: _async(_video())
        )
        await worker.process_job(job_id)

        assert seen == states                        # mirrored in order (Req 19.4)

    asyncio.run(scenario())


def test_missing_video_meta_fails_cleanly():
    """A job with no analyzable input fails without raising (Req 19.6)."""

    async def scenario():
        adapter = BullMQJobQueueAdapter()
        job_id = await _enqueue(adapter)
        pipeline = _StubPipeline(StageResult[AnalysisResult](success=True, output=_result()))

        worker = Background_Worker(
            adapter, pipeline, meta_provider=lambda job: _async(None)
        )
        job = await worker.process_job(job_id)

        assert job is not None
        assert job.state == JobState.failed
        assert job.error is not None
        assert job.error.code == WORKER_NO_INPUT_ERROR
        assert pipeline.seen_video is None            # pipeline never ran

    asyncio.run(scenario())


def test_unknown_job_id_returns_none():
    """Consuming an unknown Job_Id is a no-op returning None."""

    async def scenario():
        adapter = BullMQJobQueueAdapter()
        pipeline = _StubPipeline(StageResult[AnalysisResult](success=True, output=_result()))
        worker = Background_Worker(
            adapter, pipeline, meta_provider=lambda job: _async(_video())
        )
        assert await worker.process_job("does-not-exist") is None

    asyncio.run(scenario())


def test_pipeline_exception_is_folded_into_failed_job():
    """An unexpected exception is folded into a failed job, never propagated."""

    class _RaisingPipeline:
        progress = None

        async def run(self, video, *, job_id, artifacts=None):
            raise RuntimeError("boom")

    async def scenario():
        adapter = BullMQJobQueueAdapter()
        job_id = await _enqueue(adapter)
        worker = Background_Worker(
            adapter, _RaisingPipeline(), meta_provider=lambda job: _async(_video())
        )
        job = await worker.process_job(job_id)

        assert job is not None
        assert job.state == JobState.failed

    asyncio.run(scenario())


def _async(value):
    """Wrap a plain value in an awaitable for use as a meta_provider stub."""

    async def _coro():
        return value

    return _coro()
