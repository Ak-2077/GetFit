"""
Property-based tests for the Duplicate_Detection_Service (Req 34).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hypothesis property tests covering the duplicate-detection gate
(`app/analysis_v2/gates/duplicate_detection.py`):

  • Property 36 — Video_Hash is deterministic and content-discriminating
    (Req 34.1).
  • Property 37 — the gate returns the cached result on an exact
    (user_id, video_hash, pipeline_version) triple match and runs normally
    otherwise (Req 34.2, 34.3, 34.4).
  • Property 38 — the gate degrades gracefully when the hash cannot be computed
    or the store is unavailable / too slow (Req 34.6, 34.7).

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest app/analysis_v2/gates/test_duplicate_detection_property.py
"""

from __future__ import annotations

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import (
    AnalysisResult,
    ObjectiveMetrics,
    RepetitionSummary,
)
from app.analysis_v2.gates.duplicate_detection import (
    DuplicateCheckInput,
    DuplicateDetectionService,
    DuplicateStore,
    InMemoryDuplicateStore,
    compute_video_hash,
)

# Minimum number of generated examples per property (task requirement: >= 100).
_MIN_ITER = 150


# ── Shared builders ──────────────────────────────────────────────────────────

def _make_result(exercise_id: str = "squat") -> AnalysisResult:
    """A minimal, valid bounded AnalysisResult to stash in the store."""
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


_payloads = st.binary(min_size=0, max_size=4096)
_ids = st.text(min_size=1, max_size=24)
_versions = st.sampled_from(["1.0.0", "1.1.0", "2.0.0"])


# ── Property 36 ──────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 36: Video hashing is deterministic and content-discriminating
# Validates: Requirements 34.1

@settings(max_examples=_MIN_ITER, deadline=None)
@given(content=_payloads)
def test_property_36_hash_is_deterministic(content: bytes) -> None:
    """Same byte content always hashes to the same Video_Hash (Req 34.1)."""
    a = DuplicateCheckInput(user_id="u", pipeline_version="1.0.0", video_bytes=content)
    b = DuplicateCheckInput(user_id="u", pipeline_version="1.0.0", video_bytes=content)
    assert compute_video_hash(a) == compute_video_hash(b)


@settings(max_examples=_MIN_ITER, deadline=None)
@given(left=_payloads, right=_payloads)
def test_property_36_hash_is_content_discriminating(left: bytes, right: bytes) -> None:
    """Distinct byte contents yield distinct hashes; equal contents match (Req 34.1)."""
    h_left = compute_video_hash(
        DuplicateCheckInput(user_id="u", pipeline_version="1.0.0", video_bytes=left)
    )
    h_right = compute_video_hash(
        DuplicateCheckInput(user_id="u", pipeline_version="1.0.0", video_bytes=right)
    )
    if left == right:
        assert h_left == h_right
    else:
        # SHA256 over different content: distinct (trivial collisions are
        # cryptographically infeasible for these bounded payloads).
        assert h_left != h_right


@settings(max_examples=_MIN_ITER, deadline=None)
@given(content=_payloads)
def test_property_36_video_ref_and_bytes_agree(content: bytes, tmp_path_factory) -> None:
    """
    The video_bytes path and the video_ref (local file) path produce the SAME
    Video_Hash for identical content (Req 34.1) — the hash is over the complete
    byte content regardless of source.
    """
    path = tmp_path_factory.mktemp("vids") / "clip.bin"
    path.write_bytes(content)

    from_bytes = compute_video_hash(
        DuplicateCheckInput(user_id="u", pipeline_version="1.0.0", video_bytes=content)
    )
    from_ref = compute_video_hash(
        DuplicateCheckInput(user_id="u", pipeline_version="1.0.0", video_ref=str(path))
    )
    assert from_bytes == from_ref


# ── Property 37 ──────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 37: Duplicate decision returns cached result on exact-triple match and runs otherwise
# Validates: Requirements 34.2, 34.3, 34.4

@settings(max_examples=_MIN_ITER, deadline=None)
@given(user_id=_ids, version=_versions, content=_payloads)
def test_property_37_exact_triple_match_returns_cached(
    user_id: str, version: str, content: bytes
) -> None:
    """
    An exact (user_id, video_hash, pipeline_version) match returns the cached
    result with cache_hit=True and skip_ai_stages=True (Req 34.2, 34.3).
    """
    store = InMemoryDuplicateStore()
    data = DuplicateCheckInput(
        user_id=user_id, pipeline_version=version, video_bytes=content
    )
    video_hash = compute_video_hash(data)
    cached = _make_result()

    async def scenario():
        await store.save(user_id, video_hash, version, cached)
        gate = DuplicateDetectionService(store)
        return await gate.run(data)

    result = asyncio.run(scenario())
    assert result.success is True
    decision = result.output
    assert decision.cache_hit is True
    assert decision.skip_ai_stages is True
    assert decision.bypassed is False
    assert decision.result == cached
    assert decision.video_hash == video_hash


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    user_id=_ids,
    version=_versions,
    content=_payloads,
    mismatch=st.sampled_from(["user", "hash", "version"]),
)
def test_property_37_any_mismatch_runs_normally(
    user_id: str, version: str, content: bytes, mismatch: str
) -> None:
    """
    A mismatch on ANY of user_id / video_hash / pipeline_version is a miss:
    cache_hit=False and the pipeline runs normally (Req 34.4).
    """
    store = InMemoryDuplicateStore()
    data = DuplicateCheckInput(
        user_id=user_id, pipeline_version=version, video_bytes=content
    )
    video_hash = compute_video_hash(data)
    cached = _make_result()

    # Pre-populate the store under a triple that differs in exactly one component.
    if mismatch == "user":
        saved_user, saved_hash, saved_version = user_id + "_other", video_hash, version
    elif mismatch == "hash":
        saved_user, saved_hash, saved_version = user_id, video_hash + "0", version
    else:  # version
        other = "9.9.9" if version != "9.9.9" else "8.8.8"
        saved_user, saved_hash, saved_version = user_id, video_hash, other

    async def scenario():
        await store.save(saved_user, saved_hash, saved_version, cached)
        gate = DuplicateDetectionService(store)
        return await gate.run(data)

    result = asyncio.run(scenario())
    assert result.success is True
    decision = result.output
    assert decision.cache_hit is False
    assert decision.skip_ai_stages is False
    assert decision.result is None
    assert decision.bypassed is False
    assert decision.video_hash == video_hash


# ── Property 38 ──────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 38: Duplicate detection degrades gracefully
# Validates: Requirements 34.6, 34.7

class _RaisingStore(DuplicateStore):
    """A store backend whose lookup always raises (simulates unavailability)."""

    name = "raising"

    async def find(self, user_id: str, video_hash: str, pipeline_version: str):
        raise RuntimeError("backend unavailable")


class _SlowStore(DuplicateStore):
    """A store backend that sleeps well beyond the gate's lookup timeout."""

    name = "slow"

    def __init__(self, sleep_s: float) -> None:
        self._sleep_s = sleep_s

    async def find(self, user_id: str, video_hash: str, pipeline_version: str):
        # Sleep far longer than the (test-shrunk) lookup budget to force a timeout.
        await asyncio.sleep(self._sleep_s)
        return None


@settings(max_examples=_MIN_ITER, deadline=None)
@given(user_id=_ids, version=_versions)
def test_property_38_unhashable_input_bypasses(user_id: str, version: str) -> None:
    """
    When the Video_Hash cannot be computed (no video_bytes/video_ref), the gate
    bypasses gracefully: success result, bypassed=True with a reason, and
    cache_hit=False — it never raises (Req 34.6).
    """
    data = DuplicateCheckInput(user_id=user_id, pipeline_version=version)
    gate = DuplicateDetectionService(InMemoryDuplicateStore())

    result = asyncio.run(gate.run(data))
    assert result.success is True
    decision = result.output
    assert decision.bypassed is True
    assert decision.bypass_reason
    assert decision.cache_hit is False
    assert decision.result is None


@settings(max_examples=_MIN_ITER, deadline=None)
@given(user_id=_ids, version=_versions, content=st.binary(min_size=0, max_size=256))
def test_property_38_store_failure_bypasses(
    user_id: str, version: str, content: bytes
) -> None:
    """
    When the store raises, the gate bypasses gracefully and the pipeline
    proceeds: success, bypassed=True (store_unavailable), cache_hit=False
    (Req 34.7). Never raises.
    """
    data = DuplicateCheckInput(
        user_id=user_id, pipeline_version=version, video_bytes=content
    )
    gate = DuplicateDetectionService(_RaisingStore())

    result = asyncio.run(gate.run(data))
    assert result.success is True
    decision = result.output
    assert decision.bypassed is True
    assert decision.bypass_reason == "store_unavailable"
    assert decision.cache_hit is False
    assert decision.result is None
    # Hash was computable, so it is carried even on bypass.
    assert decision.video_hash == compute_video_hash(data)


# A reduced example count keeps total runtime bounded while staying >= 100,
# since each iteration of this case waits on the lookup timeout.
@settings(max_examples=100, deadline=None)
@given(user_id=_ids, version=_versions, content=st.binary(min_size=0, max_size=64))
def test_property_38_store_timeout_bypasses(
    user_id: str, version: str, content: bytes
) -> None:
    """
    When the store is too slow (exceeds DUPLICATE_LOOKUP_TIMEOUT_MS), the gate
    bypasses gracefully: success, bypassed=True (store_lookup_timeout),
    cache_hit=False (Req 34.7). Never raises.
    """
    data = DuplicateCheckInput(
        user_id=user_id, pipeline_version=version, video_bytes=content
    )
    gate = DuplicateDetectionService(_SlowStore(sleep_s=0.5))
    # Shrink the lookup budget so the timeout path is exercised quickly; the
    # store still sleeps an order of magnitude longer than this budget.
    gate._timeout_s = 0.02

    result = asyncio.run(gate.run(data))
    assert result.success is True
    decision = result.output
    assert decision.bypassed is True
    assert decision.bypass_reason == "store_lookup_timeout"
    assert decision.cache_hit is False
    assert decision.result is None
