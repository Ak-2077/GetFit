"""
Property-based tests for the Exercise_Detection_Service
(app/analysis/stages/exercise_detection.py).

Covers design Property 8 — "Exercise detection produces ranked, bounded
confidences" — using Hypothesis with a minimum of 100 iterations.

Validates: Requirements 6.1, 6.2
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import Detection, Frame, KeyFrames, VideoMeta
from app.analysis.stages.exercise_detection import (
    ClassifierScore,
    ExerciseDetectionService,
    StaticExerciseClassifier,
)
from app.core.config import settings as cfg_settings

CONFIDENCE_MIN = cfg_settings.DETECTION_CONFIDENCE_MIN

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


# ── Generators ───────────────────────────────────────────────────────────
# Key frames: any chronological subset of frames (the service ignores frame
# contents — it delegates to the injected classifier — so the frame list only
# needs to be a structurally valid KeyFrames input).
def _key_frames(n: int) -> KeyFrames:
    frames = [Frame(index=i, timestamp_ms=float(i) * 100.0) for i in range(n)]
    return KeyFrames(frames=frames, source_meta=META)


key_frames = st.integers(min_value=0, max_value=8).map(_key_frames)

# Candidate classifier outputs: exercise ids paired with confidences spanning
# the full [0, 1] range so generated lists straddle the DETECTION_CONFIDENCE_MIN
# gate on both sides.
_exercise_ids = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyz_", min_size=1, max_size=12
)
_confidences = st.floats(
    min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False
)
classifier_score = st.builds(
    ClassifierScore, exercise_id=_exercise_ids, confidence=_confidences
)
candidate_lists = st.lists(classifier_score, min_size=0, max_size=10)


def _run(service: ExerciseDetectionService, data: KeyFrames):
    return asyncio.run(service.run(data))


# ── Property 8 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 8: Exercise detection produces
# ranked, bounded confidences — for any key frames and any candidate list, when
# the top confidence >= confidence_min the service returns a Detection whose
# confidence is in [0,1] and whose alternatives are sorted non-increasing with
# each confidence in [0,1]; otherwise it returns an EXERCISE_NOT_RECOGNIZED
# error.
@given(frames=key_frames, candidates=candidate_lists)
@settings(max_examples=200)
def test_exercise_detection_produces_ranked_bounded_confidences(frames, candidates):
    service = ExerciseDetectionService(
        StaticExerciseClassifier(candidates),
        confidence_min=CONFIDENCE_MIN,
    )
    result = _run(service, frames)

    # The top confidence determines the accept/reject branch (Req 6.3 gate).
    top_confidence = max((c.confidence for c in candidates), default=None)
    should_detect = top_confidence is not None and top_confidence >= CONFIDENCE_MIN

    assert result.success is should_detect

    if should_detect:
        # Accept branch: a well-formed Detection (Req 6.1, 6.2).
        assert result.error is None
        det = result.output
        assert isinstance(det, Detection)

        # Req 6.1 — detected exercise id with a bounded confidence.
        assert det.exercise_id
        assert 0.0 <= det.confidence <= 1.0
        # The detected confidence is the maximum candidate confidence.
        assert det.confidence == max(c.confidence for c in candidates)

        # Req 6.2 — alternatives sorted non-increasing, each bounded in [0,1].
        alt_confidences = [a["confidence"] for a in det.alternatives]
        for c in alt_confidences:
            assert 0.0 <= c <= 1.0
        assert alt_confidences == sorted(alt_confidences, reverse=True)

        # The detected confidence dominates every alternative (it is the top of
        # the ranked list).
        for c in alt_confidences:
            assert det.confidence >= c

        # Detection + alternatives account for every candidate exactly once.
        assert len(det.alternatives) == len(candidates) - 1
    else:
        # Reject branch (Req 6.3): no candidate cleared the threshold (or the
        # list was empty) → EXERCISE_NOT_RECOGNIZED, no output leaks.
        assert result.output is None
        assert result.error is not None
        assert result.error.code == "EXERCISE_NOT_RECOGNIZED"
        assert result.error.stage == "exercise_detection"
