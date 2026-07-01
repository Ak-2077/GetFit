"""
Biomechanics_Service — Pipeline Stage 8 (MovementTimeline → ObjectiveMetrics)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Computes objective biomechanical metrics from the Movement_Timeline using
deterministic mathematics ONLY (Req 9.1). No language-model inference of any
kind participates in this stage (Req 9.2): every value is a closed-form
function of the timeline's joint positions, joint angles, and timestamps.

The stage produces the complete set of Objective_Metrics required by Req 9.3:
joint angles, bar path, depth, range of motion, tempo, symmetry, center of
mass, and balance — plus a bounded metric confidence.

Determinism (Req 9.4): the same Movement_Timeline always yields identical
Objective_Metrics. To guarantee this the stage:
  • never uses randomness;
  • iterates timeline entries in their given order and every mapping by SORTED
    key, so no dict-ordering nondeterminism can leak into a floating-point sum;
  • derives every metric purely from the input data.

It reuses the deterministic joint-angle math seeded in `app/routers/pose.py`
(`calc_angle` and the COCO-17 keypoint convention): wherever a recognized
COCO-17 joint triplet is present in an entry's `joint_positions`, the joint
angle is (re)computed with `calc_angle`; otherwise the entry's precomputed
`joint_angles` are used.

Like every stage it NEVER raises on a domain failure — it returns a
`StageResult` (see `base.py`). A degenerate or empty timeline yields
zero/identity metrics rather than an error (design.md edge cases).
"""

from __future__ import annotations

from app.routers.pose import calc_angle

from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import MovementTimeline, ObjectiveMetrics, TimelineEntry

# Stable error code for the (non-domain) unexpected-failure guard.
BIOMECHANICS_ERROR = "BIOMECHANICS_ERROR"

# Decimal places used to round every emitted metric. Rounding is itself a
# deterministic operation; it only tidies floating-point output and never
# affects the determinism guarantee (Req 9.4).
_ROUND = 6

#: COCO-17 joint angles expressed by NAME, mirroring the joint definitions in
#: `app/routers/pose.py` (FORM_RULES) and the COCO-17 keypoint convention. Each
#: entry maps an angle name to the (proximal, vertex, distal) position keys; the
#: angle is the one at `vertex`, computed by `calc_angle`. These names match the
#: COCO-17 keypoint names a Timeline_Builder is expected to use for
#: `joint_positions`. When the three named positions are present the angle is
#: computed here (reusing pose.py); otherwise the entry's own `joint_angles`
#: value (if any) is used as a fall back.
ANGLE_JOINTS: dict[str, tuple[str, str, str]] = {
    "left_elbow": ("left_shoulder", "left_elbow", "left_wrist"),
    "right_elbow": ("right_shoulder", "right_elbow", "right_wrist"),
    "left_knee": ("left_hip", "left_knee", "left_ankle"),
    "right_knee": ("right_hip", "right_knee", "right_ankle"),
    "left_hip": ("left_shoulder", "left_hip", "left_knee"),
    "right_hip": ("right_shoulder", "right_hip", "right_knee"),
    "left_shoulder": ("left_elbow", "left_shoulder", "left_hip"),
    "right_shoulder": ("right_elbow", "right_shoulder", "right_hip"),
}

#: Position-key name fragments used to locate the "bar" reference point (the
#: hands) and the vertical-depth reference (the hips). Matching is by exact
#: name; absent any match the stage falls back to the whole-body centroid.
WRIST_KEYS: tuple[str, ...] = ("left_wrist", "right_wrist")
HIP_KEYS: tuple[str, ...] = ("left_hip", "right_hip")


def _point2d(pos: list[float]) -> tuple[float, float] | None:
    """Interpret a stored joint position as a 2D point ``(x, y)``.

    Positions are normalized, resolution-independent vectors (Req 7.4). Only the
    first two components are used; a vector with fewer than two components is not
    a usable point and yields ``None``.
    """
    if pos is None or len(pos) < 2:
        return None
    return (float(pos[0]), float(pos[1]))


def _mean_point(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Deterministic centroid of 2D points, or ``None`` when empty."""
    if not points:
        return None
    n = float(len(points))
    return (sum(p[0] for p in points) / n, sum(p[1] for p in points) / n)


def _entry_points(entry: TimelineEntry) -> list[tuple[float, float]]:
    """All usable 2D joint points of an entry, ordered by SORTED joint name.

    Sorted iteration makes the resulting list — and therefore every centroid
    and sum derived from it — independent of the mapping's insertion order
    (Req 9.4).
    """
    points: list[tuple[float, float]] = []
    for name in sorted(entry.joint_positions):
        pt = _point2d(entry.joint_positions[name])
        if pt is not None:
            points.append(pt)
    return points


def _named_points(
    entry: TimelineEntry, keys: tuple[str, ...]
) -> list[tuple[float, float]]:
    """Usable 2D points for the given position keys, in the keys' given order."""
    points: list[tuple[float, float]] = []
    for key in keys:
        pos = entry.joint_positions.get(key)
        if pos is not None:
            pt = _point2d(pos)
            if pt is not None:
                points.append(pt)
    return points


def _entry_angles(entry: TimelineEntry) -> dict[str, float]:
    """Resolve an entry's joint angles, preferring `calc_angle` over positions.

    For every recognized COCO-17 joint whose three named positions are present,
    the angle at the vertex is recomputed deterministically with `calc_angle`
    (reusing the pose.py math, Req 9.1). Any joint not recomputable from
    positions keeps the entry's precomputed `joint_angles` value, so the stage
    works whether or not the Timeline_Builder named its positions in the COCO-17
    convention.
    """
    angles: dict[str, float] = dict(entry.joint_angles)
    for name in sorted(ANGLE_JOINTS):
        a_key, b_key, c_key = ANGLE_JOINTS[name]
        a = entry.joint_positions.get(a_key)
        b = entry.joint_positions.get(b_key)
        c = entry.joint_positions.get(c_key)
        if a is None or b is None or c is None:
            continue
        pa, pb, pc = _point2d(a), _point2d(b), _point2d(c)
        if pa is None or pb is None or pc is None:
            continue
        angles[name] = calc_angle(list(pa), list(pb), list(pc))
    return angles


def _clamp01(value: float) -> float:
    """Clamp a value into the closed interval [0.0, 1.0]."""
    return max(0.0, min(1.0, value))


class BiomechanicsService(PipelineStage[MovementTimeline, ObjectiveMetrics]):
    """
    Stage 8: compute deterministic Objective_Metrics from a Movement_Timeline.

    Math only — no language-model reasoning (Req 9.1, 9.2). The same timeline
    always produces identical metrics (Req 9.4).
    """

    name: str = "biomechanics"

    async def run(self, data: MovementTimeline) -> StageResult[ObjectiveMetrics]:
        try:
            metrics = self._compute(data)
        except Exception:  # pragma: no cover - defensive; never raise (base.py)
            return StageResult(
                success=False,
                error=StructuredError(
                    code=BIOMECHANICS_ERROR,
                    message="Failed to compute biomechanical metrics.",
                    stage=self.name,
                ),
            )
        return StageResult(success=True, output=metrics)

    # ── Deterministic metric computation (Req 9.1, 9.3) ──

    def _compute(self, timeline: MovementTimeline) -> ObjectiveMetrics:
        entries = timeline.entries

        # Degenerate/empty timeline → zero/identity metrics (design.md edge
        # case); identity values are chosen so a still subject reads as
        # perfectly symmetric and balanced with no measured movement.
        if not entries:
            return ObjectiveMetrics(
                joint_angles={},
                bar_path=[],
                depth=0.0,
                range_of_motion={},
                tempo=0.0,
                symmetry=1.0,
                center_of_mass=[0.0, 0.0],
                balance=1.0,
                confidence=0.0,
            )

        per_entry_angles = [_entry_angles(e) for e in entries]

        joint_angles = self._mean_joint_angles(per_entry_angles)
        range_of_motion = self._range_of_motion(per_entry_angles)
        bar_path = self._bar_path(entries)
        depth = self._depth(entries)
        tempo = self._tempo(entries)
        symmetry = self._symmetry(joint_angles)
        center_of_mass, balance = self._center_of_mass_and_balance(entries)
        confidence = self._confidence(entries, per_entry_angles)

        return ObjectiveMetrics(
            joint_angles=joint_angles,
            bar_path=bar_path,
            depth=depth,
            range_of_motion=range_of_motion,
            tempo=tempo,
            symmetry=symmetry,
            center_of_mass=center_of_mass,
            balance=balance,
            confidence=confidence,
        )

    def _mean_joint_angles(
        self, per_entry_angles: list[dict[str, float]]
    ) -> dict[str, float]:
        """Representative angle per joint: mean over entries where it appears."""
        totals: dict[str, float] = {}
        counts: dict[str, int] = {}
        for angles in per_entry_angles:
            for name in sorted(angles):
                totals[name] = totals.get(name, 0.0) + angles[name]
                counts[name] = counts.get(name, 0) + 1
        return {
            name: round(totals[name] / counts[name], _ROUND)
            for name in sorted(totals)
        }

    def _range_of_motion(
        self, per_entry_angles: list[dict[str, float]]
    ) -> dict[str, float]:
        """Per-joint angular travel: max angle minus min angle across entries."""
        mins: dict[str, float] = {}
        maxs: dict[str, float] = {}
        for angles in per_entry_angles:
            for name in sorted(angles):
                val = angles[name]
                if name not in mins or val < mins[name]:
                    mins[name] = val
                if name not in maxs or val > maxs[name]:
                    maxs[name] = val
        return {
            name: round(maxs[name] - mins[name], _ROUND) for name in sorted(maxs)
        }

    def _bar_path(self, entries: list[TimelineEntry]) -> list[list[float]]:
        """Trajectory of the hand (bar) reference point, one point per entry.

        Uses the mean of the wrist positions when available, otherwise the
        whole-body centroid, so the path is always defined.
        """
        path: list[list[float]] = []
        for entry in entries:
            point = _mean_point(_named_points(entry, WRIST_KEYS))
            if point is None:
                point = _mean_point(_entry_points(entry))
            if point is None:
                continue
            path.append([round(point[0], _ROUND), round(point[1], _ROUND)])
        return path

    def _depth(self, entries: list[TimelineEntry]) -> float:
        """Vertical travel of the hips (or body centroid): max minus min y.

        Coordinates are normalized to [0, 1] (Req 7.4) so depth is in [0, 1].
        """
        ys: list[float] = []
        for entry in entries:
            point = _mean_point(_named_points(entry, HIP_KEYS))
            if point is None:
                point = _mean_point(_entry_points(entry))
            if point is not None:
                ys.append(point[1])
        if not ys:
            return 0.0
        return round(max(ys) - min(ys), _ROUND)

    def _tempo(self, entries: list[TimelineEntry]) -> float:
        """Total movement duration in seconds (last minus first timestamp).

        Timestamps are ordered by the Movement_Timeline (Req 8.1); a single
        entry has zero duration.
        """
        if len(entries) < 2:
            return 0.0
        span_ms = entries[-1].timestamp_ms - entries[0].timestamp_ms
        return round(max(0.0, span_ms) / 1000.0, _ROUND)

    def _symmetry(self, joint_angles: dict[str, float]) -> float:
        """Left/right agreement of symmetric joint angles, in [0, 1].

        For every base joint with both a ``left_*`` and ``right_*`` angle, the
        absolute angular difference is averaged and mapped to [0, 1] (1.0 =
        perfectly symmetric). With no symmetric pair the body is treated as
        symmetric (1.0).
        """
        diffs: list[float] = []
        for name in sorted(joint_angles):
            if not name.startswith("left_"):
                continue
            base = name[len("left_"):]
            right = "right_" + base
            if right in joint_angles:
                diffs.append(abs(joint_angles[name] - joint_angles[right]))
        if not diffs:
            return 1.0
        mean_diff = sum(diffs) / len(diffs)
        # Normalize against the 180° maximum possible angular difference.
        return round(_clamp01(1.0 - mean_diff / 180.0), _ROUND)

    def _center_of_mass_and_balance(
        self, entries: list[TimelineEntry]
    ) -> tuple[list[float], float]:
        """Mean body centroid over time, plus a balance score in [0, 1].

        The center of mass is the average of every entry's whole-body centroid.
        Balance measures how little that centroid wanders: it is 1.0 minus the
        mean distance of the per-entry centroids from the overall center of
        mass, clamped to [0, 1] (a perfectly still centroid scores 1.0).
        """
        centroids: list[tuple[float, float]] = []
        for entry in entries:
            centroid = _mean_point(_entry_points(entry))
            if centroid is not None:
                centroids.append(centroid)

        if not centroids:
            return [0.0, 0.0], 1.0

        com = _mean_point(centroids)
        assert com is not None  # non-empty centroids guarantees a mean
        mean_drift = sum(
            ((c[0] - com[0]) ** 2 + (c[1] - com[1]) ** 2) ** 0.5 for c in centroids
        ) / len(centroids)
        balance = round(_clamp01(1.0 - mean_drift), _ROUND)
        return [round(com[0], _ROUND), round(com[1], _ROUND)], balance

    def _confidence(
        self,
        entries: list[TimelineEntry],
        per_entry_angles: list[dict[str, float]],
    ) -> float:
        """Bounded metric confidence from data completeness, in [0, 1].

        Confidence reflects the fraction of timeline entries that carried usable
        joint data (positions or angles) from which metrics could be computed.
        """
        if not entries:
            return 0.0
        usable = sum(
            1
            for entry, angles in zip(entries, per_entry_angles)
            if _entry_points(entry) or angles
        )
        return round(_clamp01(usable / len(entries)), _ROUND)
