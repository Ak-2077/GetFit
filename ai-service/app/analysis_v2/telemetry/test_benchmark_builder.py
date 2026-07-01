"""
Unit tests for the Benchmark_Dataset_Builder (Stage 40, Req 41).

Example-based coverage of the acceptance criteria; the universal property is
covered separately by the property test (Property 47, task 23.4).
"""

from __future__ import annotations

import pytest

from app.analysis_v2.models_v2 import BenchmarkSample
from app.analysis_v2.telemetry.benchmark_builder import (
    BENCHMARK_SINK_NAMES,
    BenchmarkDataset,
    BenchmarkDatasetBuilder,
    InMemoryBenchmarkSink,
    build_benchmark_sink_registry,
)


def _complete_sample(**overrides) -> BenchmarkSample:
    base = dict(
        image_hash="abc123",
        exercise="squat",
        prediction="pushup",
        ground_truth="squat",
        confidence=0.42,
        reason="pose keypoints matched a squat",
        manual_correction="squat",
        pipeline_version="v2.0.0",
    )
    base.update(overrides)
    return BenchmarkSample(**base)


def test_records_exactly_one_sample_per_correction():
    # Req 41.1: one accepted correction -> exactly one stored sample.
    builder = BenchmarkDatasetBuilder(sink=InMemoryBenchmarkSink(), enabled=True)
    result = builder.record(_complete_sample())

    assert result.success is True
    assert result.output == _complete_sample()
    assert builder.export().sample_count == 1


@pytest.mark.parametrize(
    "empty_field",
    [
        "image_hash",
        "exercise",
        "prediction",
        "ground_truth",
        "reason",
        "manual_correction",
        "pipeline_version",
    ],
)
def test_rejects_incomplete_sample_and_retains_correction(empty_field):
    # Req 41.2/41.3: any missing/empty required field -> rejected with the
    # incomplete error code, nothing stored, correction retained unchanged.
    builder = BenchmarkDatasetBuilder(sink=InMemoryBenchmarkSink(), enabled=True)
    # Whitespace-only counts as empty; for manual_correction use "" directly.
    empty_value = "" if empty_field == "manual_correction" else "   "
    sample = _complete_sample(**{empty_field: empty_value})
    correction_before = sample.manual_correction

    result = builder.record(sample)

    assert result.success is False
    assert result.error is not None
    assert result.error.code == "BENCHMARK_SAMPLE_INCOMPLETE"
    # The rejected sample is neither stored nor mutated: the manual correction
    # it carries is retained exactly as supplied (Req 41.3).
    assert sample.manual_correction == correction_before
    assert builder.export().sample_count == 0


def test_export_returns_all_collected_samples():
    # Req 41.4: export returns every collected sample as one dataset.
    builder = BenchmarkDatasetBuilder(sink=InMemoryBenchmarkSink(), enabled=True)
    builder.record(_complete_sample(image_hash="h1"))
    builder.record(_complete_sample(image_hash="h2"))

    dataset = builder.export()

    assert isinstance(dataset, BenchmarkDataset)
    assert dataset.sample_count == 2
    assert dataset.is_empty is False
    assert [s.image_hash for s in dataset.samples] == ["h1", "h2"]


def test_export_with_no_samples_is_empty_with_indication():
    # Req 41.5: export while none collected -> empty dataset + no-samples flag.
    builder = BenchmarkDatasetBuilder(sink=InMemoryBenchmarkSink(), enabled=True)

    dataset = builder.export()

    assert dataset.sample_count == 0
    assert dataset.samples == []
    assert dataset.is_empty is True


def test_sample_and_dataset_carry_no_video_field():
    # Req 41.6: no original video anywhere — the sample references image by hash
    # only, and both contracts forbid extra fields.
    builder = BenchmarkDatasetBuilder(sink=InMemoryBenchmarkSink(), enabled=True)
    builder.record(_complete_sample())
    dataset = builder.export()

    dumped = dataset.model_dump()
    assert "video" not in dumped
    for sample in dataset.samples:
        keys = sample.model_dump().keys()
        assert "video" not in keys and "frames" not in keys and "pose" not in keys
        assert "image_hash" in keys

    # extra="forbid" prevents attaching a video field to a sample.
    with pytest.raises(Exception):
        BenchmarkSample(
            image_hash="h",
            exercise="squat",
            prediction="squat",
            ground_truth="squat",
            confidence=0.5,
            reason="r",
            manual_correction="squat",
            pipeline_version="v2",
            video=b"raw-bytes",
        )


def test_disabled_builder_is_a_noop():
    # Gating: BENCHMARK_ENABLED false -> nothing stored, no error raised.
    builder = BenchmarkDatasetBuilder(sink=InMemoryBenchmarkSink(), enabled=False)

    result = builder.record(_complete_sample())

    assert result.success is False
    assert result.error is None
    assert builder.export().is_empty is True


def test_sink_registry_exposes_in_memory_backend():
    registry = build_benchmark_sink_registry()
    assert set(registry) == set(BENCHMARK_SINK_NAMES)
    assert isinstance(registry["in_memory"], InMemoryBenchmarkSink)
