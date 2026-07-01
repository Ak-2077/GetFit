"""
Property-based tests for the Frame_Quality_Service
(app/analysis/stages/frame_quality.py).

Covers design Property 6 — "Quality scoring is complete and discards exactly
sub-threshold frames" — using Hypothesis with a minimum of 100 iterations.

A `StaticFramePixelSource` is injected with generated `FrameSignals` so the
test fully controls every per-frame score without touching real pixel data.

Validates: Requirements 4.1, 4.2, 4.3, 4.4, 16.3
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import Frame, FrameSet, QualityScoredFrames, VideoMeta
from app.analysis.stages.frame_quality import (
    QUALITY_METRICS,
    FrameQualityService,
    FrameSignals,
    StaticFramePixelSource,
    failing_metrics,
    score_frame,
)


# ── Fixed source metadata (irrelevant to the quality math) ─────────────────

def _meta() -> VideoMeta:
    return VideoMeta(
        container_format="mp4",
        codec="h264",
        duration_sec=5.0,
        width=1080,
        height=1920,
        fps=30.0,
        size_bytes=1_000_000,
        orientation="portrait",
    )


# ── Generators ─────────────────────────────────────────────────────────────
# Raw signals are generated across (and a little beyond) each normalization
# reference so the resulting normalized scores span the full [0,1] range and
# straddle every plausible threshold — exercising both the retained and the
# discarded side of every metric.

_frame_signals = st.builds(
    FrameSignals,
    sharpness=st.floats(min_value=0.0, max_value=400.0, allow_nan=False, allow_infinity=False),
    mean_luminance=st.floats(min_value=0.0, max_value=300.0, allow_nan=False, allow_infinity=False),
    luminance_std=st.floats(min_value=0.0, max_value=120.0, allow_nan=False, allow_infinity=False),
    motion_magnitude=st.floats(min_value=0.0, max_value=50.0, allow_nan=False, allow_infinity=False),
    global_shift=st.floats(min_value=0.0, max_value=40.0, allow_nan=False, allow_infinity=False),
    visible_keypoints=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    occluded_fraction=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
)

# Per-metric thresholds anywhere in [0, 0.9]. Capped below 1.0 so the
# guaranteed-perfect frame (all scores 1.0) is always retained, keeping the
# success path (and therefore the full scored set) observable.
_thresholds = st.fixed_dictionaries(
    {m: st.floats(min_value=0.0, max_value=0.9, allow_nan=False, allow_infinity=False)
     for m in QUALITY_METRICS}
)


def _perfect_signals() -> FrameSignals:
    """Signals whose normalized scores all saturate to 1.0 (passes any <1 threshold)."""
    return FrameSignals(
        sharpness=300.0,       # /150 → clamp 1.0
        mean_luminance=255.0,  # /255 → 1.0
        luminance_std=100.0,   # /64  → clamp 1.0
        motion_magnitude=0.0,  # 1-0  → 1.0
        global_shift=0.0,      # 1-0  → 1.0
        visible_keypoints=1.0,
        occluded_fraction=0.0,  # 1-0  → 1.0
    )


def _frameset_from(signals_list: list[FrameSignals]) -> tuple[FrameSet, StaticFramePixelSource]:
    frames = [Frame(index=i, timestamp_ms=float(i * 100)) for i in range(len(signals_list))]
    source = StaticFramePixelSource({f.index: s for f, s in zip(frames, signals_list)})
    return FrameSet(frames=frames, source_meta=_meta()), source


def _run(stage: FrameQualityService, fs: FrameSet):
    return asyncio.run(stage.run(fs))


# ── Property 6 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 6: Quality scoring is complete and
# discards exactly sub-threshold frames — for any FrameSet and configured
# thresholds, every scored frame carries all seven quality fields, the retained
# set equals exactly those frames meeting all thresholds, and every discarded
# frame fails at least one threshold.
@given(extra=st.lists(_frame_signals, min_size=0, max_size=8), thresholds=_thresholds)
@settings(max_examples=200)
def test_quality_scoring_complete_and_exact_partition(extra, thresholds):
    # Prepend a guaranteed-perfect frame so at least one frame is always
    # retained, keeping the success path observable for the partition assertion.
    signals_list = [_perfect_signals()] + list(extra)
    fs, source = _frameset_from(signals_list)

    # Disable the retained-frame brightness/shake aggregate gates so they cannot
    # mask the partition under test (those gates are Property-15 territory).
    stage = FrameQualityService(
        source,
        quality_thresholds=thresholds,
        min_brightness=0.0,
        max_camera_shake=1.0,
    )

    result = _run(stage, fs)

    # At least the perfect frame is retained → success with full scored set.
    assert result.success, "expected success when a guaranteed-good frame is present"
    out: QualityScoredFrames = result.output

    # Every input frame is scored exactly once, in order (Req 16.3).
    assert len(out.frames) == len(signals_list)
    assert [sf.frame.index for sf in out.frames] == list(range(len(signals_list)))

    for scored, raw in zip(out.frames, signals_list):
        quality = scored.quality

        # Completeness: all seven quality fields present and bounded (Req 4.1, 4.2).
        for metric in QUALITY_METRICS:
            value = getattr(quality, metric)
            assert value is not None, f"missing quality field {metric}"
            assert 0.0 <= value <= 1.0, f"{metric} out of bounds: {value}"

        # Scores match the pure scoring math for the injected signals.
        assert quality == score_frame(raw)

        # Exact partition: retained iff every metric meets its threshold (Req 4.3).
        failed = failing_metrics(quality, thresholds)
        meets_all = not failed
        assert scored.retained is meets_all

        # Discarded frames fail at least one threshold (Req 4.3).
        if not scored.retained:
            assert failed, "a discarded frame must fail at least one threshold"
            for metric in failed:
                assert getattr(quality, metric) < thresholds[metric]

        # Retained frames meet every threshold (Req 4.4).
        if scored.retained:
            for metric in QUALITY_METRICS:
                assert getattr(quality, metric) >= thresholds[metric]

    # The retained view equals exactly the frames flagged retained=True.
    assert out.retained == [sf for sf in out.frames if sf.retained]
    assert len(out.retained) >= 1


# ── All-discarded error path ───────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 6: Quality scoring is complete and
# discards exactly sub-threshold frames — the all-discarded boundary: when
# every frame fails a threshold, the stage returns no output and a structured
# recording error rather than an empty success.
_DISCARD_CODES = {"BODY_NOT_VISIBLE", "CAMERA_TOO_DARK", "CAMERA_SHAKING"}

# Signals whose body_visibility score is guaranteed below the default 0.5
# threshold, so every frame is discarded regardless of the other metrics.
_invisible_signals = st.builds(
    FrameSignals,
    sharpness=st.floats(min_value=200.0, max_value=400.0, allow_nan=False, allow_infinity=False),
    mean_luminance=st.floats(min_value=150.0, max_value=255.0, allow_nan=False, allow_infinity=False),
    luminance_std=st.floats(min_value=80.0, max_value=120.0, allow_nan=False, allow_infinity=False),
    motion_magnitude=st.just(0.0),
    global_shift=st.just(0.0),
    visible_keypoints=st.floats(min_value=0.0, max_value=0.4, allow_nan=False, allow_infinity=False),
    occluded_fraction=st.just(0.0),
)


@given(signals_list=st.lists(_invisible_signals, min_size=1, max_size=8))
@settings(max_examples=100)
def test_all_discarded_returns_structured_error(signals_list):
    fs, source = _frameset_from(signals_list)
    stage = FrameQualityService(source)  # default thresholds → body_visibility 0.5

    result = _run(stage, fs)

    assert not result.success
    assert result.output is None
    assert result.error.code in _DISCARD_CODES
    assert result.error.stage == "frame_quality"
