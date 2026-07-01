"""
Integration tests for the production-hardening runtime reliability behaviors.

Covers the additive reliability features layered onto the existing analysis
runtime without touching the AI pipeline itself:

  • Full job cancellation — a queued/in-flight job transitions to the terminal
    `cancelled` state; the worker never (or no longer) runs it and never
    overwrites the cancellation with completed/failed.
  • SHA-256 integrity verification — a downloaded recording whose digest does
    not match the digest computed at the upload boundary fails with a distinct,
    human-safe `INTEGRITY_MISMATCH` and is NOT analyzed.
  • Transient-file deletion — the acquisition seam deletes its transient copy
    with bounded retries and confirms removal (a recording never lingers).

These are deterministic and do not require the real pose engine or a real
video: the cancellation/integrity guards run before any pipeline stage.
"""

import asyncio
import hashlib
import os
import tempfile

from app.analysis import acquire as acquire_mod
from app.analysis.acquire import AcquiredVideo, OpenCvFrameReader, secure_delete, sha256_file
from app.analysis.adapters.job_queue import BullMQJobQueueAdapter
from app.analysis.adapters.progress import Progress_Service
from app.analysis.base import StageResult
from app.analysis.contracts import AnalysisResult, VideoMeta
from app.analysis.jobs import AnalysisJob, JobState
from app.analysis.real_pipeline import JobContext, RealPipelineRunner
from app.analysis.worker import Background_Worker


# ── Helpers ──────────────────────────────────────────────────────────────

def _async(value):
    async def _coro():
        return value
    return _coro()


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


def _make_temp_file(data: bytes = b"transient-video-bytes") -> str:
    fd, path = tempfile.mkstemp(suffix=".mp4", prefix="getfit_test_")
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    return path


# ── secure_delete: retry + confirmed removal ───────────────────────────────

def test_secure_delete_removes_file_and_confirms():
    path = _make_temp_file()
    assert os.path.isfile(path)
    assert secure_delete(path) is True
    assert not os.path.isfile(path)


def test_secure_delete_missing_file_is_success():
    # Deleting a path that does not exist is a no-op success (already gone).
    assert secure_delete(os.path.join(tempfile.gettempdir(), "no_such_getfit_file.mp4")) is True
    assert secure_delete("") is True


def test_secure_delete_retries_then_succeeds(monkeypatch):
    """A transient OSError on the first attempt is retried and then succeeds."""
    path = _make_temp_file()
    calls = {"n": 0}
    real_remove = os.remove

    def flaky_remove(p):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OSError("locked by another handle")
        return real_remove(p)

    monkeypatch.setattr(acquire_mod.os, "remove", flaky_remove)
    # Avoid slowing the test with the real backoff sleep.
    monkeypatch.setattr(acquire_mod.time, "sleep", lambda _s: None)

    assert secure_delete(path, retries=3) is True
    assert calls["n"] >= 2
    assert not os.path.isfile(path)


# ── sha256_file: correct digest ─────────────────────────────────────────────

def test_sha256_file_matches_hashlib():
    data = b"the-exact-uploaded-bytes-0123456789"
    path = _make_temp_file(data)
    try:
        expected = hashlib.sha256(data).hexdigest()
        assert sha256_file(path) == expected
    finally:
        secure_delete(path)


# ── Cancellation: worker preserves the cancelled state ──────────────────────

def test_worker_skips_job_cancelled_before_start():
    """A job flagged cancelled before start is not run and is not overwritten."""

    async def scenario():
        adapter = BullMQJobQueueAdapter()
        job_id = await adapter.enqueue(AnalysisJob(job_id="", user_id="u1"))
        # Simulate cancel_job having already recorded the terminal state.
        await adapter.set_state(job_id, JobState.cancelled)

        ran = {"pipeline": False}

        class _Pipeline:
            progress = Progress_Service(active_transport="poll")

            async def run(self, video, *, job_id, artifacts=None):
                ran["pipeline"] = True
                return StageResult[AnalysisResult](success=True, output=None)

        worker = Background_Worker(
            adapter,
            _Pipeline(),
            meta_provider=lambda job: _async(_video()),
            cancel_check=lambda _jid: True,
        )
        job = await worker.process_job(job_id)

        assert ran["pipeline"] is False              # pipeline never ran
        assert job is not None
        assert job.state == JobState.cancelled        # cancellation preserved
        assert job.result is None
        assert job.error is None

    asyncio.run(scenario())


def test_worker_cancelled_during_run_is_not_marked_failed():
    """A cancel that lands during the run leaves the cancelled state intact."""

    async def scenario():
        adapter = BullMQJobQueueAdapter()
        job_id = await adapter.enqueue(AnalysisJob(job_id="", user_id="u1"))
        await adapter.set_state(job_id, JobState.cancelled)

        # cancel_check reports False at the pre-run check, then True after run,
        # emulating a cancel that arrives while the pipeline is executing.
        checks = iter([False, True, True, True])

        class _Pipeline:
            progress = Progress_Service(active_transport="poll")

            async def run(self, video, *, job_id, artifacts=None):
                # Pipeline "fails" (as an interrupted run might) — the worker must
                # NOT record this as failed because the job was cancelled.
                return StageResult[AnalysisResult](success=False, output=None)

        worker = Background_Worker(
            adapter,
            _Pipeline(),
            meta_provider=lambda job: _async(_video()),
            cancel_check=lambda _jid: next(checks),
        )
        job = await worker.process_job(job_id)

        assert job is not None
        assert job.state == JobState.cancelled        # not clobbered to failed
        assert job.error is None

    asyncio.run(scenario())


# ── Integrity + cancellation guards inside the runner ───────────────────────

def _seed_context(runner: RealPipelineRunner, job_id: str, *, expected_sha256=None):
    """Populate a JobContext with a real transient file + reader for `job_id`."""
    path = _make_temp_file()
    reader = OpenCvFrameReader(path)  # opens a capture; the fake file simply won't decode
    ctx = JobContext(
        acquired=AcquiredVideo(local_path=path, owned=True),
        reader=reader,
        meta=_video(),
        exercise_hint=None,
        expected_sha256=expected_sha256,
    )
    runner._contexts[job_id] = ctx
    return path


def test_runner_integrity_mismatch_fails_and_deletes():
    """A digest mismatch fails with INTEGRITY_MISMATCH and deletes the file."""

    async def scenario():
        runner = RealPipelineRunner(Progress_Service(active_transport="poll"))
        job_id = "job-integrity"
        path = _seed_context(runner, job_id, expected_sha256="deadbeef" * 8)  # wrong

        result = await runner.run(_video(), job_id=job_id)

        assert result.success is False
        assert result.error is not None
        assert result.error.code == "INTEGRITY_MISMATCH"
        assert not os.path.isfile(path)              # transient video deleted
        assert job_id not in runner._contexts

    asyncio.run(scenario())


def test_runner_cancelled_before_start_skips_and_deletes():
    """A cancelled job is not analyzed; its transient file is deleted."""

    async def scenario():
        runner = RealPipelineRunner(
            Progress_Service(active_transport="poll"),
            cancel_check=lambda _jid: True,
        )
        job_id = "job-cancelled"
        path = _seed_context(runner, job_id)

        result = await runner.run(_video(), job_id=job_id)

        assert result.success is False
        assert result.error is not None
        assert result.error.code == "JOB_CANCELLED"
        assert not os.path.isfile(path)              # transient video deleted
        assert job_id not in runner._contexts

    asyncio.run(scenario())


# ── End-to-end cancellation through the shared runtime ──────────────────────

def test_runtime_cancel_job_sets_cancelled_state():
    """runtime.cancel_job transitions a queued job to the terminal cancelled state."""

    async def scenario():
        from app.analysis import runtime

        job_id = await runtime.submit_job(video_ref="https://example.test/v.mp4", user_id="u1")
        # The worker is not started in the test, so the job stays queued.
        assert runtime.is_cancelled(job_id) is False

        cancelled = await runtime.cancel_job(job_id)
        assert cancelled is True
        assert runtime.is_cancelled(job_id) is True

        job = await runtime.queue.get(job_id)
        assert job is not None
        assert job.state == JobState.cancelled

        # Cancelling an already-terminal job is a no-op returning False.
        assert await runtime.cancel_job(job_id) is False
        # Cancelling an unknown job returns False.
        assert await runtime.cancel_job("no-such-job") is False

    asyncio.run(scenario())
