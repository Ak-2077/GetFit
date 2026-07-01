"""
Property-based test for the Rep_Counting_Service (Stage 8).

# Feature: ai-exercise-analysis, Property 14: Repetition summary is timeline-derived and well-formed

Property 14 (design.md): For any `MovementTimeline`, the `Rep_Counting_Service`
produces a `RepetitionSummary` that is well-formed and purely timeline-derived:

  * `rep_count` is a non-negative integer,
  * `phase_timestamps` is a list with exactly one entry per rep, each a list of
    generic `MovementPhase` objects,
  * `avg_rep_duration_ms` is non-negative,
  * `movement_consistency` lies in [0.0, 1.0],
  * the summary is deterministic — the same timeline always yields the same
    summary (no exercise hint participates; the result depends only on the
    timeline), and
  * an empty or static timeline (no measurable travel) yields `rep_count == 0`.

**Validates: Requirements 23.1, 23.2, 23.3, 23.4**
"""

import asyncio
import math

from hypothesis import given, settings as hp_settings, strategies as st

from app.core.config import settings

from app.analysis.contracts import (
    MovementPhase,
    MovementTimeline,
    RepetitionSummary,
    TimelineEntry,
)
from app.analysis.stages.movement_phase import _reference_y
from app.analysis.stages.rep_counting import RepCountingService

# Finite, in-range vertical reference coordinate (normalized image space).
_coord = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)


def _make_entry(timestamp_ms: float, y: float) -> TimelineEntry:
    """A timeline entry whose hip reference point sits at vertical position ``y``.

    Only `joint_positions` (the hips) feeds the rep detector's 1-D reference
    signal; the remaining derivative dicts are unused by this stage and are left
    empty.
    """
    return TimelineEntry(
        timestamp_ms=float(timestamp_ms),
        joint_positions={
            "left_hip": [0.5, float(y), 0.0],
            "right_hip": [0.5, float(y), 0.0],
        },
        joint_angles={},
        joint_velocity={},
        joint_acceleration={},
        movement_direction={},
    )


# Edge case: no entries at all.
_empty_timeline = st.just(MovementTimeline(entries=[]))


@st.composite
def _static_timeline(draw) -> MovementTimeline:
    """Edge case: a non-empty timeline whose reference signal never moves."""
    n = draw(st.integers(min_value=1, max_value=25))
    y = draw(_coord)
    return MovementTimeline(entries=[_make_entry(i * 50, y) for i in range(n)])


@st.composite
def _oscillating_timeline(draw) -> MovementTimeline:
    """A synthesized oscillating signal with a known number of full cycles.

    ``-cos`` starts the signal at one extreme and returns to it once per cycle,
    so each cycle is a complete out-and-back excursion (one canonical rep).
    """
    cycles = draw(st.integers(min_value=1, max_value=5))
    samples_per_cycle = draw(st.integers(min_value=8, max_value=24))
    amplitude = draw(st.floats(min_value=0.1, max_value=0.45))
    mid = 0.5
    n = cycles * samples_per_cycle
    entries = [
        _make_entry(i * 50, mid - amplitude * math.cos(2 * math.pi * cycles * i / n))
        for i in range(n + 1)
    ]
    return MovementTimeline(entries=entries)


@st.composite
def _random_timeline(draw) -> MovementTimeline:
    """Arbitrary reference signal (including degenerate short/jittery ones)."""
    ys = draw(st.lists(_coord, min_size=0, max_size=30))
    return MovementTimeline(entries=[_make_entry(i * 40, y) for i, y in enumerate(ys)])


_timelines = st.one_of(
    _empty_timeline,
    _static_timeline(),
    _oscillating_timeline(),
    _random_timeline(),
)


def _amplitude(timeline: MovementTimeline) -> tuple[int, float]:
    """Number of usable reference samples and their peak-to-peak amplitude."""
    ys = [y for e in timeline.entries if (y := _reference_y(e)) is not None]
    if len(ys) < 2:
        return len(ys), 0.0
    return len(ys), max(ys) - min(ys)


@hp_settings(max_examples=200, deadline=None)
@given(timeline=_timelines)
def test_repetition_summary_timeline_derived_and_well_formed(timeline):
    service = RepCountingService()

    result = asyncio.run(service.run(timeline))
    assert result.success is True
    assert result.error is None
    summary = result.output
    assert isinstance(summary, RepetitionSummary)

    # ── Well-formedness bounds (Req 23.1, 23.3) ──
    assert isinstance(summary.rep_count, int)
    assert summary.rep_count >= 0
    assert summary.avg_rep_duration_ms >= 0.0
    assert 0.0 <= summary.movement_consistency <= 1.0

    # phase_timestamps: one entry per rep, each a list of generic MovementPhase.
    assert isinstance(summary.phase_timestamps, list)
    assert len(summary.phase_timestamps) == summary.rep_count
    for rep_phases in summary.phase_timestamps:
        assert isinstance(rep_phases, list)
        for phase in rep_phases:
            assert isinstance(phase, MovementPhase)

    # ── Empty / static → zero reps (Req 23.1) ──
    n_samples, amplitude = _amplitude(timeline)
    if n_samples < 2 or amplitude <= settings.REP_MIN_AMPLITUDE:
        assert summary.rep_count == 0
        assert summary.phase_timestamps == []
        assert summary.avg_rep_duration_ms == 0.0

    # ── Purely timeline-derived & deterministic (Req 23.2, 23.4) ──
    again = asyncio.run(service.run(timeline))
    assert again.success is True
    assert again.output.model_dump() == summary.model_dump()
