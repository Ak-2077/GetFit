"""
Property-based tests for the Frame_Extraction_Service
(app/analysis/stages/frame_extraction.py).

Covers design Property 5 — "Frame extraction count and timestamps match the
sampling strategy" — using Hypothesis with a minimum of 100 iterations.

Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6
"""

import asyncio
import math

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import VideoMeta
from app.analysis.stages.frame_extraction import FrameExtractionService
from app.core.config import settings as cfg_settings


# ── Generators ───────────────────────────────────────────────────────────
# Smart generators over the strategy input space covered by Property 5
# (every | every_n | every_ms — adaptive is Req 3.5, outside this property).
# Durations and frame rates straddle the small-N region (so the 0-frame and
# single-frame edges are exercised) up to realistic recording lengths, and the
# sampling parameters span fine and coarse subsampling.

_STRATEGIES = st.sampled_from(["every", "every_n", "every_ms"])
# Duration includes the degenerate 0s case (→ 0 frames) up to the max bound.
_DURATIONS = st.floats(min_value=0.0, max_value=60.0, allow_nan=False, allow_infinity=False)
# Frame rates straddle the configured MIN_FPS (10) .. MAX_FPS (120) band.
_FPS = st.floats(min_value=1.0, max_value=120.0, allow_nan=False, allow_infinity=False)
# "every N frames" subsample factor (Req 3.3).
_SAMPLE_N = st.integers(min_value=1, max_value=50)
# "every X ms" interval (Req 3.4); strictly positive so duration/X is defined.
_SAMPLE_MS = st.floats(min_value=1.0, max_value=2000.0, allow_nan=False, allow_infinity=False)

video_meta = st.builds(
    VideoMeta,
    container_format=st.just("mp4"),
    codec=st.just("h264"),
    duration_sec=_DURATIONS,
    width=st.just(1080),
    height=st.just(1920),
    fps=_FPS,
    size_bytes=st.just(1_000_000),
    orientation=st.just("portrait"),
)


# ── Oracle: the deterministic frame count implied by the strategy ──────────
# Re-derived from the spec's strategy formulas (design Property 5) rather than
# the service's control flow. The decoder's frame count is round(duration*fps)
# (DefaultFrameDecoder); a video of N frames yields:
#   • every    → N                            (Req 3.2)
#   • every_n  → ceil(N / N_step)             (Req 3.3)
#   • every_ms → ceil(duration_ms / X)        (Req 3.4)

def _n_frames(meta: VideoMeta) -> int:
    return max(0, round(meta.duration_sec * meta.fps))


def _expected_count(strategy: str, meta: VideoMeta, sample_n: int, sample_ms: float) -> int:
    n = _n_frames(meta)
    if n <= 0:
        # No decodable frames → nothing to extract under any strategy.
        return 0
    if strategy == "every":
        return n
    if strategy == "every_n":
        step = max(1, int(sample_n))
        return math.ceil(n / step)
    if strategy == "every_ms":
        duration_ms = max(0.0, meta.duration_sec * 1000.0)
        if sample_ms <= 0:
            return n
        return math.ceil(duration_ms / sample_ms) if duration_ms > 0 else 0
    return n


def _run(meta: VideoMeta):
    return asyncio.run(FrameExtractionService().run(meta))


# ── Property 5 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 5: Frame extraction count and
# timestamps match the sampling strategy — for any video of N frames and
# configured sampling strategy, the number of extracted frames equals the
# deterministic count implied by the strategy (every → N; every_n → expected
# subsample count; every_ms → duration/X), and every extracted frame carries a
# non-negative start-relative timestamp, with timestamps non-decreasing in
# extraction order.
@given(
    meta=video_meta,
    strategy=_STRATEGIES,
    sample_n=_SAMPLE_N,
    sample_ms=_SAMPLE_MS,
)
@settings(max_examples=200)
def test_frame_extraction_count_and_timestamps_match_strategy(
    meta: VideoMeta, strategy: str, sample_n: int, sample_ms: float
):
    # Drive the active strategy + parameters via the shared settings singleton
    # that the stage reads at run time; restore them after each example.
    orig_strategy = cfg_settings.FRAME_SAMPLING
    orig_n = cfg_settings.FRAME_SAMPLE_N
    orig_ms = cfg_settings.FRAME_SAMPLE_MS
    cfg_settings.FRAME_SAMPLING = strategy
    cfg_settings.FRAME_SAMPLE_N = sample_n
    cfg_settings.FRAME_SAMPLE_MS = sample_ms
    try:
        result = _run(meta)
    finally:
        cfg_settings.FRAME_SAMPLING = orig_strategy
        cfg_settings.FRAME_SAMPLE_N = orig_n
        cfg_settings.FRAME_SAMPLE_MS = orig_ms

    # Extraction is a local, non-failing stage (Req 3.1) — always succeeds.
    assert result.success is True
    assert result.error is None
    assert result.output is not None

    frames = result.output.frames

    # Count equals the deterministic count implied by the strategy
    # (Req 3.2 / 3.3 / 3.4).
    assert len(frames) == _expected_count(strategy, meta, sample_n, sample_ms)

    # Every extracted frame carries a non-negative start-relative timestamp
    # (Req 3.6) and a valid in-range index.
    n = _n_frames(meta)
    for f in frames:
        assert f.timestamp_ms >= 0.0
        assert 0 <= f.index < n

    # Timestamps are non-decreasing in extraction order (Req 3.6).
    timestamps = [f.timestamp_ms for f in frames]
    assert timestamps == sorted(timestamps)

    # The source metadata is carried through unchanged.
    assert result.output.source_meta == meta
