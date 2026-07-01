"""
Unit tests for the Frame_Quality_Service (app/analysis/stages/frame_quality.py).

Covers the scoring math, the per-frame retention decision, single-pass
processing, and the BODY_NOT_VISIBLE / CAMERA_TOO_DARK / CAMERA_SHAKING
structured-error paths (Req 4.1-4.5, 15.3, 15.4, 16.3).
"""

import asyncio

from app.analysis.contracts import Frame, FrameSet, QualityScoredFrames, VideoMeta
from app.analysis.stages.frame_quality import (
    QUALITY_METRICS,
    FramePixelSource,
    FrameQualityService,
    FrameSignals,
    StaticFramePixelSource,
    failing_metrics,
    score_frame,
)


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


def _frames(n: int) -> list[Frame]:
    return [Frame(index=i, timestamp_ms=float(i * 100)) for i in range(n)]


def _good_signals() -> FrameSignals:
    """Signals that yield a perfect score on every metric."""
    return FrameSignals(
        sharpness=300.0,
        mean_luminance=200.0,
        luminance_std=90.0,
        motion_magnitude=0.0,
        global_shift=0.0,
        visible_keypoints=1.0,
        occluded_fraction=0.0,
    )


def _run(stage: FrameQualityService, fs: FrameSet):
    return asyncio.run(stage.run(fs))


# ── Scoring math (Req 4.1, 4.2) ──────────────────────────────────────────

def test_score_frame_computes_all_seven_bounded_scores():
    quality = score_frame(_good_signals())
    for metric in QUALITY_METRICS:
        value = getattr(quality, metric)
        assert 0.0 <= value <= 1.0, f"{metric} out of bounds: {value}"
    # Perfect signals saturate every score to 1.0.
    assert quality.blur == 1.0
    assert quality.body_visibility == 1.0
    assert quality.occlusion == 1.0
    assert quality.camera_shake == 1.0


def test_score_frame_inverts_motion_and_shake_and_occlusion():
    # High motion / shift / occlusion must drive the quality scores down.
    signals = FrameSignals(
        sharpness=0.0,
        mean_luminance=0.0,
        luminance_std=0.0,
        motion_magnitude=1000.0,
        global_shift=1000.0,
        visible_keypoints=0.0,
        occluded_fraction=1.0,
    )
    quality = score_frame(signals)
    assert quality.blur == 0.0
    assert quality.brightness == 0.0
    assert quality.contrast == 0.0
    assert quality.motion_blur == 0.0
    assert quality.camera_shake == 0.0
    assert quality.body_visibility == 0.0
    assert quality.occlusion == 0.0


def test_failing_metrics_reports_each_sub_threshold_metric():
    quality = score_frame(_good_signals())
    # Force body_visibility below threshold only.
    quality.body_visibility = 0.1
    thresholds = {m: 0.5 for m in QUALITY_METRICS}
    assert failing_metrics(quality, thresholds) == ["body_visibility"]


# ── Retention decision (Req 4.3, 4.4, 16.3) ──────────────────────────────

def test_retains_frames_meeting_all_thresholds_and_scores_each_once():
    frames = _frames(3)
    source = StaticFramePixelSource({f.index: _good_signals() for f in frames})
    stage = FrameQualityService(source)

    result = _run(stage, FrameSet(frames=frames, source_meta=_meta()))

    assert result.success
    out: QualityScoredFrames = result.output
    # Each input frame scored exactly once (Req 16.3).
    assert len(out.frames) == len(frames)
    assert [sf.frame.index for sf in out.frames] == [0, 1, 2]
    # All meet thresholds → all retained (Req 4.4).
    assert all(sf.retained for sf in out.frames)
    assert len(out.retained) == 3


def test_discards_only_sub_threshold_frames():
    frames = _frames(2)
    blurry = FrameSignals(
        sharpness=1.0,            # blur score ~0.007 → below default 0.3 threshold
        mean_luminance=200.0,
        luminance_std=90.0,
        motion_magnitude=0.0,
        global_shift=0.0,
        visible_keypoints=1.0,
        occluded_fraction=0.0,
    )
    source = StaticFramePixelSource({0: _good_signals(), 1: blurry})
    stage = FrameQualityService(source)

    result = _run(stage, FrameSet(frames=frames, source_meta=_meta()))

    assert result.success
    out = result.output
    assert out.frames[0].retained is True
    assert out.frames[1].retained is False
    assert [sf.frame.index for sf in out.retained] == [0]


# ── BODY_NOT_VISIBLE (Req 4.5) ───────────────────────────────────────────

def test_all_discarded_with_visibility_dominant_emits_body_not_visible():
    frames = _frames(3)
    invisible = FrameSignals(
        sharpness=300.0,
        mean_luminance=200.0,
        luminance_std=90.0,
        motion_magnitude=0.0,
        global_shift=0.0,
        visible_keypoints=0.0,    # body_visibility score 0 → discard, dominant cause
        occluded_fraction=0.0,
    )
    source = StaticFramePixelSource({f.index: invisible for f in frames})
    stage = FrameQualityService(source)

    result = _run(stage, FrameSet(frames=frames, source_meta=_meta()))

    assert not result.success
    assert result.output is None
    assert result.error.code == "BODY_NOT_VISIBLE"
    assert result.error.stage == "frame_quality"


# ── CAMERA_TOO_DARK (Req 15.3) ───────────────────────────────────────────

def test_retained_frames_below_min_brightness_emit_camera_too_dark():
    frames = _frames(2)
    dim = FrameSignals(
        sharpness=300.0,
        mean_luminance=51.0,      # brightness score 0.2
        luminance_std=90.0,
        motion_magnitude=0.0,
        global_shift=0.0,
        visible_keypoints=1.0,
        occluded_fraction=0.0,
    )
    source = StaticFramePixelSource({f.index: dim for f in frames})
    # Brightness must not discard frames here; gate them on the retained mean.
    thresholds = {m: 0.0 for m in QUALITY_METRICS}
    stage = FrameQualityService(source, quality_thresholds=thresholds, min_brightness=0.5)

    result = _run(stage, FrameSet(frames=frames, source_meta=_meta()))

    assert not result.success
    assert result.error.code == "CAMERA_TOO_DARK"
    assert result.error.stage == "frame_quality"


# ── CAMERA_SHAKING (Req 15.4) ────────────────────────────────────────────

def test_retained_frames_above_max_shake_emit_camera_shaking():
    frames = _frames(2)
    shaky = FrameSignals(
        sharpness=300.0,
        mean_luminance=200.0,
        luminance_std=90.0,
        motion_magnitude=0.0,
        global_shift=10.0,        # camera_shake score 0.5 → raw shake 0.5
        visible_keypoints=1.0,
        occluded_fraction=0.0,
    )
    source = StaticFramePixelSource({f.index: shaky for f in frames})
    # Camera shake must not discard frames here; gate them on the retained mean.
    thresholds = {m: 0.0 for m in QUALITY_METRICS}
    stage = FrameQualityService(source, quality_thresholds=thresholds, max_camera_shake=0.2)

    result = _run(stage, FrameSet(frames=frames, source_meta=_meta()))

    assert not result.success
    assert result.error.code == "CAMERA_SHAKING"
    assert result.error.stage == "frame_quality"


# ── Missing pixel data is a fatal domain failure, not a silent zero score ──

def test_missing_pixel_signals_returns_structured_error():
    frames = _frames(2)
    source = StaticFramePixelSource({0: _good_signals()})  # frame 1 missing
    stage = FrameQualityService(source)

    result = _run(stage, FrameSet(frames=frames, source_meta=_meta()))

    assert not result.success
    assert result.error.code == "BODY_NOT_VISIBLE"


def test_static_source_is_a_frame_pixel_source():
    assert isinstance(StaticFramePixelSource({}), FramePixelSource)
