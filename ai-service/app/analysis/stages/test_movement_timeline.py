"""
Property-based test for the Movement_Timeline_Service (Stage 7).

# Feature: ai-exercise-analysis, Property 11: Movement timeline is ordered, complete, and derivative-consistent

Property 11 (design.md): For any set of frame landmarks, the constructed
`MovementTimeline` is ordered non-decreasing by timestamp, every entry contains
joint positions, joint angles, joint velocity, joint acceleration, and movement
direction, and the computed velocity equals the finite difference of positions
over the inter-frame interval within tolerance.

**Validates: Requirements 8.1, 8.2, 8.4**
"""

import asyncio
import math

from hypothesis import given, settings, strategies as st

from app.analysis.contracts import (
    FrameLandmarks,
    Landmark,
    Landmarks,
    VideoMeta,
)
from app.analysis.stages.movement_timeline import (
    COCO_KEYPOINT_NAMES,
    JOINT_ANGLE_DEFS,
    MovementTimelineService,
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

# Normalized, resolution-independent coordinates (Req 7.4): x/y in [0, 1].
_coord = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)
_depth = st.floats(min_value=-1.0, max_value=1.0, allow_nan=False, allow_infinity=False)


@st.composite
def _landmark(draw) -> Landmark:
    return Landmark(
        x=draw(_coord),
        y=draw(_coord),
        z=draw(_depth),
        confidence=draw(_coord),
    )


@st.composite
def _frame(draw) -> FrameLandmarks:
    # Integer-millisecond timestamps (realistic) keep inter-frame Δt whole and
    # avoid pathologically tiny intervals; ties (Δt == 0) are still allowed so
    # the equal-timestamp branch is exercised.
    ts = draw(st.integers(min_value=0, max_value=60_000))
    # Always emit a full COCO-17 set so every joint is shared across frames.
    landmarks = draw(st.lists(_landmark(), min_size=17, max_size=17))
    return FrameLandmarks(
        timestamp_ms=float(ts),
        landmarks=landmarks,
        overall_confidence=draw(_coord),
    )


@st.composite
def _landmarks(draw) -> Landmarks:
    # Multiple frames with varied, deliberately unordered timestamps so the
    # non-decreasing-order guarantee (Req 8.1) is genuinely tested via sorting.
    frames = draw(st.lists(_frame(), min_size=1, max_size=6))
    return Landmarks(frames=frames, source_meta=META, pose_engine="test")


@settings(max_examples=200, deadline=None)
@given(data=_landmarks())
def test_movement_timeline_ordered_complete_and_derivative_consistent(data):
    service = MovementTimelineService()
    result = asyncio.run(service.run(data))

    assert result.success is True
    assert result.error is None
    assert result.output is not None

    entries = result.output.entries
    assert len(entries) == len(data.frames)

    expected_joints = set(COCO_KEYPOINT_NAMES)
    expected_angles = set(JOINT_ANGLE_DEFS.keys())

    # ── Req 8.1: ordered non-decreasing by timestamp ──
    timestamps = [e.timestamp_ms for e in entries]
    assert timestamps == sorted(timestamps)

    # ── Req 8.2: every entry is complete for all shared joints ──
    for entry in entries:
        assert set(entry.joint_positions.keys()) == expected_joints
        assert set(entry.joint_velocity.keys()) == expected_joints
        assert set(entry.joint_acceleration.keys()) == expected_joints
        assert set(entry.movement_direction.keys()) == expected_joints
        assert set(entry.joint_angles.keys()) == expected_angles
        for name in expected_joints:
            assert len(entry.joint_positions[name]) == 3

    # First entry has no predecessor, so all derivatives default to 0.0.
    first = entries[0]
    for name in expected_joints:
        assert first.joint_velocity[name] == 0.0
        assert first.joint_acceleration[name] == 0.0
        assert first.movement_direction[name] == 0.0

    # ── Req 8.4: velocity is the finite difference of positions over Δt ──
    for prev, cur in zip(entries, entries[1:]):
        dt = cur.timestamp_ms - prev.timestamp_ms
        if dt > 0.0:
            for name in expected_joints:
                px, py, _ = prev.joint_positions[name]
                cx, cy, _ = cur.joint_positions[name]
                expected_v = math.hypot(cx - px, cy - py) / dt
                assert math.isclose(
                    cur.joint_velocity[name], expected_v, rel_tol=1e-9, abs_tol=1e-12
                )
        else:
            # Shared timestamp (Δt == 0) → derivatives default to 0.0.
            for name in expected_joints:
                assert cur.joint_velocity[name] == 0.0
                assert cur.joint_acceleration[name] == 0.0
                assert cur.movement_direction[name] == 0.0
