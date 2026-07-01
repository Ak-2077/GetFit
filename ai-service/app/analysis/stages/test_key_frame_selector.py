"""
Unit tests for the Key_Frame_Selector (Stage 4).

Covers the four acceptance criteria of Requirement 5:
  • 5.1 bounded subset (count <= MAX_KEYFRAMES)
  • 5.2 near-duplicate removal
  • 5.3 movement-transition preference over static frames
  • 5.4 strictly increasing chronological order
plus edge cases (empty input, discarded frames, timestamp ties).
"""

import asyncio

from app.analysis.contracts import (
    Frame,
    FrameQuality,
    KeyFrames,
    QualityScoredFrame,
    QualityScoredFrames,
    VideoMeta,
)
from app.analysis.stages.key_frame_selector import (
    KeyFrameSelector,
    default_feature_vector,
)

META = VideoMeta(
    container_format="mp4",
    codec="h264",
    duration_sec=10.0,
    width=1080,
    height=1920,
    fps=30.0,
    size_bytes=1_000_000,
    orientation="portrait",
)


def _qsf(index: int, ts: float, *, retained: bool = True, fill: float = 0.5) -> QualityScoredFrame:
    """Build a QualityScoredFrame with uniform quality scores set to `fill`."""
    return QualityScoredFrame(
        frame=Frame(index=index, timestamp_ms=ts),
        quality=FrameQuality(
            blur=fill,
            brightness=fill,
            contrast=fill,
            motion_blur=fill,
            camera_shake=fill,
            body_visibility=fill,
            occlusion=fill,
        ),
        retained=retained,
    )


def _run(selector: KeyFrameSelector, data: QualityScoredFrames) -> KeyFrames:
    result = asyncio.run(selector.run(data))
    assert result.success is True
    assert result.error is None
    assert result.output is not None
    return result.output


def test_empty_input_returns_empty_keyframes():
    selector = KeyFrameSelector()
    out = _run(selector, QualityScoredFrames(frames=[], source_meta=META))
    assert out.frames == []
    assert out.source_meta == META


def test_discarded_frames_are_excluded():
    # Two retained, one discarded (retained=False) with a distinct feature.
    frames = [
        _qsf(0, 0.0, fill=0.1),
        _qsf(1, 100.0, fill=0.9, retained=False),
        _qsf(2, 200.0, fill=0.5),
    ]
    out = _run(KeyFrameSelector(), QualityScoredFrames(frames=frames, source_meta=META))
    kept_indices = [f.index for f in out.frames]
    assert 1 not in kept_indices


def test_subset_is_bounded_by_max_keyframes():
    # 50 distinct frames, bound of 10.
    frames = [_qsf(i, float(i * 100), fill=(i % 13) / 13.0) for i in range(50)]
    selector = KeyFrameSelector(max_keyframes=10, similarity_threshold=0.0)
    out = _run(selector, QualityScoredFrames(frames=frames, source_meta=META))
    assert len(out.frames) <= 10


def test_output_is_strictly_increasing_chronologically():
    frames = [
        _qsf(0, 300.0, fill=0.1),
        _qsf(1, 100.0, fill=0.5),
        _qsf(2, 200.0, fill=0.9),
        _qsf(3, 100.0, fill=0.2),  # timestamp tie with index 1
    ]
    out = _run(
        KeyFrameSelector(similarity_threshold=0.0),
        QualityScoredFrames(frames=frames, source_meta=META),
    )
    ts = [f.timestamp_ms for f in out.frames]
    assert ts == sorted(ts)
    assert len(ts) == len(set(ts))  # strictly increasing -> no duplicate timestamps


def test_near_duplicates_are_removed():
    # All frames have identical quality vectors -> all near-duplicates.
    frames = [_qsf(i, float(i * 100), fill=0.5) for i in range(8)]
    selector = KeyFrameSelector(similarity_threshold=0.05)
    out = _run(selector, QualityScoredFrames(frames=frames, source_meta=META))
    # Only one representative should survive de-duplication.
    assert len(out.frames) == 1


def test_no_near_duplicate_pair_in_output():
    # Mix of duplicate clusters; assert pairwise distances respect the threshold.
    fills = [0.10, 0.10, 0.10, 0.60, 0.60, 0.95]
    frames = [_qsf(i, float(i * 100), fill=f) for i, f in enumerate(fills)]
    threshold = 0.05
    selector = KeyFrameSelector(similarity_threshold=threshold)
    out = _run(selector, QualityScoredFrames(frames=frames, source_meta=META))

    # Reconstruct feature vectors for the kept frames and verify pairwise.
    by_index = {qsf.frame.index: qsf for qsf in frames}
    vecs = [default_feature_vector(by_index[f.index]) for f in out.frames]
    for a in range(len(vecs)):
        for b in range(a + 1, len(vecs)):
            dist = sum((x - y) ** 2 for x, y in zip(vecs[a], vecs[b])) ** 0.5
            assert dist >= threshold


def test_prefers_movement_transitions_over_static():
    # Frames 0-4 are static (identical), frames 5,6 are strong transitions.
    # With a bound of 2 and no de-dup, the two transition frames must win.
    frames = [
        _qsf(0, 0.0, fill=0.50),
        _qsf(1, 100.0, fill=0.50),
        _qsf(2, 200.0, fill=0.50),
        _qsf(3, 300.0, fill=0.50),
        _qsf(4, 400.0, fill=0.50),
        _qsf(5, 500.0, fill=0.05),  # large change vs neighbours -> transition
        _qsf(6, 600.0, fill=0.95),  # large change vs neighbours -> transition
    ]
    selector = KeyFrameSelector(max_keyframes=2, similarity_threshold=0.0)
    out = _run(selector, QualityScoredFrames(frames=frames, source_meta=META))
    kept = {f.index for f in out.frames}
    assert kept == {5, 6}


def test_custom_feature_accessor_is_used():
    # Inject an accessor keyed off the frame index so behaviour is predictable.
    frames = [_qsf(i, float(i * 100), fill=0.5) for i in range(5)]

    def accessor(qsf):
        return (float(qsf.frame.index),)

    # Threshold 1.5 -> consecutive indices (distance 1.0) are near-duplicates.
    selector = KeyFrameSelector(similarity_threshold=1.5, feature_fn=accessor)
    out = _run(selector, QualityScoredFrames(frames=frames, source_meta=META))
    kept = [f.index for f in out.frames]
    # Greedy keeps 0, skips 1, keeps 2 (dist 2.0 from 0), skips 3, keeps 4.
    assert kept == [0, 2, 4]
