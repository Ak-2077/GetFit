"""
Property-based tests for the Key_Frame_Selector
(app/analysis/stages/key_frame_selector.py).

Covers design Property 7 — "Key frame selection is bounded, de-duplicated, and
chronological" — using Hypothesis with a minimum of 100 iterations.

The default feature accessor (`default_feature_vector`) derives each frame's
feature vector from its `FrameQuality` scores, so generating varied quality
scores fully controls both the similarity metric and the movement-transition
preference without touching real pixel data.

Validates: Requirements 5.1, 5.2, 5.4
"""

import asyncio
import math

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import (
    Frame,
    FrameQuality,
    QualityScoredFrame,
    QualityScoredFrames,
    VideoMeta,
)
from app.analysis.stages.key_frame_selector import (
    KeyFrameSelector,
    default_feature_vector,
)


# ── Fixed source metadata (irrelevant to the selection logic) ──────────────

def _meta() -> VideoMeta:
    return VideoMeta(
        container_format="mp4",
        codec="h264",
        duration_sec=10.0,
        width=1080,
        height=1920,
        fps=30.0,
        size_bytes=1_000_000,
        orientation="portrait",
    )


# ── Generators ─────────────────────────────────────────────────────────────
# Each frame carries a timestamp (with intentional ties so chronological
# de-duplication is exercised), seven quality scores spanning [0,1] (these feed
# the default feature vector / similarity metric), and a retention flag so the
# selector's "retained-only" precondition is also exercised.

_quality_scores = st.fixed_dictionaries(
    {
        "blur": st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
        "brightness": st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
        "contrast": st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
        "motion_blur": st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
        "camera_shake": st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
        "body_visibility": st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
        "occlusion": st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    }
)

# Timestamps drawn from a small set of discrete values so distinct frames
# frequently collide on the same timestamp, exercising the strictly-increasing
# chronological invariant (Req 5.4).
_timestamps = st.sampled_from([0.0, 100.0, 100.0, 200.0, 300.0, 300.0, 400.0, 500.0])

_frame_record = st.fixed_dictionaries(
    {
        "timestamp_ms": _timestamps,
        "quality": _quality_scores,
        "retained": st.booleans(),
    }
)


def _build_frames(records: list[dict]) -> QualityScoredFrames:
    """Assemble QualityScoredFrames, assigning each frame a unique index."""
    frames = [
        QualityScoredFrame(
            frame=Frame(index=i, timestamp_ms=rec["timestamp_ms"]),
            quality=FrameQuality(**rec["quality"]),
            retained=rec["retained"],
        )
        for i, rec in enumerate(records)
    ]
    return QualityScoredFrames(frames=frames, source_meta=_meta())


def _distance(a, b) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _run(selector: KeyFrameSelector, data: QualityScoredFrames):
    return asyncio.run(selector.run(data))


# ── Property 7 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 7: Key frame selection is bounded,
# de-duplicated, and chronological — for any set of retained quality-scored
# frames and configured maximum, the selected subset has cardinality at most
# the maximum, contains no near-duplicate pair under the similarity metric, and
# preserves strictly increasing chronological order.
@given(
    records=st.lists(_frame_record, min_size=0, max_size=20),
    max_keyframes=st.integers(min_value=1, max_value=40),
    similarity_threshold=st.floats(
        min_value=0.0, max_value=0.5, allow_nan=False, allow_infinity=False
    ),
)
@settings(max_examples=200)
def test_key_frame_selection_bounded_dedup_chronological(
    records, max_keyframes, similarity_threshold
):
    data = _build_frames(records)
    selector = KeyFrameSelector(
        max_keyframes=max_keyframes,
        similarity_threshold=similarity_threshold,
    )

    result = _run(selector, data)

    # The stage never raises on a domain input — it always returns success.
    assert result.success is True
    assert result.error is None
    out = result.output
    assert out is not None
    assert out.source_meta == data.source_meta

    selected = out.frames
    by_index = {qsf.frame.index: qsf for qsf in data.frames}

    # Req 5.1 — the selected subset is bounded by the configured maximum.
    assert len(selected) <= max_keyframes

    # The selection is a genuine subset of the RETAINED input frames only:
    # discarded frames are never selected, and no frame is invented/duplicated.
    selected_indices = [f.index for f in selected]
    assert len(selected_indices) == len(set(selected_indices))  # no duplicates
    for f in selected:
        assert f.index in by_index
        assert by_index[f.index].retained is True
        assert by_index[f.index].frame == f  # carried through unchanged

    # Req 5.4 — timestamps are strictly increasing (hence also no ties).
    timestamps = [f.timestamp_ms for f in selected]
    for earlier, later in zip(timestamps, timestamps[1:]):
        assert earlier < later

    # Req 5.2 — no two selected frames are near-duplicates under the metric:
    # every pairwise feature-vector distance is at least the threshold.
    vectors = [default_feature_vector(by_index[f.index]) for f in selected]
    for a in range(len(vectors)):
        for b in range(a + 1, len(vectors)):
            assert _distance(vectors[a], vectors[b]) >= similarity_threshold
