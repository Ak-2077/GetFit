"""
Property-based tests for the Pose_Extraction_Service (Stage 6).

Covers design Property 9 — "Normalized landmarks are resolution-independent":

  *For any* frame, extracting landmarks from the frame at resolution R and from
  the same frame scaled to k·R produces equal normalized landmark coordinates
  within tolerance, and every returned landmark carries a `Pose_Confidence` in
  [0.0, 1.0].

Validates: Requirements 7.4, 21.1

Approach
────────
Normalized coordinates are resolution-independent *by contract* (Req 7.4): a
real `Pose_Engine` projects pixel detections back into the unit square by
dividing by the frame resolution. We model exactly that with an in-test
`PoseEngine` that carries a generated "source pose" (normalized landmarks +
confidences) plus a resolution, performs the normalized→pixel→normalized
round-trip at its own resolution, and returns the result. Two engine instances
built from the SAME source pose but DIFFERENT resolutions (R and k·R) must
yield equal normalized coordinates. The engine is injected through the stage's
`registry` / `active_engine` constructor overrides, so no real backend runs.
"""

from __future__ import annotations

import asyncio

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from app.analysis.adapters.pose_engines import PoseEngine, PoseEngineResult
from app.analysis.contracts import (
    Frame,
    FrameLandmarks,
    KeyFrames,
    Landmark,
    Landmarks,
    VideoMeta,
)
from app.analysis.stages.pose_extraction import PoseExtractionService

# Coordinate equality tolerance across resolutions (Req 7.4).
TOL = 1e-9

ENGINE_NAME = "fake_resolution"


def _clamp_unit(value: float) -> float:
    """Keep a normalized coordinate inside the closed unit interval [0, 1]."""
    return min(1.0, max(0.0, value))


def _meta(width: int, height: int) -> VideoMeta:
    """Minimal VideoMeta carrying the resolution under test."""
    return VideoMeta(
        container_format="mp4",
        codec="h264",
        duration_sec=5.0,
        width=width,
        height=height,
        fps=30.0,
        size_bytes=1_000_000,
        orientation="landscape" if width >= height else "portrait",
    )


class _ResolutionScaledFakeEngine(PoseEngine):
    """
    In-test `Pose_Engine` that returns normalized landmarks derived from a
    generated source pose.

    The engine simulates real inference at its configured resolution: each
    source landmark (already normalized) is projected to pixel space using this
    engine's resolution, then divided back by the same resolution to recover a
    normalized coordinate. Because the projection is resolution-independent by
    construction, two engines built from the same source pose at different
    resolutions return equal normalized coordinates (Req 7.4). Confidences are
    carried straight through and remain in [0, 1] (Req 21.1).
    """

    name = ENGINE_NAME
    version = "fake-1.0.0"

    def __init__(
        self,
        source_frames: list[dict],
        width: int,
        height: int,
        person_count: int = 1,
    ) -> None:
        self._source = source_frames
        self._w = width
        self._h = height
        self._person_count = person_count

    async def is_available(self) -> bool:
        return True

    async def extract(self, frames: list[Frame]) -> PoseEngineResult:
        out_frames: list[FrameLandmarks] = []
        for sf in self._source:
            landmarks: list[Landmark] = []
            for nx, ny, nz, conf in sf["landmarks"]:
                # normalized -> pixel (this resolution) -> normalized again.
                px = nx * self._w
                py = ny * self._h
                landmarks.append(
                    Landmark(
                        x=_clamp_unit(px / self._w),
                        y=_clamp_unit(py / self._h),
                        z=nz,
                        confidence=conf,
                    )
                )
            out_frames.append(
                FrameLandmarks(
                    timestamp_ms=sf["ts"],
                    landmarks=landmarks,
                    overall_confidence=sf["overall"],
                )
            )
        return PoseEngineResult(
            frames=out_frames,
            person_count=self._person_count,
            available=True,
        )


def _run_with_engine(engine: PoseEngine, data: KeyFrames) -> Landmarks:
    """Run the stage with the fake engine injected via the override hooks."""
    stage = PoseExtractionService(
        registry={ENGINE_NAME: engine},
        active_engine=ENGINE_NAME,
    )
    result = asyncio.run(stage.run(data))
    assert result.success is True, result.error
    assert result.error is None
    assert result.output is not None
    return result.output


# ── Hypothesis strategies ──

# A single normalized landmark: (x, y) in [0,1], z relative depth, confidence [0,1].
_landmark = st.tuples(
    st.floats(min_value=0.0, max_value=1.0),
    st.floats(min_value=0.0, max_value=1.0),
    st.floats(min_value=-1.0, max_value=1.0, allow_nan=False, allow_infinity=False),
    st.floats(min_value=0.0, max_value=1.0),
)


@st.composite
def _source_pose(draw) -> list[dict]:
    """Generate a per-frame source pose: 1..4 frames, each 1..17 landmarks."""
    n_frames = draw(st.integers(min_value=1, max_value=4))
    frames: list[dict] = []
    for i in range(n_frames):
        n_landmarks = draw(st.integers(min_value=1, max_value=17))
        landmarks = draw(
            st.lists(_landmark, min_size=n_landmarks, max_size=n_landmarks)
        )
        frames.append(
            {
                "ts": float(i) * 100.0,
                "landmarks": landmarks,
                "overall": draw(st.floats(min_value=0.0, max_value=1.0)),
            }
        )
    return frames


# Feature: ai-exercise-analysis, Property 9: Normalized landmarks are resolution-independent
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
@given(
    source=_source_pose(),
    base_width=st.integers(min_value=64, max_value=1920),
    base_height=st.integers(min_value=64, max_value=1920),
    k=st.floats(min_value=0.25, max_value=4.0, allow_nan=False, allow_infinity=False),
)
def test_normalized_landmarks_are_resolution_independent(
    source: list[dict],
    base_width: int,
    base_height: int,
    k: float,
) -> None:
    """Property 9: normalized coords match across resolutions; conf in [0,1]."""
    scaled_width = max(1, round(base_width * k))
    scaled_height = max(1, round(base_height * k))

    # Same generated frame at resolution R and at k·R.
    placeholder_frames = [
        Frame(index=i, timestamp_ms=sf["ts"]) for i, sf in enumerate(source)
    ]
    data_r = KeyFrames(frames=placeholder_frames, source_meta=_meta(base_width, base_height))
    data_kr = KeyFrames(frames=placeholder_frames, source_meta=_meta(scaled_width, scaled_height))

    out_r = _run_with_engine(
        _ResolutionScaledFakeEngine(source, base_width, base_height), data_r
    )
    out_kr = _run_with_engine(
        _ResolutionScaledFakeEngine(source, scaled_width, scaled_height), data_kr
    )

    # Same shape across resolutions.
    assert len(out_r.frames) == len(out_kr.frames) == len(source)

    for fr, fkr in zip(out_r.frames, out_kr.frames):
        assert len(fr.landmarks) == len(fkr.landmarks)
        for lm_r, lm_kr in zip(fr.landmarks, fkr.landmarks):
            # Resolution-independent normalized coordinates (Req 7.4).
            assert abs(lm_r.x - lm_kr.x) <= TOL
            assert abs(lm_r.y - lm_kr.y) <= TOL
            # Every returned landmark carries a Pose_Confidence in [0,1] (Req 21.1).
            assert 0.0 <= lm_r.x <= 1.0
            assert 0.0 <= lm_r.y <= 1.0
            assert 0.0 <= lm_r.confidence <= 1.0
            assert 0.0 <= lm_kr.confidence <= 1.0
        assert 0.0 <= fr.overall_confidence <= 1.0


def test_landmark_contract_enforces_normalized_bounds() -> None:
    """The Landmark contract rejects out-of-range normalized coords (Req 7.4)."""
    # Valid landmark at the unit-square boundary is accepted.
    Landmark(x=0.0, y=1.0, z=0.0, confidence=0.5)

    for bad in ({"x": 1.5, "y": 0.5}, {"x": -0.1, "y": 0.5}, {"x": 0.5, "y": 2.0}):
        with pytest.raises(ValidationError):
            Landmark(z=0.0, confidence=0.5, **bad)

    # Confidence is likewise bounded to [0,1] (Req 21.1).
    with pytest.raises(ValidationError):
        Landmark(x=0.5, y=0.5, z=0.0, confidence=1.5)
