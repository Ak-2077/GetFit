"""
Movement_Phase_Service — Pipeline Stage (MovementTimeline → MovementPhases)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Segments the Movement_Timeline into a sequence of generic, exercise-agnostic
Movement_Phases drawn from the set {Start, Eccentric, Bottom, Concentric, Top}
(Req 8.3, 24.1). Every phase carries its start/end timestamp (Req 24.4); the
phases are emitted in chronological order and never overlap (Req 24.4).

GENERIC SEGMENTATION ONLY (Req 24.2)
------------------------------------
The segmentation reasons about a single, exercise-agnostic 1-D *movement
signal* — the vertical position of a body reference point (the hips when
present, otherwise the whole-body centroid) — and the direction in which it
travels. It contains NO per-exercise hardcoded logic: it never inspects the
exercise id, never applies sport-specific thresholds, and treats every
movement as the canonical cycle "rest → travel to an extreme → return".

The reference signal mirrors the conventions already used by the
`Biomechanics_Service` (hip / centroid reference points over normalized,
resolution-independent coordinates, Req 7.4). Coordinates are normalized image
coordinates where `y` increases downward; the segmentation is sign-agnostic
(it keys off displacement *magnitude* and the turning point), so it works
whether the movement travels down-then-up or up-then-down.

PLUGIN-CONSUMABLE INTERFACE (Req 24.3)
--------------------------------------
The stage output is the typed `MovementPhases` contract, the stable surface a
future `Exercise_Plugin` reads phases from. The service additionally accepts an
optional `ExercisePlugin`: WHERE a plugin supplies its own ordered phase
definitions via `movement_phases()`, the service relabels the generic segments
with the plugin's labels WITHOUT changing its own interface or its generic
segmentation (Req 24.3). V1 ships no plugins (Req 24.2, 28.3), so the default
path always produces the canonical generic labels.

Following the pipeline contract in `base.py`, this stage NEVER raises on a
domain failure — it returns a `StageResult` (success/error). A degenerate or
empty timeline yields a sensible phase set (or none) rather than an error.
"""

from __future__ import annotations

from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import MovementPhase, MovementPhases, MovementTimeline, TimelineEntry
from ..plugins import ExercisePlugin

# Stable error code for the (non-domain) unexpected-failure guard.
MOVEMENT_PHASE_ERROR = "MOVEMENT_PHASE_ERROR"

#: The canonical generic phase labels, in cycle order (Req 24.1). The order is
#: significant: it maps onto rest → travel-out → extreme → travel-back → rest.
PHASE_START: str = "Start"
PHASE_ECCENTRIC: str = "Eccentric"
PHASE_BOTTOM: str = "Bottom"
PHASE_CONCENTRIC: str = "Concentric"
PHASE_TOP: str = "Top"

#: The full generic phase vocabulary every produced phase is drawn from.
GENERIC_PHASES: tuple[str, ...] = (
    PHASE_START,
    PHASE_ECCENTRIC,
    PHASE_BOTTOM,
    PHASE_CONCENTRIC,
    PHASE_TOP,
)

#: Hip position keys — the preferred vertical reference point (most stable
#: indicator of whole-body travel). Matches the COCO-17 naming the
#: Movement_Timeline_Service emits and the Biomechanics_Service consumes.
HIP_KEYS: tuple[str, ...] = ("left_hip", "right_hip")

#: Fraction of the total displacement amplitude within which the body is
#: considered to still be "at rest" near its starting position. Used to bound
#: the Start and Top phases. Generic (amplitude-relative), not per-exercise.
START_BAND_FRACTION: float = 0.10

#: Fraction of the amplitude within which the body is considered to be "at the
#: extreme" (the Bottom phase). Generic, amplitude-relative.
BOTTOM_BAND_FRACTION: float = 0.10

#: Minimum displacement amplitude (in normalized units) below which the
#: movement is treated as static — no measurable travel to segment.
MIN_AMPLITUDE: float = 1e-6


def _reference_y(entry: TimelineEntry) -> float | None:
    """Vertical position of the movement reference point for one entry.

    Prefers the mean of the hip `y` values; falls back to the whole-body
    centroid `y` when no hip is present. Returns ``None`` when the entry has no
    usable joint position at all. Only the `y` component is used — the
    segmentation is a 1-D vertical-travel analysis.
    """
    hip_ys: list[float] = []
    for key in HIP_KEYS:
        pos = entry.joint_positions.get(key)
        if pos is not None and len(pos) >= 2:
            hip_ys.append(float(pos[1]))
    if hip_ys:
        return sum(hip_ys) / len(hip_ys)

    # Fall back to the whole-body centroid over every usable joint position.
    all_ys: list[float] = []
    for name in sorted(entry.joint_positions):
        pos = entry.joint_positions[name]
        if pos is not None and len(pos) >= 2:
            all_ys.append(float(pos[1]))
    if all_ys:
        return sum(all_ys) / len(all_ys)
    return None


class MovementPhaseService(PipelineStage[MovementTimeline, MovementPhases]):
    """
    Segment a Movement_Timeline into generic Movement_Phases (Req 8.3, 24.x).

    Stateless and deterministic: the same timeline always yields the same
    phases. Accepts an optional `ExercisePlugin` whose `movement_phases()` may
    relabel the generic segments without altering the stage interface
    (Req 24.3); V1 supplies none, so the canonical labels are used.
    """

    name: str = "movement_phase"

    def __init__(self, plugin: ExercisePlugin | None = None) -> None:
        # An optional plugin may override the phase LABELS only; it never
        # changes the generic segmentation logic (Req 24.2, 24.3).
        self._plugin = plugin

    async def run(self, data: MovementTimeline) -> StageResult[MovementPhases]:
        try:
            phases = self._segment(data)
        except Exception:  # pragma: no cover - defensive; never raise (base.py)
            return StageResult(
                success=False,
                error=StructuredError(
                    code=MOVEMENT_PHASE_ERROR,
                    message="Failed to segment movement phases.",
                    stage=self.name,
                ),
            )
        return StageResult(success=True, output=MovementPhases(phases=phases))

    # ── Generic, exercise-agnostic segmentation (Req 24.1, 24.2) ──

    def _segment(self, timeline: MovementTimeline) -> list[MovementPhase]:
        entries = timeline.entries

        # Empty timeline → nothing to segment.
        if not entries:
            return []

        labels = self._phase_labels()
        t0 = entries[0].timestamp_ms
        tN = entries[-1].timestamp_ms

        # Sample the 1-D movement signal over entries that carry a usable
        # reference point, keeping each sample's timestamp.
        samples: list[tuple[float, float]] = []
        for entry in entries:
            y = _reference_y(entry)
            if y is not None:
                samples.append((entry.timestamp_ms, y))

        # No usable positional data, or not enough to detect a turning point:
        # the whole span is a single Start phase (Req 24.4 still satisfied).
        if len(samples) < 2:
            return [self._phase(labels[0], t0, tN)]

        ts = [s[0] for s in samples]
        ys = [s[1] for s in samples]
        s0 = ys[0]

        # Turning point: the sample whose displacement from the start is
        # greatest. Generic — the "extreme" of the movement, whatever its
        # direction.
        peak = max(range(len(ys)), key=lambda i: abs(ys[i] - s0))
        amplitude = abs(ys[peak] - s0)

        # Static movement (no measurable travel): a single Start phase.
        if amplitude <= MIN_AMPLITUDE:
            return [self._phase(labels[0], t0, tN)]

        start_band = START_BAND_FRACTION * amplitude
        bottom_band = BOTTOM_BAND_FRACTION * amplitude

        def disp(i: int) -> float:
            return abs(ys[i] - s0)

        # Eccentric begins once the body has travelled clear of the start band.
        i_ecc_start = peak
        for i in range(0, peak + 1):
            if disp(i) >= start_band:
                i_ecc_start = i
                break

        # Bottom begins when the body first reaches the extreme band on the way
        # out, and ends when it last leaves that band on the way back.
        near_extreme = amplitude - bottom_band
        i_bottom_begin = peak
        for i in range(0, peak + 1):
            if disp(i) >= near_extreme:
                i_bottom_begin = i
                break
        i_bottom_end = peak
        for j in range(len(ys) - 1, peak - 1, -1):
            if disp(j) >= near_extreme:
                i_bottom_end = j
                break

        # Concentric ends (Top begins) once the body returns within the start
        # band again, searching forward from the end of the Bottom phase.
        i_top_begin = len(ys) - 1
        for j in range(i_bottom_end, len(ys)):
            if disp(j) <= start_band:
                i_top_begin = j
                break

        # Map the five boundary samples onto timestamps, anchoring the outer
        # edges to the full timeline span so the phases cover it end to end.
        boundaries = [
            t0,
            ts[i_ecc_start],
            ts[i_bottom_begin],
            ts[i_bottom_end],
            ts[i_top_begin],
            tN,
        ]
        # Enforce a non-decreasing boundary sequence so phases stay ordered and
        # non-overlapping even if the signal is noisy (Req 24.4).
        for k in range(1, len(boundaries)):
            if boundaries[k] < boundaries[k - 1]:
                boundaries[k] = boundaries[k - 1]

        # Build one phase per consecutive boundary pair, dropping zero-length
        # segments. The result is ordered and non-overlapping by construction.
        phases: list[MovementPhase] = []
        for label, start_ms, end_ms in zip(
            labels, boundaries[:-1], boundaries[1:]
        ):
            if end_ms > start_ms:
                phases.append(self._phase(label, start_ms, end_ms))

        # Guarantee a non-empty result for a non-empty timeline.
        if not phases:
            phases.append(self._phase(labels[0], t0, tN))
        return phases

    # ── Phase labelling (generic default, optional plugin override) ──

    def _phase_labels(self) -> tuple[str, ...]:
        """The ordered phase labels to apply to the generic segments.

        Defaults to the canonical generic vocabulary (Req 24.1). WHERE a plugin
        supplies its own ordered `movement_phases()`, those labels are used
        without changing the stage interface (Req 24.3). The generic
        segmentation produces five ordered segments, so a plugin override is
        only applied when it supplies exactly five labels; otherwise the
        canonical labels are kept so the generic contract is preserved.
        """
        if self._plugin is not None:
            try:
                plugin_phases = tuple(self._plugin.movement_phases())
            except Exception:  # pragma: no cover - defensive
                plugin_phases = ()
            if len(plugin_phases) == len(GENERIC_PHASES):
                return plugin_phases
        return GENERIC_PHASES

    @staticmethod
    def _phase(label: str, start_ms: float, end_ms: float) -> MovementPhase:
        return MovementPhase(phase=label, start_ms=start_ms, end_ms=end_ms)
