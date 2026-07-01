"""
Integration tests for the additive V2 pre-pipeline wiring (task 31.4).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Example-based integration tests for `PipelineV2`
(`app/analysis_v2/pipeline_v2.py`) — the strictly-additive orchestrator that
runs the two V2 pre-pipeline gates before delegating to the UNCHANGED V1
`Analysis_Pipeline`. These tests wire the orchestrator with mocked collaborators
(gates/caches/retry/queue/models) and assert the additive-wiring contract:

  • DUPLICATE HIT   — the cached result is returned and EVERY AI stage is
    skipped: the V1 pipeline `run` is NOT invoked (Req 34.3, 52.1).
  • ABUSE REJECT    — a below-threshold / unclassifiable submission yields a
    `StructuredError(code="NOT_EXERCISE_VIDEO")` with NO `AnalysisResult`, and
    the V1 pipeline is NOT invoked (Req 47.2, 47.6, 52.1).
  • PASS-THROUGH    — both gates pass ⇒ the UNCHANGED V1 `run` entrypoint is
    invoked EXACTLY ONCE with byte-for-byte unchanged args, and its
    `StageResult` is returned verbatim (Req 34.4, 47.3, 52.1).
  • FALL-BACK       — a failing/mocked cache, retry manager, or secure-storage
    wrapper degrades to EXACT V1 behavior: the run still yields the exact V1
    result (Req 52.4).

The async `PipelineV2.run` is driven synchronously via ``asyncio.run``, matching
the established V2 test convention (`test_retry_manager_property.py`,
`test_cost_tracking_property.py`, `test_secure_temp_storage_cleanup_property.py`).

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest app/analysis_v2/test_pipeline_v2_integration.py -q
"""

from __future__ import annotations

import asyncio
import inspect
from types import SimpleNamespace

import pytest

# UNCHANGED V1 contracts (imported, never redefined) — Req 52.1, 52.6.
from app.analysis.contracts import (
    AnalysisResult,
    Frame,
    KeyFrames,
    ObjectiveMetrics,
    RepetitionSummary,
    VideoMeta,
)
from app.analysis.stages.cleanup import ArtifactRegistry
from app.analysis_v2 import StageResult, StructuredError
from app.analysis_v2.gates.abuse_protection import StaticContentClassifier
from app.analysis_v2.gates.duplicate_detection import (
    DuplicateCheckInput,
    InMemoryDuplicateStore,
    compute_video_hash,
)
from app.analysis_v2.pipeline_v2 import PipelineV2, PipelineV2Path


# ── Shared builders ──────────────────────────────────────────────────────────

def _make_result(exercise_id: str = "squat") -> AnalysisResult:
    """A minimal, valid bounded AnalysisResult (mirrors the gate tests)."""
    metrics = ObjectiveMetrics(
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
    reps = RepetitionSummary(
        rep_count=1,
        phase_timestamps=[],
        avg_rep_duration_ms=1000.0,
        movement_consistency=0.9,
    )
    return AnalysisResult(
        exercise_id=exercise_id,
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
        movement_metrics=metrics,
        repetition_summary=reps,
        overall_confidence=0.9,
        low_confidence=False,
        analysisVersion="1.0.0",
        poseEngineVersion="stub",
        visionModelVersion="stub",
        reasoningModelVersion="stub",
        pipelineVersion="1.0.0",
    )


def _make_video_meta() -> VideoMeta:
    return VideoMeta(
        container_format="mp4",
        codec="h264",
        duration_sec=5.0,
        width=1080,
        height=1920,
        fps=30.0,
        size_bytes=1024,
        orientation="portrait",
    )


def _make_key_frames() -> KeyFrames:
    meta = _make_video_meta()
    return KeyFrames(
        frames=[Frame(index=0, timestamp_ms=0.0), Frame(index=1, timestamp_ms=100.0)],
        source_meta=meta,
    )


def _make_duplicate_input(video_bytes: bytes = b"raw-video-bytes") -> DuplicateCheckInput:
    return DuplicateCheckInput(
        user_id="user-1",
        pipeline_version="1.0.0",
        video_bytes=video_bytes,
    )


# ── Mock collaborators ───────────────────────────────────────────────────────

class FakeV1Pipeline:
    """
    Satisfies :class:`V1PipelineRunner`. Records whether — and with what args —
    its `run` was invoked, and returns a known `StageResult[AnalysisResult]`.
    """

    def __init__(self, result: StageResult[AnalysisResult]) -> None:
        self._result = result
        self.calls: list[tuple[VideoMeta, str, ArtifactRegistry | None]] = []

    async def run(self, video, *, job_id, artifacts=None):
        self.calls.append((video, job_id, artifacts))
        return self._result

    @property
    def invoked(self) -> bool:
        return len(self.calls) > 0


class PassthroughRetryManager:
    """A retry manager that forwards args UNCHANGED and calls `fn` exactly once."""

    def __init__(self) -> None:
        self.calls = 0

    async def call(self, dependency, fn, *args, **kwargs):
        self.calls += 1
        result = fn(*args, **kwargs)
        if inspect.isawaitable(result):
            result = await result
        return result


class RaisingRetryManager:
    """A retry manager whose machinery itself fails on every call (Req 52.4)."""

    def __init__(self) -> None:
        self.calls = 0

    async def call(self, dependency, fn, *args, **kwargs):
        self.calls += 1
        raise RuntimeError("retry machinery unavailable")


class NoopCache:
    """A pass-through cache stand-in whose clear/seams never fail."""

    def clear(self) -> None:
        pass

    def get_or_decode(self, video_hash, ts_ms, decode):
        return decode()

    def get_or_extract(self, frame_hash, engine_version, extract):
        return extract()


class RaisingCache:
    """A cache collaborator that fails on EVERY operation (Req 38.6, 39.4, 52.4)."""

    def clear(self) -> None:
        raise RuntimeError("cache unavailable")

    def get_or_decode(self, video_hash, ts_ms, decode):
        raise RuntimeError("cache unavailable")

    def get_or_extract(self, frame_hash, engine_version, extract):
        raise RuntimeError("cache unavailable")


class NoopSecureStorage:
    """A secure-storage stand-in that provisions/cleans without failing."""

    def write(self, artifact_id, data, *, job_id):
        return None

    async def cleanup(self, job_id):
        return None


class RaisingSecureStorage:
    """A secure-storage collaborator that fails to provision/clean (Req 51.2, 52.4)."""

    def write(self, artifact_id, data, *, job_id):
        raise RuntimeError("secure storage unavailable")

    async def cleanup(self, job_id):
        raise RuntimeError("secure storage unavailable")


class UnusedGpuRecovery:
    """GPU-recovery stand-in that must NOT be invoked on a non-crashing run."""

    name = "gpu_recovery"

    async def recover(self, worker_id, job):
        raise AssertionError("GPU recovery must not be invoked when V1 does not crash")


class RecordingCostTracking:
    """Records terminal cost records so telemetry firing can be observed."""

    def __init__(self) -> None:
        self.records: list[tuple[object, object]] = []

    async def record(self, job, metrics):
        self.records.append((job, metrics))
        return None


class RecordingBenchmarkBuilder:
    """Records benchmark samples (only when a manual correction is supplied)."""

    def __init__(self) -> None:
        self.samples: list[object] = []

    def record(self, sample):
        self.samples.append(sample)


def _noop_review(_confidence, _threshold):
    """No-op review hook: leaves `review_status` absent (exact V1 shape)."""
    return None, None


def _noop_explain(_factors, _score_name):
    """No-op explain hook: leaves `score_explanations` absent (exact V1 shape)."""
    return None, None


#: A model registry stand-in whose active model names the cost record's model.
_FAKE_MODEL_REGISTRY = SimpleNamespace(active=lambda kind: SimpleNamespace(name="stub-model"))


def _build_pipeline(
    v1_pipeline: FakeV1Pipeline,
    *,
    duplicate_store=None,
    content_classifier=None,
    frame_cache=None,
    pose_cache=None,
    retry_manager=None,
    gpu_recovery=None,
    secure_storage=None,
    cost_tracking=None,
    benchmark_builder=None,
) -> PipelineV2:
    """
    Construct a `PipelineV2` with fully-mocked collaborators.

    Sensible passthrough defaults are supplied for every wrapper so a test only
    substitutes the one collaborator it is exercising. The post-feedback hooks
    are no-ops so the pass-through result is the EXACT V1 `StageResult` (its
    serialized shape is byte-for-byte V1), which lets the tests assert identity
    against the V1 pipeline's returned result.
    """
    return PipelineV2(
        v1_pipeline,
        duplicate_store=duplicate_store if duplicate_store is not None else InMemoryDuplicateStore(),
        content_classifier=content_classifier
        if content_classifier is not None
        else StaticContentClassifier(1.0),
        frame_cache=frame_cache if frame_cache is not None else NoopCache(),
        pose_cache=pose_cache if pose_cache is not None else NoopCache(),
        retry_manager=retry_manager if retry_manager is not None else PassthroughRetryManager(),
        gpu_recovery=gpu_recovery if gpu_recovery is not None else UnusedGpuRecovery(),
        secure_storage=secure_storage if secure_storage is not None else NoopSecureStorage(),
        assign_review_status=_noop_review,
        explain_score=_noop_explain,
        model_registry=_FAKE_MODEL_REGISTRY,
        cost_tracking=cost_tracking if cost_tracking is not None else RecordingCostTracking(),
        benchmark_builder=benchmark_builder
        if benchmark_builder is not None
        else RecordingBenchmarkBuilder(),
    )


# ── DUPLICATE HIT — the cached result is returned; AI stages are skipped ─────
# Validates: Requirements 52.1 (via Req 34.3)

def test_duplicate_hit_returns_cached_result_and_skips_v1_pipeline() -> None:
    """A duplicate hit returns the cached result and NEVER invokes the V1 pipeline."""
    dup_input = _make_duplicate_input()
    cached = _make_result(exercise_id="deadlift")

    # Seed the duplicate store under the EXACT (user_id, video_hash,
    # pipeline_version) triple so the gate reports a hit (Req 34.2).
    store = InMemoryDuplicateStore()
    video_hash = compute_video_hash(dup_input)
    asyncio.run(store.save(dup_input.user_id, video_hash, dup_input.pipeline_version, cached))

    # The V1 pipeline is wired but should never run on a hit.
    fake_v1 = FakeV1Pipeline(StageResult(success=True, output=_make_result("should-not-run")))
    cost = RecordingCostTracking()
    pipeline = _build_pipeline(fake_v1, duplicate_store=store, cost_tracking=cost)

    outcome = asyncio.run(
        pipeline.run(
            duplicate_input=dup_input,
            key_frames=_make_key_frames(),
            video=_make_video_meta(),
            job_id="job-dup",
        )
    )

    # The cached AnalysisResult is returned verbatim (Req 34.3).
    assert outcome.path is PipelineV2Path.duplicate_hit
    assert outcome.result.success is True
    assert outcome.result.output == cached
    assert outcome.duplicate_decision is not None
    assert outcome.duplicate_decision.cache_hit is True

    # Every AI stage was skipped — the V1 pipeline `run` was NOT invoked.
    assert fake_v1.invoked is False
    # The hit is still a terminal job, so terminal telemetry fired exactly once.
    assert len(cost.records) == 1


# ── ABUSE REJECT — no result, NOT_EXERCISE_VIDEO, V1 not invoked ─────────────
# Validates: Requirements 52.1 (via Req 47.2, 47.6)

def test_abuse_rejection_below_threshold_produces_no_result_and_skips_v1() -> None:
    """Below-threshold content halts with NOT_EXERCISE_VIDEO and no AnalysisResult."""
    fake_v1 = FakeV1Pipeline(StageResult(success=True, output=_make_result("should-not-run")))
    cost = RecordingCostTracking()
    # Duplicate store empty ⇒ miss; classifier confidence 0.0 ⇒ below threshold.
    pipeline = _build_pipeline(
        fake_v1,
        content_classifier=StaticContentClassifier(0.0),
        cost_tracking=cost,
    )

    outcome = asyncio.run(
        pipeline.run(
            duplicate_input=_make_duplicate_input(),
            key_frames=_make_key_frames(),
            video=_make_video_meta(),
            job_id="job-abuse",
        )
    )

    assert outcome.path is PipelineV2Path.abuse_rejected
    assert outcome.result.success is False
    assert outcome.result.output is None  # NO AnalysisResult (Req 47.6)
    assert outcome.result.error is not None
    assert outcome.result.error.code == "NOT_EXERCISE_VIDEO"
    assert outcome.result.error.stage == "abuse_protection"

    # The V1 pipeline was NOT invoked — the AI stages never ran.
    assert fake_v1.invoked is False
    # A rejection is a terminal (failed) job — terminal telemetry fired once.
    assert len(cost.records) == 1


def test_abuse_rejection_on_classifier_failure_produces_no_result_and_skips_v1() -> None:
    """An unclassifiable submission (classifier raises) is rejected (Req 47.6)."""
    fake_v1 = FakeV1Pipeline(StageResult(success=True, output=_make_result("should-not-run")))
    # StaticContentClassifier(None) raises inside classify() → treated as reject.
    pipeline = _build_pipeline(fake_v1, content_classifier=StaticContentClassifier(None))

    outcome = asyncio.run(
        pipeline.run(
            duplicate_input=_make_duplicate_input(),
            key_frames=_make_key_frames(),
            video=_make_video_meta(),
            job_id="job-abuse-fail",
        )
    )

    assert outcome.path is PipelineV2Path.abuse_rejected
    assert outcome.result.success is False
    assert outcome.result.output is None
    assert outcome.result.error is not None
    assert outcome.result.error.code == "NOT_EXERCISE_VIDEO"
    assert fake_v1.invoked is False


# ── PASS-THROUGH — V1 invoked once, unchanged args, result verbatim ──────────
# Validates: Requirements 52.1

def test_pass_through_invokes_v1_exactly_once_with_unchanged_args() -> None:
    """Both gates pass ⇒ the UNCHANGED V1 `run` is invoked once with unchanged args."""
    expected = StageResult(success=True, output=_make_result("squat"))
    fake_v1 = FakeV1Pipeline(expected)
    retry = PassthroughRetryManager()
    pipeline = _build_pipeline(fake_v1, retry_manager=retry)

    video = _make_video_meta()
    artifacts = ArtifactRegistry(job_id="job-pass")

    outcome = asyncio.run(
        pipeline.run(
            duplicate_input=_make_duplicate_input(),
            key_frames=_make_key_frames(),
            video=video,
            job_id="job-pass",
            artifacts=artifacts,
        )
    )

    # The V1 pipeline ran (Req 34.4, 47.3) and its StageResult is returned verbatim.
    # (Equality, not identity: PipelineV2Outcome is a Pydantic model that
    # revalidates the StageResult on assignment; the no-op augmentation hooks
    # leave the result byte-for-byte the V1 shape.)
    assert outcome.path is PipelineV2Path.pipeline_ran
    assert outcome.result == expected  # exact V1 result, no-op augmentation

    # Invoked EXACTLY ONCE with byte-for-byte unchanged args (Req 52.1).
    assert len(fake_v1.calls) == 1
    seen_video, seen_job_id, seen_artifacts = fake_v1.calls[0]
    assert seen_video is video
    assert seen_job_id == "job-pass"
    assert seen_artifacts is artifacts
    assert retry.calls == 1


# ── FALL-BACK — a failing retry wrapper degrades to EXACT V1 behavior ────────
# Validates: Requirements 52.4

def test_retry_machinery_failure_falls_back_to_exact_v1_result() -> None:
    """A failing retry manager falls back to a direct V1 run yielding the exact result."""
    expected = StageResult(success=True, output=_make_result("bench-press"))
    fake_v1 = FakeV1Pipeline(expected)
    retry = RaisingRetryManager()
    pipeline = _build_pipeline(fake_v1, retry_manager=retry)

    video = _make_video_meta()

    outcome = asyncio.run(
        pipeline.run(
            duplicate_input=_make_duplicate_input(),
            key_frames=_make_key_frames(),
            video=video,
            job_id="job-retry-fail",
        )
    )

    # The retry machinery was attempted and failed …
    assert retry.calls == 1
    # … yet the run still produced the EXACT V1 result (Req 52.4).
    assert outcome.path is PipelineV2Path.pipeline_ran
    assert outcome.result == expected
    # And the direct fall-back invoked the UNCHANGED V1 run exactly once.
    assert len(fake_v1.calls) == 1
    assert fake_v1.calls[0][0] is video


# ── FALL-BACK — failing cache + secure-storage wrappers degrade to EXACT V1 ──
# Validates: Requirements 52.4

def test_cache_and_secure_storage_failures_fall_back_to_exact_v1_result() -> None:
    """Failing frame/pose caches and secure storage still yield the exact V1 result."""
    expected = StageResult(success=True, output=_make_result("ohp"))
    fake_v1 = FakeV1Pipeline(expected)
    pipeline = _build_pipeline(
        fake_v1,
        frame_cache=RaisingCache(),
        pose_cache=RaisingCache(),
        secure_storage=RaisingSecureStorage(),
        retry_manager=PassthroughRetryManager(),
    )

    outcome = asyncio.run(
        pipeline.run(
            duplicate_input=_make_duplicate_input(),
            key_frames=_make_key_frames(),
            video=_make_video_meta(),
            job_id="job-wrapper-fail",
        )
    )

    # Every wrapper failure was swallowed; the exact V1 result is produced (Req 52.4).
    assert outcome.path is PipelineV2Path.pipeline_ran
    assert outcome.result == expected
    assert len(fake_v1.calls) == 1


# ── FALL-BACK — the frame/pose cache seams run the V1 extraction on failure ──
# Validates: Requirements 52.4

def test_frame_and_pose_cache_seams_fall_back_to_v1_extraction_on_cache_failure() -> None:
    """A raising cache collaborator degrades the extraction seams to the V1 delegate."""
    fake_v1 = FakeV1Pipeline(StageResult(success=True, output=_make_result()))
    pipeline = _build_pipeline(fake_v1, frame_cache=RaisingCache(), pose_cache=RaisingCache())

    # The frame-decode seam falls back to invoking the V1 decode delegate.
    frame_sentinel = object()
    decoded = pipeline._extract_frame_cached("vhash", 0.0, lambda: frame_sentinel)
    assert decoded is frame_sentinel

    # The pose-extract seam falls back to invoking the V1 extract delegate.
    pose_sentinel = object()
    extracted = pipeline._extract_pose_cached("fhash", "engine-1", lambda: pose_sentinel)
    assert extracted is pose_sentinel


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-q"]))
