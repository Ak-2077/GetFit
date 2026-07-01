"""
Property-based tests for the Video_Validation_Service
(app/analysis/stages/video_validation.py).

Covers design Property 4 — "Validation reports exactly the violated
constraints" — using Hypothesis with a minimum of 100 iterations.

Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import VideoMeta
from app.analysis.stages.video_validation import (
    CORRUPTED_VIDEO,
    INVALID_FRAME_RATE,
    INVALID_RESOLUTION,
    LANDSCAPE,
    PORTRAIT,
    UNSUPPORTED_CODEC,
    UNSUPPORTED_FORMAT,
    VIDEO_TOO_LARGE,
    VIDEO_TOO_LONG,
    VIDEO_TOO_SHORT,
    VideoValidationService,
)
from app.core.config import settings as cfg_settings


# ── Generators ───────────────────────────────────────────────────────────
# Smart generators that straddle every configured bound so both the satisfied
# and violated side of each constraint is exercised, plus the empty/whitespace
# values that mark an undecodable (corrupted) video.

_FORMATS = st.sampled_from(
    ["mp4", "mov", "MP4", "MOV", "avi", "mkv", "webm", "", "   "]
)
_CODECS = st.sampled_from(
    ["h264", "hevc", "H264", "HEVC", "vp9", "av1", "mpeg4", "", "   "]
)
# Durations straddle MIN_DURATION_SEC (2.0) and MAX_DURATION_SEC (60.0).
_DURATIONS = st.floats(min_value=0.0, max_value=120.0, allow_nan=False, allow_infinity=False)
# Dimensions straddle MIN/MAX width & height (240 .. 3840).
_DIMS = st.integers(min_value=1, max_value=5000)
# Frame rates straddle MIN_FPS (10.0) and MAX_FPS (120.0).
_FPS = st.floats(min_value=0.1, max_value=240.0, allow_nan=False, allow_infinity=False)
# Sizes straddle MAX_SIZE_BYTES (~200 MiB).
_SIZES = st.integers(min_value=0, max_value=400_000_000)

video_meta = st.builds(
    VideoMeta,
    container_format=_FORMATS,
    codec=_CODECS,
    duration_sec=_DURATIONS,
    width=_DIMS,
    height=_DIMS,
    fps=_FPS,
    size_bytes=_SIZES,
    orientation=st.just("unknown"),  # placeholder; recomputed on success
)


# ── Oracle: the set of codes that SHOULD be reported for a VideoMeta ───────
# Computed independently from the configured thresholds, mirroring the spec'd
# constraints rather than the implementation's control flow.

def _expected_codes(meta: VideoMeta) -> set[str]:
    cfg = cfg_settings

    # Req 2.6 — an undecodable video short-circuits every other check.
    if not meta.container_format.strip() or not meta.codec.strip():
        return {CORRUPTED_VIDEO}

    codes: set[str] = set()

    if meta.container_format.strip().lower() not in {f.lower() for f in cfg.SUPPORTED_FORMATS}:
        codes.add(UNSUPPORTED_FORMAT)
    if meta.codec.strip().lower() not in {c.lower() for c in cfg.SUPPORTED_CODECS}:
        codes.add(UNSUPPORTED_CODEC)
    if meta.duration_sec < cfg.MIN_DURATION_SEC:
        codes.add(VIDEO_TOO_SHORT)
    elif meta.duration_sec > cfg.MAX_DURATION_SEC:
        codes.add(VIDEO_TOO_LONG)
    if not (cfg.MIN_WIDTH <= meta.width <= cfg.MAX_WIDTH) or not (
        cfg.MIN_HEIGHT <= meta.height <= cfg.MAX_HEIGHT
    ):
        codes.add(INVALID_RESOLUTION)
    if not (cfg.MIN_FPS <= meta.fps <= cfg.MAX_FPS):
        codes.add(INVALID_FRAME_RATE)
    if meta.size_bytes > cfg.MAX_SIZE_BYTES:
        codes.add(VIDEO_TOO_LARGE)

    return codes


def _reported_codes(result) -> set[str]:
    """The exact set of constraint codes carried by a StageResult.

    On success the set is empty. On failure the aggregated `details` list
    carries one entry per violated constraint; the corrupted short-circuit
    reports a single top-level code with no details.
    """
    if result.success:
        return set()
    err = result.error
    if err.details:
        return {d.code for d in err.details}
    return {err.code}


def _run(meta: VideoMeta):
    return asyncio.run(VideoValidationService().run(meta))


# ── Property 4 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 4: Validation reports exactly the
# violated constraints — for any VideoMeta, the Video_Validation_Service
# returns success carrying the metadata iff every constraint is satisfied;
# otherwise the set of returned error codes equals exactly the set of codes for
# the violated constraints, and orientation is recorded on success.
@given(meta=video_meta)
@settings(max_examples=200)
def test_validation_reports_exactly_violated_constraints(meta: VideoMeta):
    result = _run(meta)
    expected = _expected_codes(meta)

    # The reported codes are EXACTLY the violated-constraint codes.
    assert _reported_codes(result) == expected

    # Success iff (and only iff) no constraint is violated (Req 2.10, 2.11).
    assert result.success is (len(expected) == 0)

    if result.success:
        # On success the detected metadata is carried through unchanged except
        # that orientation is recorded (Req 2.5, 2.11).
        assert result.error is None
        out = result.output
        assert out is not None
        expected_orientation = LANDSCAPE if meta.width >= meta.height else PORTRAIT
        assert out.orientation == expected_orientation
        assert out.orientation in (LANDSCAPE, PORTRAIT)
        # Every other field is preserved verbatim.
        assert out.model_dump(exclude={"orientation"}) == meta.model_dump(
            exclude={"orientation"}
        )
    else:
        # On failure no output leaks and the error is attributed to the stage.
        assert result.output is None
        assert result.error is not None
        assert result.error.stage == "video_validation"
