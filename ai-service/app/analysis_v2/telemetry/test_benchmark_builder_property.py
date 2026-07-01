"""
Property test for Stage 40 · Benchmark_Dataset_Builder (Req 41).

Drives `BenchmarkDatasetBuilder` (with a real `InMemoryBenchmarkSink`) across
mixtures of COMPLETE and INCOMPLETE recording attempts so the "all-or-nothing
recording + faithful export + no-video privacy boundary" discipline is asserted
exactly, over many inputs.

Mirrors the established property-test style in this package (`hypothesis`
`@given` + `@settings(max_examples=..., deadline=None)`, smart composite
generators constrained to the meaningful input space).

# Feature: ai-exercise-analysis, Property 47: Benchmark samples are all-or-nothing
# and exports are faithful. For any attempted Benchmark_Sample recording, the
# sample is accepted if and only if every required field (image hash, exercise,
# prediction, ground truth, confidence in [0.0, 1.0], reason, manual correction,
# pipeline version) is present and non-empty; an incomplete sample is rejected
# with the manual correction retained unchanged and an incomplete-data
# indication; and an export returns exactly the set of currently collected
# samples (an empty dataset with a no-samples indication when none exist),
# excluding the original video.
#
# Validates: Requirements 41.1, 41.2, 41.3, 41.4, 41.5, 41.6
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis_v2.models_v2 import BenchmarkSample
from app.analysis_v2.telemetry.benchmark_builder import (
    BenchmarkDataset,
    BenchmarkDatasetBuilder,
    InMemoryBenchmarkSink,
)

# Minimum iterations mandated for these property tests.
_MIN_ITER = 200

# The required, must-be-non-empty string fields (Req 41.2). Confidence is bounded
# structurally by the BenchmarkSample contract, so it is generated valid.
_REQUIRED_STR_FIELDS = (
    "image_hash",
    "exercise",
    "prediction",
    "ground_truth",
    "reason",
    "manual_correction",
    "pipeline_version",
)

# Keys that must NEVER appear on a sample or in the dataset (Req 41.6).
_FORBIDDEN_KEYS = ("video", "frames", "frame", "pose", "pose_images")


# ─────────────────────────────────────────────────────────────────────────
# Smart generators — constrained to the meaningful input space
# ─────────────────────────────────────────────────────────────────────────

# Non-empty (after strip) strings — a valid required field value.
_non_empty_str = st.text(min_size=1, max_size=24).filter(lambda s: s.strip() != "")

# Empty-ish strings — "" or whitespace-only — that make a field incomplete.
_empty_str = st.sampled_from(["", " ", "   ", "\t", "\n", " \t \n "])

_confidence = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)


def _complete_kwargs(draw) -> dict:
    """A fully-populated, valid BenchmarkSample kwargs mapping (every field ok)."""
    return {
        "image_hash": draw(_non_empty_str),
        "exercise": draw(_non_empty_str),
        "prediction": draw(_non_empty_str),
        "ground_truth": draw(_non_empty_str),
        "confidence": draw(_confidence),
        "reason": draw(_non_empty_str),
        "manual_correction": draw(_non_empty_str),
        "pipeline_version": draw(_non_empty_str),
    }


@st.composite
def _record_attempts(draw):
    """
    A mixture of COMPLETE and INCOMPLETE recording attempts.

    Returns a list of ``(sample, is_complete)`` tuples. An incomplete sample is
    produced by emptying (empty or whitespace-only) exactly one random required
    string field of an otherwise-complete sample.
    """
    n = draw(st.integers(min_value=0, max_value=10))
    attempts = []
    for _ in range(n):
        kwargs = _complete_kwargs(draw)
        is_complete = draw(st.booleans())
        if not is_complete:
            # Corrupt exactly one required string field with an empty value.
            field = draw(st.sampled_from(_REQUIRED_STR_FIELDS))
            kwargs[field] = draw(_empty_str)
        attempts.append((BenchmarkSample(**kwargs), is_complete))
    return attempts


def _builder() -> BenchmarkDatasetBuilder:
    """A builder backed by a fresh in-memory sink, explicitly enabled."""
    return BenchmarkDatasetBuilder(sink=InMemoryBenchmarkSink(), enabled=True)


# ─────────────────────────────────────────────────────────────────────────
# Property 47 — all-or-nothing recording + faithful export
# ─────────────────────────────────────────────────────────────────────────

@settings(max_examples=_MIN_ITER, deadline=None)
@given(attempts=_record_attempts())
def test_benchmark_all_or_nothing_and_faithful_export(attempts) -> None:
    """
    For any sequence of record attempts:
      • each COMPLETE sample is accepted and stores EXACTLY ONE sample (Req 41.1);
      • each INCOMPLETE sample is rejected with BENCHMARK_SAMPLE_INCOMPLETE, stores
        nothing, and its manual correction is retained unchanged (Req 41.2, 41.3);
      • export returns exactly the accepted samples in order with correct
        sample_count, and is_empty iff none accepted (Req 41.4, 41.5);
      • no stored/exported sample carries video/frames/pose (Req 41.6).

    # Feature: ai-exercise-analysis, Property 47: Benchmark samples are
    # all-or-nothing and exports are faithful.
    Validates: Requirements 41.1, 41.2, 41.3, 41.4, 41.5, 41.6
    """
    builder = _builder()

    accepted: list[BenchmarkSample] = []
    for sample, is_complete in attempts:
        correction_before = sample.manual_correction
        stored_before = builder.export().sample_count

        result = builder.record(sample)

        if is_complete:
            # Accepted ⇒ success, carries the sample, stores EXACTLY ONE more.
            assert result.success is True
            assert result.output == sample
            assert result.error is None
            accepted.append(sample)
            assert builder.export().sample_count == stored_before + 1
        else:
            # Rejected ⇒ incomplete-data indication, stores NOTHING, correction
            # retained unchanged (sample neither stored nor mutated).
            assert result.success is False
            assert result.error is not None
            assert result.error.code == "BENCHMARK_SAMPLE_INCOMPLETE"
            assert sample.manual_correction == correction_before
            assert builder.export().sample_count == stored_before

    # ── Export is faithful (Req 41.4, 41.5) ──────────────────────────────
    dataset = builder.export()
    assert isinstance(dataset, BenchmarkDataset)

    # Exactly the accepted samples, in insertion order.
    assert dataset.samples == accepted
    assert dataset.sample_count == len(accepted)
    # is_empty iff nothing was accepted.
    assert dataset.is_empty is (len(accepted) == 0)

    # ── Privacy boundary: no video/frames/pose anywhere (Req 41.6) ───────
    dumped = dataset.model_dump()
    for key in _FORBIDDEN_KEYS:
        assert key not in dumped
    for sample in dataset.samples:
        keys = sample.model_dump().keys()
        assert "image_hash" in keys
        for key in _FORBIDDEN_KEYS:
            assert key not in keys
