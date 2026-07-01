"""
Property-based tests for the Abuse_Protection_Service (Req 47).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Hypothesis property tests covering the abuse-protection / exercise-content gate
(`app/analysis_v2/gates/abuse_protection.py`):

  • Property 56 — the gate computes an exercise-content Confidence_Score in
    [0.0, 1.0] before any AI stage and gates the pipeline on it: it passes the
    frames through unchanged (success) iff confidence >= threshold; below the
    threshold OR when classification cannot complete it returns a
    StageResult(success=False) carrying a StructuredError(code
    NOT_EXERCISE_VIDEO, stage "abuse_protection") and no output. The gate never
    raises (Req 47.1, 47.2, 47.3, 47.6).

Run (from ai-service/):
    venv\\Scripts\\python.exe -m pytest app/analysis_v2/gates/test_abuse_protection_property.py
"""

from __future__ import annotations

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import Frame, KeyFrames, VideoMeta
from app.analysis_v2.gates.abuse_protection import (
    AbuseProtectionService,
    StaticContentClassifier,
)

# Minimum number of generated examples per property (task requirement: >= 100).
_MIN_ITER = 150


# ── Shared builders / strategies ─────────────────────────────────────────────

def _make_keyframes(n_frames: int) -> KeyFrames:
    """A minimal, valid KeyFrames input with `n_frames` chronological frames."""
    meta = VideoMeta(
        container_format="mp4",
        codec="h264",
        duration_sec=5.0,
        width=720,
        height=1280,
        fps=30.0,
        size_bytes=1024,
        orientation="portrait",
    )
    frames = [
        Frame(index=i, timestamp_ms=float(i * 100)) for i in range(n_frames)
    ]
    return KeyFrames(frames=frames, source_meta=meta)


# Confidence and threshold both live in the closed unit interval [0.0, 1.0].
_unit = st.floats(
    min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
)
_frame_counts = st.integers(min_value=0, max_value=8)


# ── Property 56 ──────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 56: Abuse protection gates the AI stages by content classification
# Validates: Requirements 47.1, 47.2, 47.3, 47.6

@settings(max_examples=_MIN_ITER, deadline=None)
@given(confidence=_unit, threshold=_unit, n_frames=_frame_counts)
def test_property_56_gate_decision_matches_threshold(
    confidence: float, threshold: float, n_frames: int
) -> None:
    """
    For any exercise-content confidence and configured threshold (both in
    [0,1]): the gate succeeds (frames passed through UNCHANGED) iff
    confidence >= threshold; otherwise it rejects with a StructuredError
    (code NOT_EXERCISE_VIDEO, stage "abuse_protection") and no output
    (Req 47.1, 47.2, 47.3).
    """
    data = _make_keyframes(n_frames)
    gate = AbuseProtectionService(
        StaticContentClassifier(confidence), content_threshold=threshold
    )

    result = asyncio.run(gate.run(data))

    if confidence >= threshold:
        # At or above threshold → pass through unchanged (Req 47.3).
        assert result.success is True
        assert result.error is None
        assert result.output is data  # same frames, unchanged
    else:
        # Below threshold → reject and halt subsequent AI stages (Req 47.2).
        assert result.success is False
        assert result.output is None
        assert result.error is not None
        assert result.error.code == "NOT_EXERCISE_VIDEO"
        assert result.error.stage == "abuse_protection"


@settings(max_examples=_MIN_ITER, deadline=None)
@given(threshold=_unit, n_frames=_frame_counts)
def test_property_56_cannot_classify_is_rejected(
    threshold: float, n_frames: int
) -> None:
    """
    When classification cannot complete (the classifier raises), the gate stops
    the subsequent AI stages and returns a StructuredError (code
    NOT_EXERCISE_VIDEO, stage "abuse_protection") with no output, and NEVER
    raises (Req 47.6).
    """
    data = _make_keyframes(n_frames)
    gate = AbuseProtectionService(
        StaticContentClassifier(None), content_threshold=threshold
    )

    result = asyncio.run(gate.run(data))

    assert result.success is False
    assert result.output is None
    assert result.error is not None
    assert result.error.code == "NOT_EXERCISE_VIDEO"
    assert result.error.stage == "abuse_protection"
