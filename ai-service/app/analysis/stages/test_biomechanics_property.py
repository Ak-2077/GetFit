"""
Property-based tests for the Biomechanics_Service
(app/analysis/stages/biomechanics.py).

Covers design Property 12 — "Biomechanics computation is deterministic and
complete" — using Hypothesis with a minimum of 100 iterations.

Validates: Requirements 9.1, 9.3, 9.4
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import MovementTimeline, ObjectiveMetrics, TimelineEntry
from app.analysis.stages.biomechanics import BiomechanicsService


# ── Generators ───────────────────────────────────────────────────────────
# Smart generators that build varied MovementTimelines: entries carry COCO-17
# named joint positions (so the calc_angle path is exercised), arbitrary extra
# joint angles, and ordered timestamps. Coordinates are normalized to [0, 1]
# (Req 7.4). The empty-timeline edge case is covered by a dedicated test below.

# COCO-17 joint names recognized by the biomechanics stage; using these names
# drives the deterministic calc_angle re-computation over joint_positions.
_JOINT_NAMES = [
    "left_shoulder", "right_shoulder",
    "left_elbow", "right_elbow",
    "left_wrist", "right_wrist",
    "left_hip", "right_hip",
    "left_knee", "right_knee",
    "left_ankle", "right_ankle",
]

# A normalized 2D coordinate component in [0, 1] (resolution-independent, Req 7.4).
_COORD = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)

# A single joint position: a normalized [x, y] point.
_POSITION = st.lists(_COORD, min_size=2, max_size=2)

# A mapping from a subset of COCO joints to positions (may be empty to exercise
# the centroid/fallback paths and degenerate entries).
_JOINT_POSITIONS = st.dictionaries(
    keys=st.sampled_from(_JOINT_NAMES),
    values=_POSITION,
    max_size=len(_JOINT_NAMES),
)

# Precomputed joint angles in a plausible degree range; keys may overlap or
# differ from the position-derived joints so both code paths are exercised.
_JOINT_ANGLES = st.dictionaries(
    keys=st.sampled_from(_JOINT_NAMES),
    values=st.floats(min_value=0.0, max_value=180.0, allow_nan=False, allow_infinity=False),
    max_size=len(_JOINT_NAMES),
)

_TIMESTAMP = st.floats(min_value=0.0, max_value=60_000.0, allow_nan=False, allow_infinity=False)


@st.composite
def _timeline_entries(draw) -> TimelineEntry:
    return TimelineEntry(
        timestamp_ms=draw(_TIMESTAMP),
        joint_positions=draw(_JOINT_POSITIONS),
        joint_angles=draw(_JOINT_ANGLES),
        # Unused by biomechanics but required by the contract; kept varied.
        joint_velocity={},
        joint_acceleration={},
        movement_direction={},
    )


@st.composite
def movement_timelines(draw) -> MovementTimeline:
    entries = draw(st.lists(_timeline_entries(), min_size=0, max_size=12))
    # Order by timestamp_ms to honor the Movement_Timeline invariant (Req 8.1).
    entries.sort(key=lambda e: e.timestamp_ms)
    return MovementTimeline(entries=entries)


# The complete set of metric fields required by Req 9.3 (plus confidence).
_REQUIRED_FIELDS = {
    "joint_angles",
    "bar_path",
    "depth",
    "range_of_motion",
    "tempo",
    "symmetry",
    "center_of_mass",
    "balance",
    "confidence",
}


def _run(timeline: MovementTimeline) -> ObjectiveMetrics:
    result = asyncio.run(BiomechanicsService().run(timeline))
    assert result.success is True
    assert result.error is None
    assert result.output is not None
    return result.output


def _assert_complete_and_bounded(metrics: ObjectiveMetrics) -> None:
    # Req 9.3 — every required metric field is present.
    dumped = metrics.model_dump()
    assert _REQUIRED_FIELDS.issubset(dumped.keys())
    # Confidence is a bounded probability in [0, 1].
    assert 0.0 <= metrics.confidence <= 1.0


# ── Property 12 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 12: Biomechanics computation is
# deterministic and complete
@given(timeline=movement_timelines())
@settings(max_examples=200)
def test_biomechanics_deterministic_and_complete(timeline: MovementTimeline):
    first = _run(timeline)
    second = _run(timeline)

    # Req 9.4 — repeated executions on the same timeline yield identical metrics.
    assert first.model_dump() == second.model_dump()

    # Req 9.3 — the metrics contain all required fields, and confidence is bounded.
    _assert_complete_and_bounded(first)


def test_empty_timeline_is_complete_and_deterministic():
    """Edge case (design.md): an empty timeline yields zero/identity metrics
    rather than raising, and the result is still complete and deterministic."""
    empty = MovementTimeline(entries=[])
    first = _run(empty)
    second = _run(empty)

    assert first.model_dump() == second.model_dump()
    _assert_complete_and_bounded(first)
    # Identity/zero metrics for a degenerate timeline.
    assert first.confidence == 0.0
    assert first.depth == 0.0
    assert first.tempo == 0.0
