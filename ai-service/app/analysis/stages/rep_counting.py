"""
Rep_Counting_Service — Pipeline Stage (MovementTimeline → RepetitionSummary)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Detects repetitions from the Movement_Timeline — its ONLY analytical input
(Req 23.1, 23.4) — and produces a Repetition_Summary carrying the repetition
count, the generic Movement_Phase timestamps for each repetition, the average
repetition duration, and a movement-consistency measure (Req 23.3).

GENERIC MOVEMENT CYCLES ONLY (Req 23.2)
---------------------------------------
The detector reasons about a single, exercise-agnostic 1-D *movement signal* —
the vertical position of a body reference point (the hips when present,
otherwise the whole-body centroid) — exactly the reference convention the
sibling `Movement_Phase_Service` uses. It embeds NO per-exercise logic: it
never inspects an exercise id, never applies sport-specific thresholds, and
treats every repetition as the canonical oscillation "rest → travel to an
extreme → return to rest".

A repetition is one full oscillation of that signal between its two extreme
levels. Detection uses a hysteresis state machine over the signal's range: the
signal must leave its starting zone, cross a central dead band, reach the
opposite zone, and return — that complete out-and-back excursion is one rep.
The dead band rejects small jitter so noise does not inflate the count. All
parameters are read from configuration (Req 23.4); none are hardcoded.

PHASE TIMESTAMPS PER REP
------------------------
For each detected repetition the stage segments that repetition's time window
into the generic Movement_Phases {Start, Eccentric, Bottom, Concentric, Top}
by reusing the `Movement_Phase_Service` segmentation over the rep's slice of
the timeline (Req 23.3). The result, `phase_timestamps`, is therefore a list
(one entry per rep) of `MovementPhase` lists, reusing the shared `MovementPhase`
contract.

Following the pipeline contract in `base.py`, this stage NEVER raises on a
domain failure — it returns a `StageResult` (success/error). A degenerate or
empty timeline yields a zero-rep summary rather than an error.
"""

from __future__ import annotations

from app.core.config import settings

from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import (
    MovementPhase,
    MovementTimeline,
    RepetitionSummary,
    TimelineEntry,
)
from .movement_phase import MovementPhaseService, _reference_y

# Stable error code for the (non-domain) unexpected-failure guard.
REP_COUNTING_ERROR = "REP_COUNTING_ERROR"


class RepCountingService(PipelineStage[MovementTimeline, RepetitionSummary]):
    """
    Detect repetitions from a Movement_Timeline using generic movement cycles
    only (Req 23.1, 23.2) and summarize them (Req 23.3).

    Stateless and deterministic: the same timeline always yields the same
    Repetition_Summary. The result depends solely on the timeline — no exercise
    hint or per-exercise rule participates (Req 23.2, 23.4). Detection
    parameters default to the config values but may be overridden per instance
    to keep the stage independently testable (Req 23.4 — config-driven, never
    hardcoded).
    """

    name: str = "rep_counting"

    def __init__(
        self,
        *,
        min_amplitude: float | None = None,
        hysteresis_fraction: float | None = None,
    ) -> None:
        self._min_amplitude = (
            settings.REP_MIN_AMPLITUDE if min_amplitude is None else min_amplitude
        )
        self._hysteresis_fraction = (
            settings.REP_HYSTERESIS_FRACTION
            if hysteresis_fraction is None
            else hysteresis_fraction
        )
        # Reuse the sibling segmentation for per-rep phase timestamps so the
        # generic phase conventions stay identical across the two stages.
        self._phaser = MovementPhaseService()

    async def run(self, data: MovementTimeline) -> StageResult[RepetitionSummary]:
        try:
            summary = self._summarize(data)
        except Exception:  # pragma: no cover - defensive; never raise (base.py)
            return StageResult(
                success=False,
                error=StructuredError(
                    code=REP_COUNTING_ERROR,
                    message="Failed to count repetitions.",
                    stage=self.name,
                ),
            )
        return StageResult(success=True, output=summary)

    # ── Generic, exercise-agnostic repetition detection (Req 23.1, 23.2) ──

    def _summarize(self, timeline: MovementTimeline) -> RepetitionSummary:
        entries = timeline.entries

        # Sample the 1-D movement signal over entries that carry a usable
        # reference point, keeping each sample's timestamp.
        samples: list[tuple[float, float]] = []
        for entry in entries:
            y = _reference_y(entry)
            if y is not None:
                samples.append((entry.timestamp_ms, y))

        # Not enough signal to detect any oscillation → zero reps.
        if len(samples) < 2:
            return RepetitionSummary(
                rep_count=0,
                phase_timestamps=[],
                avg_rep_duration_ms=0.0,
                movement_consistency=0.0,
            )

        ys = [s[1] for s in samples]
        low = min(ys)
        high = max(ys)
        amplitude = high - low

        # Static movement (no measurable travel) → zero reps.
        if amplitude <= self._min_amplitude:
            return RepetitionSummary(
                rep_count=0,
                phase_timestamps=[],
                avg_rep_duration_ms=0.0,
                movement_consistency=0.0,
            )

        # Detect the [start_index, end_index] window of each repetition over the
        # sampled signal, then map those windows back onto timeline entries.
        rep_windows = self._detect_rep_windows(ys)

        # Map each sample-index window onto the corresponding timeline entries so
        # phase segmentation runs over real timeline data with its timestamps.
        sample_entries = [e for e in entries if _reference_y(e) is not None]

        phase_timestamps: list[list[MovementPhase]] = []
        durations: list[float] = []
        for start_i, end_i in rep_windows:
            rep_entries = sample_entries[start_i : end_i + 1]
            if len(rep_entries) < 2:
                continue
            durations.append(
                rep_entries[-1].timestamp_ms - rep_entries[0].timestamp_ms
            )
            phase_timestamps.append(self._segment_rep(rep_entries))

        rep_count = len(phase_timestamps)
        avg_rep_duration_ms = (
            sum(durations) / len(durations) if durations else 0.0
        )
        movement_consistency = self._consistency(durations)

        return RepetitionSummary(
            rep_count=rep_count,
            phase_timestamps=phase_timestamps,
            avg_rep_duration_ms=max(0.0, avg_rep_duration_ms),
            movement_consistency=movement_consistency,
        )

    def _detect_rep_windows(self, ys: list[float]) -> list[tuple[int, int]]:
        """Find the sample-index window of each full oscillation cycle.

        Uses a hysteresis state machine over the signal's full range. The signal
        oscillates between a low and a high zone separated by a central dead
        band; one repetition is a complete excursion that leaves the starting
        zone, reaches the opposite zone, and returns to the starting zone. The
        dead band (width = ``hysteresis_fraction`` of the range) rejects jitter
        so small fluctuations never register as zone transitions.
        """
        low = min(ys)
        high = max(ys)
        rng = high - low
        mid = (high + low) / 2.0
        half_band = max(0.0, self._hysteresis_fraction) * rng / 2.0
        high_th = mid + half_band
        low_th = mid - half_band

        # Establish the starting zone from the first sample that sits clearly in
        # one zone; default to whichever extreme the first sample is nearer.
        start_zone = "low" if ys[0] <= mid else "high"

        windows: list[tuple[int, int]] = []
        rep_start = 0          # index where the current cycle began
        zone = start_zone      # the zone we are currently anchored in
        visited_opposite = False

        for i, y in enumerate(ys):
            if start_zone == "low":
                # Leaving the low zone for the high zone (past the dead band).
                if not visited_opposite and y >= high_th:
                    visited_opposite = True
                # Returning to the low zone completes one full cycle.
                elif visited_opposite and y <= low_th:
                    windows.append((rep_start, i))
                    rep_start = i
                    visited_opposite = False
            else:  # start_zone == "high"
                if not visited_opposite and y <= low_th:
                    visited_opposite = True
                elif visited_opposite and y >= high_th:
                    windows.append((rep_start, i))
                    rep_start = i
                    visited_opposite = False

        return windows

    def _segment_rep(self, rep_entries: list[TimelineEntry]) -> list[MovementPhase]:
        """Segment a single rep's entries into generic Movement_Phases.

        Reuses the `Movement_Phase_Service` segmentation so the generic phase
        vocabulary and reference-signal conventions are identical to the
        sibling stage (Req 23.3).
        """
        return self._phaser._segment(MovementTimeline(entries=rep_entries))

    @staticmethod
    def _consistency(durations: list[float]) -> float:
        """Rep-to-rep consistency in [0,1] from repetition-duration variation.

        Defined as ``1 - coefficient_of_variation`` (std / mean) of the rep
        durations, clamped to [0,1]: uniform durations → 1.0, highly variable →
        toward 0.0. Fewer than two reps carry no rep-to-rep variation, so 0 reps
        yields 0.0 (no detected movement) and a single rep yields 1.0 (trivially
        consistent).
        """
        if not durations:
            return 0.0
        if len(durations) == 1:
            return 1.0
        mean = sum(durations) / len(durations)
        if mean <= 0.0:
            return 0.0
        variance = sum((d - mean) ** 2 for d in durations) / len(durations)
        std = variance ** 0.5
        cv = std / mean
        return max(0.0, min(1.0, 1.0 - cv))
