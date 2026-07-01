"""
Property tests — Property 63: The privacy guarantee holds across every V2 component
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Task 32.3 · Validates: Requirements 40.2, 40.3, 40.4, 41.6, 46.5, 46.6, 51.4, 52.5

Design (design.md "Property 63"):

    For any persisted or externally transmitted artifact produced by any
    Version 2 component — the persisted Analysis_Result (including V2 fields),
    every Cost_Record, every Benchmark_Sample and exported dataset, every
    Admin_Analytics metric, every cache entry after processing completes, and
    the secure temporary storage after cleanup — the artifact contains no
    original video, raw frames, or pose images.

This is a cross-cutting property over the V2 telemetry / analytics / storage
contracts. For arbitrary generated instances of each V2 component, it asserts
that the serialized payload:

  • contains NO key that names user / video / frame / pose data (a curated
    denylist that allows the anonymous aggregate `frame_count` and the
    `image_hash` reference, but forbids any actual media/identity field), and
  • contains NO forbidden media token ("video", "pose", "landmark", …) anywhere
    in the serialized bytes (values are drawn from safe domains — hashes,
    coarse labels, numbers — so a leak would be a real violation, not a
    generator artefact).

Components exercised (one property each):
  • `CostRecord`              — anonymous aggregate only  (Req 40.2, 40.3, 40.4)
  • `BenchmarkSample`/dataset — image HASH only           (Req 41.6)
  • `AdminMetricsSnapshot`    — aggregate-only, no per-user (Req 46.5, 46.6)
  • Secure_Temporary_Storage  — nothing persists post-cleanup (Req 51.4)
  • `AnalysisResult` V2 fields— additive, introduce no media (Req 52.5)

A failure here is a REAL privacy/contract violation to fix additively — never a
reason to weaken the test.

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest \\
        app/analysis_v2/test_privacy_guarantee_property.py -q
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.analytics import AnalyticsService, InMemoryAnalyticsSink
from app.analysis.contracts import (
    AnalysisResult,
    CleanupReport,
    ObjectiveMetrics,
    RepetitionSummary,
)
from app.analysis_v2.models_v2 import (
    BenchmarkSample,
    CostRecord,
    ReviewStatus,
    ScoreExplanation,
)
from app.analysis_v2.storage.secure_temp_storage import (
    InMemorySecureArtifactStore,
    SecureTemporaryStorageService,
)
from app.analysis_v2.telemetry.admin_analytics import (
    AdminAnalyticsService,
    AdminMetricsSnapshot,
    OperationalGauges,
    StaticOperationalMetricsProvider,
)
from app.analysis_v2.telemetry.benchmark_builder import BenchmarkDatasetBuilder
from app.analysis_v2.telemetry.cost_tracking import CostTrackingService, InMemoryCostSink

# Minimum iterations mandated for these property tests (task requirement: >= 100).
_MIN_ITER = 200


# ── The privacy denylist ─────────────────────────────────────────────────────
#
# Hard media/identity tokens that must NEVER appear anywhere in a serialized V2
# artifact — keys OR values. `frame`/`image` are handled separately because the
# anonymous aggregate `frame_count` (Req 40.4) and the `image_hash` reference
# (Req 41.6) are the ONLY legitimate uses of those stems.
_FORBIDDEN_TOKENS: tuple[str, ...] = ("video", "pose", "landmark", "pixels", "rawframe")

#: Keys that legitimately contain an otherwise-suspicious stem (compared
#: case-insensitively, so entries are lowercase):
#   • frame_count       — anonymous aggregate count, not frame data (Req 40.4)
#   • image_hash        — hash reference, never the image itself     (Req 41.6)
#   • user_corrections  — V1 persisted correction notes (Req 13.3); user feedback
#                         text, NOT a user identifier / per-user identity field
#   • poseengineversion — V1 versioning metadata (Req 29.1): the pose *engine*
#                         identifier string, never pose landmarks / images
_ALLOWED_STEM_KEYS: frozenset[str] = frozenset(
    {"frame_count", "image_hash", "user_corrections", "poseengineversion"}
)

#: Identity stems that name a user-identifiable record (Req 46.6, 40.2). These
#: are the actual privacy violations — a user's *identity*, not their feedback.
_IDENTITY_STEMS: tuple[str, ...] = ("user_id", "userid", "username", "user_name")


def _key_is_forbidden(key: str) -> bool:
    """Whether a serialized key names user / video / frame / pose / image data.

    Allows the two sanctioned exceptions — the anonymous aggregate `frame_count`
    and the `image_hash` reference — and forbids every other media/identity
    field (Req 40.2/40.4, 41.6, 46.5/46.6).
    """
    k = key.lower()
    if k in _ALLOWED_STEM_KEYS:
        return False
    if any(tok in k for tok in _FORBIDDEN_TOKENS):
        return True
    if any(stem in k for stem in _IDENTITY_STEMS):  # user_id, username, … (not feedback)
        return True
    if "frame" in k:  # any frame-data field other than the aggregate count
        return True
    if "image" in k:  # any image-data field other than the hash reference
        return True
    return False


def _collect_keys(payload: Any) -> set[str]:
    """Recursively collect every mapping key present in a serialized payload."""
    keys: set[str] = set()
    if isinstance(payload, dict):
        for key, value in payload.items():
            keys.add(str(key))
            keys |= _collect_keys(value)
    elif isinstance(payload, (list, tuple)):
        for item in payload:
            keys |= _collect_keys(item)
    return keys


def _collect_values(payload: Any) -> list[str]:
    """Recursively collect every scalar VALUE (as text) in a serialized payload.

    Mapping VALUES and their inner keys are gathered so a media token hidden as
    a value (or as a data key produced by the component) is caught, while the
    component's own declared field names — validated separately by
    `_key_is_forbidden` — are not re-scanned here as false positives.
    """
    values: list[str] = []
    if isinstance(payload, dict):
        for key, value in payload.items():
            # A dict *key* is data only when it is not one of the model's
            # declared fields — e.g. an exercise/model label in a category map.
            values.append(str(key))
            values.extend(_collect_values(value))
    elif isinstance(payload, (list, tuple)):
        for item in payload:
            values.extend(_collect_values(item))
    elif payload is not None:
        values.append(str(payload))
    return values


def _assert_no_forbidden_keys(payload: Any, ctx: str) -> None:
    for key in _collect_keys(payload):
        assert not _key_is_forbidden(key), (
            f"{ctx}: privacy-forbidden key {key!r} present in serialized payload"
        )


def _assert_no_forbidden_value_tokens(payload: Any, ctx: str) -> None:
    """No hard media token appears in any generated value / data key.

    Declared model field names are excluded (they are checked structurally by
    `_key_is_forbidden`); values are drawn from privacy-clean domains, so any
    occurrence of a media token is a genuine leak.
    """
    for text in _collect_values(payload):
        low = text.lower()
        # Skip the model's own declared, allowed field names.
        if low in _ALLOWED_STEM_KEYS:
            continue
        for tok in _FORBIDDEN_TOKENS:
            assert tok not in low, (
                f"{ctx}: privacy-forbidden token {tok!r} leaked into serialized "
                f"payload (in {text!r})"
            )


def _assert_private(model: Any, ctx: str) -> None:
    """Full privacy assertion over a Pydantic model's dict + JSON serializations."""
    as_dict = model.model_dump()
    _assert_no_forbidden_keys(as_dict, ctx)
    _assert_no_forbidden_value_tokens(as_dict, ctx)
    # The JSON wire form must satisfy the same key guarantee.
    _assert_no_forbidden_keys(json.loads(model.model_dump_json()), ctx)


# ── Safe generators (values drawn from privacy-clean domains) ────────────────

# Hex hash — the only way an image may be referenced (Req 41.6).
_hash = st.text(alphabet="0123456789abcdef", min_size=8, max_size=64)
# Coarse shared labels (exercise categories / model identifiers), never per-user.
_exercise = st.sampled_from(["squat", "deadlift", "bench", "press", "lunge", "row"])
_model = st.sampled_from(["gpt-4o", "gemini-1.5", "llava-next", "qwen-vl"])
_worker = st.builds(lambda n: f"worker-{n}", st.integers(min_value=0, max_value=99))
_nonneg = st.floats(min_value=0.0, max_value=1e6, allow_nan=False, allow_infinity=False)
_unit = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
_pct = st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False)
_count = st.integers(min_value=0, max_value=100_000)
_reason = st.sampled_from(["wrong depth", "bad angle", "misdetect", "occluded"])


@st.composite
def _cost_records(draw) -> CostRecord:
    return CostRecord(
        processing_time_ms=draw(_nonneg),
        gpu_memory_mb=draw(_nonneg),
        vram_usage_mb=draw(_nonneg),
        frame_count=draw(_count),
        model_used=draw(_model),
        token_count=draw(_count),
        estimated_inference_cost=draw(_nonneg),
        worker_id=draw(_worker),
        queue_wait_ms=draw(_nonneg),
    )


@st.composite
def _benchmark_samples(draw) -> BenchmarkSample:
    return BenchmarkSample(
        image_hash=draw(_hash),
        exercise=draw(_exercise),
        prediction=draw(_exercise),
        ground_truth=draw(_exercise),
        confidence=draw(_unit),
        reason=draw(_reason),
        manual_correction=draw(_exercise),
        pipeline_version=draw(st.sampled_from(["2.0.0", "2.1.0"])),
    )


# ══════════════════════════════════════════════════════════════════════════
# Property 63 — CostRecord carries only anonymous aggregates (Req 40.2/40.3/40.4)
# Feature: ai-exercise-analysis, Property 63: The privacy guarantee holds across
# every V2 component.
# Validates: Requirements 40.2, 40.3, 40.4
# ══════════════════════════════════════════════════════════════════════════

@settings(max_examples=_MIN_ITER, deadline=None)
@given(record=_cost_records())
def test_cost_record_has_no_user_video_frame_pose(record: CostRecord) -> None:
    """A CostRecord's serialized payload excludes any user id, video, frame, or
    pose field — only anonymous aggregates (`frame_count` is a count, not frame
    data) (Req 40.2, 40.4). It is a separate analytics artifact never merged
    into the client result (Req 40.3)."""
    _assert_private(record, "CostRecord")
    # No user identity anywhere in the field set (Req 40.2).
    assert "user_id" not in CostRecord.model_fields
    assert "user_id" not in record.model_dump()


# ══════════════════════════════════════════════════════════════════════════
# Property 63 — BenchmarkSample / dataset store an image HASH only (Req 41.6)
# Validates: Requirements 41.6
# ══════════════════════════════════════════════════════════════════════════

@settings(max_examples=_MIN_ITER, deadline=None)
@given(sample=_benchmark_samples())
def test_benchmark_sample_references_hash_only(sample: BenchmarkSample) -> None:
    """A BenchmarkSample references its image by `image_hash` only — never raw
    video / frames / pose (Req 41.6)."""
    _assert_private(sample, "BenchmarkSample")
    dumped = sample.model_dump()
    # The ONLY image reference is the hash; no raw-image field exists.
    assert "image_hash" in dumped
    assert not any(k != "image_hash" and "image" in k.lower() for k in dumped)


@settings(max_examples=_MIN_ITER, deadline=None)
@given(samples=st.lists(_benchmark_samples(), max_size=6))
def test_exported_benchmark_dataset_has_no_media(samples: list[BenchmarkSample]) -> None:
    """An exported `BenchmarkDataset` carries only `BenchmarkSample`s — no
    original video / frames / pose anywhere in the export (Req 41.6)."""
    builder = BenchmarkDatasetBuilder(enabled=True)
    for sample in samples:
        builder.record(sample)

    dataset = builder.export()
    _assert_private(dataset, "BenchmarkDataset")
    assert dataset.sample_count == len(samples)


# ══════════════════════════════════════════════════════════════════════════
# Property 63 — Admin metrics are aggregate-only, no per-user record (Req 46.5/46.6)
# Validates: Requirements 46.5, 46.6
# ══════════════════════════════════════════════════════════════════════════

@st.composite
def _gauges(draw) -> OperationalGauges:
    opt_count = st.one_of(st.none(), _count)
    opt_pct = st.one_of(st.none(), _pct)
    return OperationalGauges(
        queue_length=draw(opt_count),
        worker_utilization_pct=draw(opt_pct),
        gpu_utilization_pct=draw(opt_pct),
        camera_issue_frequency=draw(opt_count),
        retry_count=draw(opt_count),
    )


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    exercise_popularity=st.dictionaries(_exercise, _count, max_size=6),
    model_usage=st.dictionaries(_model, _count, max_size=4),
    gauges=_gauges(),
    avg_conf=st.one_of(st.none(), _unit),
    fail_pct=st.one_of(st.none(), _pct),
)
def test_admin_snapshot_is_aggregate_only(
    exercise_popularity: dict[str, int],
    model_usage: dict[str, int],
    gauges: OperationalGauges,
    avg_conf: float | None,
    fail_pct: float | None,
) -> None:
    """An `AdminMetricsSnapshot` is a closed model of anonymous aggregates: its
    serialized payload contains no user / video / frame / pose key, and its
    category maps key only on coarse shared labels — never a per-user row
    (Req 46.5, 46.6)."""
    snapshot = AdminMetricsSnapshot(
        sample_count=len(exercise_popularity),
        avg_confidence=avg_conf,
        failure_rate_pct=fail_pct,
        exercise_popularity=exercise_popularity,
        queue_length=gauges.queue_length,
        worker_utilization_pct=gauges.worker_utilization_pct,
        gpu_utilization_pct=gauges.gpu_utilization_pct,
        camera_issue_frequency=gauges.camera_issue_frequency,
        retry_count=gauges.retry_count,
        model_usage=model_usage,
    )
    _assert_private(snapshot, "AdminMetricsSnapshot")


@settings(max_examples=_MIN_ITER, deadline=None)
@given(gauges=_gauges())
def test_admin_service_collect_snapshot_is_aggregate_only(gauges: OperationalGauges) -> None:
    """The live `AdminAnalyticsService.collect()` composition (V1 analytics + V2
    cost + gauges) yields an anonymous aggregate snapshot with no user / video /
    frame / pose data (Req 46.5, 46.6)."""
    service = AdminAnalyticsService(
        AnalyticsService(InMemoryAnalyticsSink()),
        CostTrackingService(InMemoryCostSink(), enabled=True),
        gauges_provider=StaticOperationalMetricsProvider(gauges),
        enabled=True,
    )
    snapshot = service.collect()
    _assert_private(snapshot, "AdminAnalyticsService.collect()")


# ══════════════════════════════════════════════════════════════════════════
# Property 63 — Secure temporary storage persists nothing after cleanup (Req 51.4)
# Validates: Requirements 51.4
# ══════════════════════════════════════════════════════════════════════════

@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    job_id=st.text(min_size=1, max_size=12),
    artifacts=st.lists(
        st.tuples(st.text(min_size=1, max_size=8), st.binary(max_size=64)),
        min_size=1,
        max_size=6,
        unique_by=lambda t: t[0],
    ),
)
def test_secure_storage_retains_nothing_after_cleanup(
    job_id: str,
    artifacts: list[tuple[str, bytes]],
) -> None:
    """Every artifact written for a job is volatile and EXCLUDED from persistent
    storage: after `cleanup(job_id)` nothing the job created remains in the
    store, and the reported cleanup is complete (Req 51.4)."""
    store = InMemorySecureArtifactStore()
    service = SecureTemporaryStorageService(store)

    locations = [service.write(aid, data, job_id=job_id) for aid, data in artifacts]
    # Pre-condition: while alive, the artifacts exist only in the volatile store.
    assert all(store.exists(loc) for loc in locations)

    report = asyncio.run(service.cleanup(job_id))

    # A clean run returns a V1 CleanupReport (never a StructuredError here).
    assert isinstance(report, CleanupReport)
    assert report.complete is True
    assert set(report.deleted) == set(locations)
    # Nothing the job created persists — the store and the tracking are empty.
    assert service.locations_for(job_id) == []
    for loc in locations:
        assert not store.exists(loc), f"artifact {loc!r} persisted after cleanup (Req 51.4)"


# ══════════════════════════════════════════════════════════════════════════
# Property 63 — AnalysisResult V2 additive fields introduce no media (Req 52.5)
# Validates: Requirements 52.5
# ══════════════════════════════════════════════════════════════════════════

def _base_v1_result_kwargs() -> dict:
    metrics = ObjectiveMetrics(
        joint_angles={"knee": 90.0},
        bar_path=[[0.5, 0.5]],
        depth=0.5,
        range_of_motion={"knee": 120.0},
        tempo=1.0,
        symmetry=0.9,
        center_of_mass=[0.5, 0.5],
        balance=0.8,
        confidence=0.9,
    )
    reps = RepetitionSummary(
        rep_count=5, phase_timestamps=[], avg_rep_duration_ms=1000.0, movement_consistency=0.8
    )
    return dict(
        exercise_id="squat",
        analysis_date="2024-01-01T00:00:00Z",
        overall_score=88.0,
        movement_score=90.0,
        range_of_motion={"knee": 120.0},
        tempo=1.0,
        stability=0.9,
        symmetry=0.9,
        joint_alignment={"spine": 0.95},
        strengths=["depth"],
        mistakes=[],
        corrections=[],
        safety_warnings=[],
        improvement_tips=[],
        training_advice=[],
        movement_metrics=metrics,
        repetition_summary=reps,
        overall_confidence=0.9,
        low_confidence=False,
        user_corrections=[],
        analysisVersion="2.0.0",
        poseEngineVersion="mediapipe-1.0.0",
        visionModelVersion="v-1.0.0",
        reasoningModelVersion="r-1.0.0",
        pipelineVersion="2.0.0",
    )


@st.composite
def _score_explanations(draw) -> list[ScoreExplanation]:
    weight = st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False)
    factor = st.sampled_from(["range_of_motion", "tempo", "balance", "stability", "symmetry"])
    explanation = st.builds(
        ScoreExplanation,
        score_name=st.sampled_from(["movement", "stability", "symmetry", "tempo"]),
        factors=st.dictionaries(factor, weight, min_size=1, max_size=5),
    )
    return draw(st.lists(explanation, min_size=1, max_size=3))


@settings(max_examples=_MIN_ITER, deadline=None)
@given(
    review_status=st.sampled_from(list(ReviewStatus)),
    explanations=_score_explanations(),
)
def test_analysis_result_v2_fields_introduce_no_media(
    review_status: ReviewStatus,
    explanations: list[ScoreExplanation],
) -> None:
    """The persisted `AnalysisResult` WITH its additive V2 fields set carries no
    original video, frame, or pose data — the additions are derived scalars /
    structures only (Req 52.5)."""
    result = AnalysisResult(
        **_base_v1_result_kwargs(),
        review_status=review_status,
        score_explanations=explanations,
    )
    _assert_private(result, "AnalysisResult(+V2)")

    # The additive keys carry only review status + factor weightings, never media.
    dumped = result.model_dump()
    assert dumped["review_status"] == review_status.value
    for explanation in dumped["score_explanations"]:
        assert set(explanation.keys()) == {"score_name", "factors"}
