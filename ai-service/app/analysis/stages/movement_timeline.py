"""
Movement_Timeline_Service — Pipeline Stage 7 (Landmarks → MovementTimeline)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Converts the per-frame normalized landmarks produced by the
Pose_Extraction_Service into a single, time-ordered movement sequence that
serves as the source of truth for every downstream analytical stage
(biomechanics, reps, phases, reasoning).

Responsibilities (single-responsibility, behind the PipelineStage interface):
  • Construct a Movement_Timeline ordered by frame timestamp (Req 8.1).
  • Populate every timeline entry with joint positions, joint angles, joint
    velocity, joint acceleration, and movement direction (Req 8.2).
  • Compute velocity and acceleration from the timestamps associated with each
    frame using finite differences over the inter-frame interval (Req 8.4).

Phase segmentation (Req 8.3) is intentionally NOT performed here — it is the
dedicated responsibility of the `Movement_Phase_Service` (a separate stage that
consumes the Movement_Timeline this stage produces).

Math reuse
----------
Joint-angle computation reuses `calc_angle` and the COCO-17 keypoint indices
from `app/routers/pose.py`, so the angle convention is identical to the
existing single-frame pose analysis.

Derivative convention
----------------------
Velocity and acceleration are scalar magnitudes derived from successive joint
positions over the inter-frame time interval (Δt, in milliseconds):

    velocity[i]      = |position[i] − position[i−1]| / (t[i] − t[i−1])
    acceleration[i]  = (velocity[i] − velocity[i−1]) / (t[i] − t[i−1])
    direction[i]     = atan2(Δy, Δx) in degrees   (heading of the displacement)

The first entry has no predecessor, so its velocity, acceleration, and
direction default to 0.0. When two successive frames share a timestamp (Δt ≤ 0)
the derivatives for that step default to 0.0 rather than dividing by zero; the
timeline can contain equal timestamps because Req 8.1 only requires a
non-decreasing order.

Following the pipeline contract in `base.py`, this stage NEVER raises on a
domain failure — it returns a `StageResult` (success/error).
"""

from __future__ import annotations

import math

from app.routers.pose import (
    calc_angle,
    L_ANKLE,
    L_ELBOW,
    L_HIP,
    L_KNEE,
    L_SHOULDER,
    L_WRIST,
    R_ANKLE,
    R_ELBOW,
    R_HIP,
    R_KNEE,
    R_SHOULDER,
    R_WRIST,
)

from ..base import PipelineStage, StageResult
from ..contracts import Landmarks, MovementTimeline, TimelineEntry

#: COCO-17 keypoint names in fixed joint order (matches the index constants in
#: `app/routers/pose.py`). The position/velocity/acceleration/direction maps are
#: keyed by these names so downstream stages can address joints symbolically.
COCO_KEYPOINT_NAMES: tuple[str, ...] = (
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
)

#: Hinge-joint angle definitions, each a triple of COCO-17 indices (a, b, c)
#: where the angle is measured at vertex `b`. Reuses the index constants and the
#: `calc_angle` convention from `app/routers/pose.py`.
JOINT_ANGLE_DEFS: dict[str, tuple[int, int, int]] = {
    "left_elbow": (L_SHOULDER, L_ELBOW, L_WRIST),
    "right_elbow": (R_SHOULDER, R_ELBOW, R_WRIST),
    "left_shoulder": (L_ELBOW, L_SHOULDER, L_HIP),
    "right_shoulder": (R_ELBOW, R_SHOULDER, R_HIP),
    "left_hip": (L_SHOULDER, L_HIP, L_KNEE),
    "right_hip": (R_SHOULDER, R_HIP, R_KNEE),
    "left_knee": (L_HIP, L_KNEE, L_ANKLE),
    "right_knee": (R_HIP, R_KNEE, R_ANKLE),
}


class MovementTimelineService(PipelineStage[Landmarks, MovementTimeline]):
    """
    Stage 7: build the time-ordered Movement_Timeline from per-frame landmarks.

    The timeline is the single source of truth for downstream motion analysis,
    so every entry is fully populated (positions, angles, velocity,
    acceleration, direction) and ordered non-decreasing by timestamp (Req 8.1,
    8.2). Velocity and acceleration are finite differences over the inter-frame
    interval (Req 8.4).
    """

    name: str = "movement_timeline"

    async def run(self, data: Landmarks) -> StageResult[MovementTimeline]:
        # ── Order frames by timestamp (Req 8.1) ──
        # A stable sort keeps frames that share a timestamp in their original
        # relative order, so the timeline is non-decreasing by timestamp_ms.
        frames = sorted(data.frames, key=lambda fl: fl.timestamp_ms)

        entries: list[TimelineEntry] = []
        # Carry the previous frame's positions, timestamp, and per-joint speed
        # forward so velocity (1st derivative) and acceleration (2nd derivative)
        # can be computed as finite differences across successive frames.
        prev_positions: dict[str, list[float]] | None = None
        prev_timestamp: float | None = None
        prev_velocity: dict[str, float] = {}

        for frame in frames:
            positions = self._joint_positions(frame)
            angles = self._joint_angles(frame)

            velocity: dict[str, float] = {}
            acceleration: dict[str, float] = {}
            direction: dict[str, float] = {}

            if prev_positions is None or prev_timestamp is None:
                # First entry: no predecessor, so all derivatives are zero and
                # the joint has no established movement direction yet.
                for name in positions:
                    velocity[name] = 0.0
                    acceleration[name] = 0.0
                    direction[name] = 0.0
            else:
                dt = frame.timestamp_ms - prev_timestamp
                for name, pos in positions.items():
                    prev_pos = prev_positions.get(name)
                    # Only joints present in BOTH frames have a well-defined
                    # finite difference; otherwise fall back to zero.
                    if prev_pos is None or dt <= 0.0:
                        velocity[name] = 0.0
                        acceleration[name] = 0.0
                        direction[name] = 0.0
                        continue

                    dx = pos[0] - prev_pos[0]
                    dy = pos[1] - prev_pos[1]
                    displacement = math.hypot(dx, dy)

                    speed = displacement / dt              # Req 8.4
                    velocity[name] = speed
                    direction[name] = math.degrees(math.atan2(dy, dx))
                    # Acceleration = change in speed over the same interval.
                    acceleration[name] = (speed - prev_velocity.get(name, 0.0)) / dt

            entries.append(
                TimelineEntry(
                    timestamp_ms=frame.timestamp_ms,
                    joint_positions=positions,
                    joint_angles=angles,
                    joint_velocity=velocity,
                    joint_acceleration=acceleration,
                    movement_direction=direction,
                )
            )

            prev_positions = positions
            prev_timestamp = frame.timestamp_ms
            prev_velocity = velocity

        return StageResult(
            success=True,
            output=MovementTimeline(entries=entries),
        )

    @staticmethod
    def _joint_positions(frame) -> dict[str, list[float]]:
        """
        Map each available COCO-17 landmark to its normalized [x, y, z] position.

        Only indices present in the frame's landmark list are included, so the
        stage degrades gracefully if a pose engine emits fewer than 17 joints.
        """
        positions: dict[str, list[float]] = {}
        lms = frame.landmarks
        for idx, name in enumerate(COCO_KEYPOINT_NAMES):
            if idx < len(lms):
                lm = lms[idx]
                positions[name] = [lm.x, lm.y, lm.z]
        return positions

    @staticmethod
    def _joint_angles(frame) -> dict[str, float]:
        """
        Compute each hinge-joint angle (in degrees) using `calc_angle` and the
        COCO-17 index triples, for every joint whose three landmarks exist.
        """
        angles: dict[str, float] = {}
        lms = frame.landmarks
        n = len(lms)
        for name, (a_idx, b_idx, c_idx) in JOINT_ANGLE_DEFS.items():
            if a_idx < n and b_idx < n and c_idx < n:
                a = [lms[a_idx].x, lms[a_idx].y]
                b = [lms[b_idx].x, lms[b_idx].y]
                c = [lms[c_idx].x, lms[c_idx].y]
                angles[name] = calc_angle(a, b, c)
        return angles
