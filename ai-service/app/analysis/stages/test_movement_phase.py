"""
Property-based test for the Movement_Phase_Service (MovementTimeline → MovementPhases).

# Feature: ai-exercise-analysis, Property 15: Movement phases are generic, labeled, and time-bounded

Property 15 (design.md): For any `MovementTimeline`, every produced
`Movement_Phase` carries a label drawn from the generic set {Start, Eccentric,
Bottom, Concentric, Top}, has `start_ms` <= `end_ms`, and the phases are emitted
in chronological order and never overlap (end of one phase <= start of the next).
Empty or static timelines are handled gracefully (no phases, or a single Start).

**Validates: Requirements 8.3, 24.1, 24.4**
"""

import asyncio

from hypothesis import given, settings, strategies as st

from app.analysis.contracts import MovementTimeline, TimelineEntry
from app.analysis.stages.movement_phase import (
    GENERIC_PHASES,
    MovementPhaseService,
)

# COCO-17 hip keys are the preferred reference point; a generic joint set lets
# the centroid-fallback path also be exercised when hips are absent.
_HIP_KEYS = ("left_hip", "right_hip")
_OTHER_KEYS = ("left_shoulder", "right_shoulder", "left_knee", "right_knee")

# Normalized, resolution-independent coordinates (Req 7.4): x/y in [0, 1].
_coord = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)


@st.composite
def _entry(draw, timestamp_ms: float) -> TimelineEntry:
    """One timeline entry with hip and/or other joint positions over time.

    The presence of hip keys is randomized so both the hip reference path and
    the whole-body centroid fallback are exercised. joint_positions may also be
    empty to drive the degenerate (no usable position) branch.
    """
    positions: dict[str, list[float]] = {}

    include_hips = draw(st.booleans())
    if include_hips:
        for key in _HIP_KEYS:
            positions[key] = [draw(_coord), draw(_coord), draw(_coord)]

    # Optionally include some other joints (always, when hips are absent, this
    # is what feeds the centroid fallback).
    other_keys = draw(st.lists(st.sampled_from(_OTHER_KEYS), unique=True, max_size=4))
    for key in other_keys:
        positions[key] = [draw(_coord), draw(_coord), draw(_coord)]

    return TimelineEntry(
        timestamp_ms=timestamp_ms,
        joint_positions=positions,
        joint_angles={},
        joint_velocity={},
        joint_acceleration={},
        movement_direction={},
    )


@st.composite
def _timeline(draw) -> MovementTimeline:
    """A MovementTimeline with non-decreasing timestamps (Req 8.1).

    Sizes range from 0 (empty) through single-entry and static runs up to a
    multi-entry movement, so empty/static/normal cases are all covered.
    """
    n = draw(st.integers(min_value=0, max_value=12))
    # Non-decreasing integer-millisecond timestamps; ties allowed so equal
    # timestamps (static spans) are exercised.
    deltas = draw(st.lists(st.integers(min_value=0, max_value=500), min_size=n, max_size=n))
    entries: list[TimelineEntry] = []
    t = draw(st.integers(min_value=0, max_value=1000))
    for d in deltas:
        t += d
        entries.append(draw(_entry(float(t))))
    return MovementTimeline(entries=entries)


@settings(max_examples=200, deadline=None)
@given(timeline=_timeline())
def test_movement_phases_generic_labeled_and_time_bounded(timeline):
    service = MovementPhaseService()
    result = asyncio.run(service.run(timeline))

    # The stage never raises on a domain failure; it returns a success result.
    assert result.success is True
    assert result.error is None
    assert result.output is not None

    phases = result.output.phases

    # ── Empty timeline → no phases to segment ──
    if not timeline.entries:
        assert phases == []
        return

    # ── A non-empty timeline always yields at least one phase ──
    assert len(phases) >= 1

    generic = set(GENERIC_PHASES)
    t0 = timeline.entries[0].timestamp_ms
    tN = timeline.entries[-1].timestamp_ms

    prev_end: float | None = None
    for phase in phases:
        # ── Req 24.1: every label is drawn from the generic vocabulary ──
        assert phase.phase in generic

        # ── Req 24.4: each phase is time-bounded with start_ms <= end_ms ──
        assert phase.start_ms <= phase.end_ms

        # Phases lie within the timeline span.
        assert phase.start_ms >= t0
        assert phase.end_ms <= tN

        # ── Req 24.4: phases are ordered and non-overlapping ──
        if prev_end is not None:
            assert phase.start_ms >= prev_end
        prev_end = phase.end_ms

    # ── Req 24.1: produced labels follow the canonical generic order ──
    produced = [p.phase for p in phases]
    order = {label: i for i, label in enumerate(GENERIC_PHASES)}
    order_indices = [order[label] for label in produced]
    assert order_indices == sorted(order_indices)
