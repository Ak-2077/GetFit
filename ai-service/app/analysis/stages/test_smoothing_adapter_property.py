"""
Property-based tests for the adapter contract conformance of the swappable
Pose_Engine registry and the Smoothing_Algorithm registry.

Covers design Property 10 — "Any registered pose engine and smoothing algorithm
yields a downstream-valid landmark contract" — using Hypothesis with a minimum
of 100 iterations.

The pose-engine concretes are dependency-gated stubs (their backing inference
libraries are not wired in), so for them we assert registry completeness and
interface conformance. The smoothing algorithms are the substantive, fully
testable part: for every algorithm in the registry we feed generated
`Landmarks` and assert the structure-/length-preserving contract holds and the
output remains a downstream-valid `Landmarks` payload — same number of frames,
same number of landmarks per frame, x/y clamped to the normalized [0, 1] range,
and non-coordinate metadata (timestamps, per-landmark confidence, overall
confidence) carried through unchanged.

Validates: Requirements 7.3, 25.2, 25.3
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.adapters.pose_engines import (
    POSE_ENGINE_NAMES,
    PoseEngine,
    build_pose_engine_registry,
)
from app.analysis.adapters.smoothing import (
    SMOOTHING_ALGORITHM_NAMES,
    SmoothingAlgorithm,
    build_smoothing_registry,
)
from app.analysis.contracts import (
    FrameLandmarks,
    Landmark,
    Landmarks,
    VideoMeta,
)
from app.analysis.stages.smoothing_adapter import SmoothingAdapter

# Coordinate-equality tolerance for metadata that must be preserved verbatim.
TOL = 1e-9


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


# ── Hypothesis strategies ──

# A single normalized landmark: x/y in [0,1], z relative depth, confidence [0,1].
@st.composite
def _landmark(draw) -> Landmark:
    return Landmark(
        x=draw(st.floats(min_value=0.0, max_value=1.0)),
        y=draw(st.floats(min_value=0.0, max_value=1.0)),
        z=draw(
            st.floats(
                min_value=-1.0, max_value=1.0, allow_nan=False, allow_infinity=False
            )
        ),
        confidence=draw(st.floats(min_value=0.0, max_value=1.0)),
    )


@st.composite
def _frame_landmarks(draw, *, index: int) -> FrameLandmarks:
    """One frame with 1..17 landmarks (per-frame counts may vary)."""
    n_landmarks = draw(st.integers(min_value=1, max_value=17))
    landmarks = draw(
        st.lists(_landmark(), min_size=n_landmarks, max_size=n_landmarks)
    )
    return FrameLandmarks(
        timestamp_ms=float(index) * 100.0,
        landmarks=landmarks,
        overall_confidence=draw(st.floats(min_value=0.0, max_value=1.0)),
    )


@st.composite
def _landmarks(draw) -> Landmarks:
    """A full Landmarks payload: 1..6 frames, each with its own landmark count."""
    n_frames = draw(st.integers(min_value=1, max_value=6))
    frames = [draw(_frame_landmarks(index=i)) for i in range(n_frames)]
    return Landmarks(frames=frames, source_meta=_meta(), pose_engine="mediapipe")


# ── Property 10 (smoothing): structure-/length-preserving contract ──

# Feature: ai-exercise-analysis, Property 10: Any registered pose engine and smoothing algorithm yields a downstream-valid landmark contract
@settings(max_examples=200)
@given(data=_landmarks())
def test_every_smoothing_algorithm_preserves_landmark_contract(
    data: Landmarks,
) -> None:
    """Property 10: each registered SmoothingAlgorithm yields a downstream-valid
    Landmarks payload — same shape/length, normalized range, metadata intact."""
    registry = build_smoothing_registry()
    # Iterate over EVERY algorithm in the registry (Req 25.2, 25.3).
    assert set(registry) == set(SMOOTHING_ALGORITHM_NAMES)

    for name, algorithm in registry.items():
        smoothed = algorithm.smooth(data.frames)

        # Same number of frames as the input (length-preserving, Req 25.2/25.3).
        assert len(smoothed) == len(data.frames), name

        for in_frame, out_frame in zip(data.frames, smoothed):
            # Each frame keeps the same number of landmarks (structure-preserving).
            assert len(out_frame.landmarks) == len(in_frame.landmarks), name

            # Timestamps preserved verbatim (non-coordinate metadata, Req 25.2).
            assert out_frame.timestamp_ms == in_frame.timestamp_ms, name
            # Overall confidence preserved verbatim.
            assert (
                abs(out_frame.overall_confidence - in_frame.overall_confidence)
                <= TOL
            ), name

            for in_lm, out_lm in zip(in_frame.landmarks, out_frame.landmarks):
                # x/y remain in the normalized [0,1] range (Landmark contract, Req 7.4).
                assert 0.0 <= out_lm.x <= 1.0, name
                assert 0.0 <= out_lm.y <= 1.0, name
                # Per-landmark confidence preserved verbatim (Req 25.2).
                assert abs(out_lm.confidence - in_lm.confidence) <= TOL, name


# Feature: ai-exercise-analysis, Property 10: Any registered pose engine and smoothing algorithm yields a downstream-valid landmark contract
@settings(max_examples=200)
@given(data=_landmarks(), algo_name=st.sampled_from(SMOOTHING_ALGORITHM_NAMES))
def test_smoothing_adapter_stage_emits_downstream_valid_landmarks(
    data: Landmarks,
    algo_name: str,
) -> None:
    """Property 10: the Smoothing_Adapter stage, for any config-selected
    algorithm, re-emits a valid Landmarks contract that downstream stages
    consume without modification (same shape, normalized range, metadata)."""
    stage = SmoothingAdapter(active_algorithm=algo_name)
    result = asyncio.run(stage.run(data))

    assert result.success is True, (algo_name, result.error)
    assert result.error is None
    out = result.output
    assert isinstance(out, Landmarks)

    # Additive: source metadata and producing engine are carried through (Req 25.4).
    assert out.source_meta == data.source_meta
    assert out.pose_engine == data.pose_engine

    # Same shape and length as the input so downstream stages are unchanged.
    assert len(out.frames) == len(data.frames)
    for in_frame, out_frame in zip(data.frames, out.frames):
        assert len(out_frame.landmarks) == len(in_frame.landmarks)
        assert out_frame.timestamp_ms == in_frame.timestamp_ms
        for out_lm in out_frame.landmarks:
            assert 0.0 <= out_lm.x <= 1.0
            assert 0.0 <= out_lm.y <= 1.0


# ── Property 10 (pose engines): registry completeness & interface conformance ──

def test_pose_engine_registry_is_complete_and_conformant() -> None:
    """Property 10: every registered Pose_Engine conforms to the swappable
    interface so engines are interchangeable without downstream changes
    (Req 7.3). Concrete inference is dependency-gated, so we assert registry
    membership and interface conformance rather than landmark output here."""
    registry = build_pose_engine_registry()

    # Registry exposes exactly the documented engines, keyed by name (Req 7.3).
    assert set(registry) == set(POSE_ENGINE_NAMES)

    for name, engine in registry.items():
        assert isinstance(engine, PoseEngine)
        # Key matches the engine's own stable identifier.
        assert engine.name == name
        # Version string is surfaced for Analysis_Versioning (Req 29.1).
        assert isinstance(engine.version, str) and engine.version
        # Interface methods exist for the Pose_Extraction_Service to call.
        assert callable(engine.is_available)
        assert callable(engine.extract)


def test_smoothing_registry_is_complete_and_conformant() -> None:
    """Property 10: every registered Smoothing_Algorithm conforms to the
    swappable interface, keyed by its stable name (Req 25.2, 25.3)."""
    registry = build_smoothing_registry()
    assert set(registry) == set(SMOOTHING_ALGORITHM_NAMES)
    for name, algorithm in registry.items():
        assert isinstance(algorithm, SmoothingAlgorithm)
        assert algorithm.name == name
        assert callable(algorithm.smooth)
