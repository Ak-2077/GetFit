"""
Property-based tests for the Pose_Confidence_Validator
(app/analysis/stages/pose_confidence_validator.py).

Covers design Property 16 — "Pose-confidence filtering retains exactly
above-threshold landmarks" — using Hypothesis with a minimum of 100 iterations.

Validates: Requirements 21.2, 21.4
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import (
    FrameLandmarks,
    Landmark,
    Landmarks,
    VideoMeta,
)
from app.analysis.stages.pose_confidence_validator import (
    LOW_CONFIDENCE,
    PoseConfidenceValidator,
)


# ── Generators ───────────────────────────────────────────────────────────
# Smart generators that straddle the per-landmark and overall thresholds so
# both retained/rejected landmarks and pass/fail overall gating are exercised.

# A single normalized landmark with a confidence spanning the full [0,1] range
# so it lands both below and at/above any threshold in the same span.
_landmark = st.builds(
    Landmark,
    x=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    y=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    z=st.floats(min_value=-1.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    confidence=st.floats(
        min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
    ),
)

# A per-frame entry: 0..8 landmarks (include the empty-frame edge case) plus an
# overall_confidence that straddles the overall gate.
_frame = st.builds(
    FrameLandmarks,
    timestamp_ms=st.floats(
        min_value=0.0, max_value=60_000.0, allow_nan=False, allow_infinity=False
    ),
    landmarks=st.lists(_landmark, min_size=0, max_size=8),
    overall_confidence=st.floats(
        min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
    ),
)

# A fixed, valid source_meta carried through unchanged by the stage.
_SOURCE_META = VideoMeta(
    container_format="mp4",
    codec="h264",
    duration_sec=10.0,
    width=1080,
    height=1920,
    fps=30.0,
    size_bytes=10_000_000,
    orientation="portrait",
)

landmarks = st.builds(
    Landmarks,
    frames=st.lists(_frame, min_size=0, max_size=6),
    source_meta=st.just(_SOURCE_META),
    pose_engine=st.sampled_from(["mediapipe", "movenet", "blazepose", ""]),
)

# Thresholds straddle the landmark confidences so filtering retains/rejects a
# meaningful mix across examples.
_threshold = st.floats(
    min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
)


# ── Oracle ─────────────────────────────────────────────────────────────────
# Computed independently from the configured thresholds, mirroring the spec'd
# behaviour rather than the implementation's control flow.

def _expected_overall(
    data: Landmarks, landmark_min: float
) -> float:
    """Mean per-frame overall_confidence after per-landmark filtering.

    Degenerate cases (no frames, or every frame empty post-filter) are treated
    as low confidence (0.0), matching the design edge case.
    """
    frames = data.frames
    if not frames:
        return 0.0
    if all(
        all(lm.confidence < landmark_min for lm in fl.landmarks)
        for fl in frames
    ):
        # every retained-landmarks list is empty
        return 0.0
    return sum(fl.overall_confidence for fl in frames) / len(frames)


def _run(data: Landmarks, landmark_min: float, overall_min: float):
    stage = PoseConfidenceValidator(
        landmark_confidence_min=landmark_min,
        overall_confidence_min=overall_min,
    )
    return asyncio.run(stage.run(data))


# ── Property 16 ──────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 16: Pose-confidence filtering retains
# exactly above-threshold landmarks — for any Landmarks and configured
# per-landmark threshold, on success each output frame retains exactly the
# landmarks whose Pose_Confidence is at/above the threshold (input unmutated);
# when the overall confidence is below the overall threshold the stage returns a
# LOW_CONFIDENCE Structured_Error and no output reaches downstream stages.
@given(data=landmarks, landmark_min=_threshold, overall_min=_threshold)
@settings(max_examples=200)
def test_pose_confidence_filtering_retains_exactly_above_threshold(
    data: Landmarks, landmark_min: float, overall_min: float
):
    # Snapshot the input to assert it is never mutated (additive operation).
    before = data.model_dump()

    result = _run(data, landmark_min, overall_min)

    expected_overall = _expected_overall(data, landmark_min)
    should_pass = expected_overall >= overall_min

    # Input is never mutated regardless of outcome.
    assert data.model_dump() == before

    assert result.success is should_pass

    if not should_pass:
        # Below the overall gate (Req 21.4): no output reaches the
        # Biomechanics_Service and a LOW_CONFIDENCE error is surfaced (Req 21.3).
        assert result.output is None
        assert result.error is not None
        assert result.error.code == LOW_CONFIDENCE
        assert result.error.stage == "pose_confidence_validation"
        return

    # On success (Req 21.2): each output frame retains EXACTLY the landmarks at
    # or above the per-landmark threshold, in original order.
    assert result.error is None
    out = result.output
    assert out is not None
    assert len(out.frames) == len(data.frames)

    for out_fl, in_fl in zip(out.frames, data.frames):
        expected_retained = [
            lm for lm in in_fl.landmarks if lm.confidence >= landmark_min
        ]
        # Exactly the above-threshold landmarks are retained (and unchanged).
        assert out_fl.landmarks == expected_retained
        # Every retained landmark meets the threshold; none below it survives.
        assert all(lm.confidence >= landmark_min for lm in out_fl.landmarks)
        # Per-frame metadata is preserved.
        assert out_fl.timestamp_ms == in_fl.timestamp_ms
        assert out_fl.overall_confidence == in_fl.overall_confidence

    # Source metadata and engine identifier flow through unchanged.
    assert out.source_meta == data.source_meta
    assert out.pose_engine == data.pose_engine
