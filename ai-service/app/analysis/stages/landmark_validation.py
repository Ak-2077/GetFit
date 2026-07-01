"""
Landmark_Validation_Service — Pipeline Stage (Landmarks → Landmarks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Guards the pipeline against tracking errors by rejecting poses that are
anatomically impossible or that move implausibly between consecutive frames,
*before* the data reaches biomechanics and reasoning (Req 26.x). It sits after
the Pose_Confidence_Validator and before the Smoothing_Adapter and operates
additively — on success it returns its input unchanged.

It enforces four configured constraints, all read from configuration so the
stage hardcodes none of them (Req 26.4, 26.5):

  • Impossible bone length (Req 26.2) — each skeletal bone's length, measured
    RELATIVE to the subject's torso reference length, must lie within
    [BONE_LENGTH_MIN_RATIO, BONE_LENGTH_MAX_RATIO]. The ratio basis keeps the
    check resolution-independent (Req 7.4): a bone collapsing toward zero or
    stretching far beyond the torso is impossible regardless of subject scale.
  • Crossed bones (Req 26.2) — left/right symmetric limb segments (thighs,
    shins, upper arms, forearms) must not intersect; a left limb crossing its
    right counterpart indicates a tracking swap.
  • Impossible limb orientation (Req 26.1) — the unsigned angle at each hinge
    joint, formed by its two connected bones, must lie within the configured
    ANATOMICAL_ANGLE_BOUNDS for that joint.
  • Implausible frame-to-frame jump (Req 26.3) — no single landmark may move
    more than MAX_LANDMARK_JUMP (normalized) between consecutive frames.

The skeletal connectivity (which joints form bones, which limbs are symmetric,
which joints are hinges) is COCO-17 structure — see the joint indices in
`app/routers/pose.py` — and is a fixed structural constant here; only the
numeric thresholds come from configuration. The stage contains NO
exercise-specific logic (Req 26.5 / V2 26.5).

When any constraint is violated the stage returns a Structured_Error naming the
originating stage and the rejection cause (Req 26.4); like every stage it NEVER
raises on a domain failure (see `base.py`).
"""

from __future__ import annotations

import math

from app.core.config import Settings, settings

from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import FrameLandmarks, Landmarks

# ── COCO-17 joint indices (mirrors app/routers/pose.py) ──
NOSE, L_EYE, R_EYE, L_EAR, R_EAR = 0, 1, 2, 3, 4
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW = 7, 8
L_WRIST, R_WRIST = 9, 10
L_HIP, R_HIP = 11, 12
L_KNEE, R_KNEE = 13, 14
L_ANKLE, R_ANKLE = 15, 16

#: Number of landmarks in the COCO-17 convention.
COCO_KEYPOINTS = 17

# ── Stable error codes (Req 26.4) ──
# Req 26.4 does not mandate a code in the Req 15.2 set; these stable codes name
# the rejection cause distinctly, mirroring the extra codes used by
# video_validation for constraints with no dedicated Req 15.2 code.
IMPOSSIBLE_BONE_LENGTH = "IMPOSSIBLE_BONE_LENGTH"
CROSSED_BONES = "CROSSED_BONES"
IMPOSSIBLE_LIMB_ORIENTATION = "IMPOSSIBLE_LIMB_ORIENTATION"
IMPLAUSIBLE_LANDMARK_JUMP = "IMPLAUSIBLE_LANDMARK_JUMP"
# Pose has the wrong shape to be validated at all (not COCO-17).
MALFORMED_LANDMARKS = "MALFORMED_LANDMARKS"
# Aggregate code used when more than one constraint is violated at once.
INVALID_POSE = "INVALID_POSE"

#: Skeletal bones as (joint_a, joint_b) index pairs — the COCO-17 limb/torso
#: connectivity whose lengths are checked for plausibility (Req 26.2).
BONES: tuple[tuple[int, int], ...] = (
    (L_SHOULDER, R_SHOULDER),   # shoulder girdle
    (L_HIP, R_HIP),             # pelvis
    (L_SHOULDER, L_HIP),        # left torso side
    (R_SHOULDER, R_HIP),        # right torso side
    (L_SHOULDER, L_ELBOW),      # left upper arm
    (R_SHOULDER, R_ELBOW),      # right upper arm
    (L_ELBOW, L_WRIST),         # left forearm
    (R_ELBOW, R_WRIST),         # right forearm
    (L_HIP, L_KNEE),            # left thigh
    (R_HIP, R_KNEE),            # right thigh
    (L_KNEE, L_ANKLE),          # left shin
    (R_KNEE, R_ANKLE),          # right shin
)

#: Symmetric left/right limb segment pairs that must not cross one another
#: (Req 26.2). A crossing indicates a left/right tracking swap.
SYMMETRIC_LIMB_PAIRS: tuple[tuple[tuple[int, int], tuple[int, int], str], ...] = (
    ((L_HIP, L_KNEE), (R_HIP, R_KNEE), "thighs"),
    ((L_KNEE, L_ANKLE), (R_KNEE, R_ANKLE), "shins"),
    ((L_SHOULDER, L_ELBOW), (R_SHOULDER, R_ELBOW), "upper arms"),
    ((L_ELBOW, L_WRIST), (R_ELBOW, R_WRIST), "forearms"),
)

#: Hinge joints whose orientation is bounded (Req 26.1), each as
#: (config_key, (proximal, vertex, distal)) COCO-17 indices. The unsigned angle
#: at `vertex` formed by proximal-vertex-distal is checked against the
#: configured ANATOMICAL_ANGLE_BOUNDS entry under `config_key`.
HINGE_JOINTS: tuple[tuple[str, tuple[int, int, int]], ...] = (
    ("left_elbow", (L_SHOULDER, L_ELBOW, L_WRIST)),
    ("right_elbow", (R_SHOULDER, R_ELBOW, R_WRIST)),
    ("left_knee", (L_HIP, L_KNEE, L_ANKLE)),
    ("right_knee", (R_HIP, R_KNEE, R_ANKLE)),
)


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Euclidean distance between two 2D points."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _angle(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    """Unsigned angle at vertex ``b`` formed by ``a-b-c``, in degrees [0, 180].

    Mirrors ``calc_angle`` in app/routers/pose.py.
    """
    ba = (a[0] - b[0], a[1] - b[1])
    bc = (c[0] - b[0], c[1] - b[1])
    dot = ba[0] * bc[0] + ba[1] * bc[1]
    mag_ba = math.hypot(*ba) + 1e-9
    mag_bc = math.hypot(*bc) + 1e-9
    cosine = max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))
    return math.degrees(math.acos(cosine))


def _orientation(p: tuple[float, float], q: tuple[float, float], r: tuple[float, float]) -> int:
    """Orientation of the ordered triplet (p, q, r).

    Returns 0 if collinear, 1 if clockwise, 2 if counter-clockwise.
    """
    val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])
    if abs(val) < 1e-12:
        return 0
    return 1 if val > 0 else 2


def _on_segment(p: tuple[float, float], q: tuple[float, float], r: tuple[float, float]) -> bool:
    """True when point ``q`` lies on segment ``pr`` (given the three are collinear)."""
    return (
        min(p[0], r[0]) - 1e-12 <= q[0] <= max(p[0], r[0]) + 1e-12
        and min(p[1], r[1]) - 1e-12 <= q[1] <= max(p[1], r[1]) + 1e-12
    )


def _segments_intersect(
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    p4: tuple[float, float],
) -> bool:
    """Standard test: do segments ``p1p2`` and ``p3p4`` intersect?"""
    o1 = _orientation(p1, p2, p3)
    o2 = _orientation(p1, p2, p4)
    o3 = _orientation(p3, p4, p1)
    o4 = _orientation(p3, p4, p2)

    if o1 != o2 and o3 != o4:
        return True

    # Collinear special cases.
    if o1 == 0 and _on_segment(p1, p3, p2):
        return True
    if o2 == 0 and _on_segment(p1, p4, p2):
        return True
    if o3 == 0 and _on_segment(p3, p1, p4):
        return True
    if o4 == 0 and _on_segment(p3, p2, p4):
        return True
    return False


class LandmarkValidationService(PipelineStage[Landmarks, Landmarks]):
    """
    Reject anatomically impossible poses and implausible frame-to-frame
    landmark transitions, reading every threshold from configuration (Req 26.x).
    On success the input landmarks are returned unchanged (additive stage).
    """

    name: str = "landmark_validation"

    def __init__(self, config: Settings | None = None) -> None:
        # Thresholds are always read from configuration, never hardcoded
        # (Req 26.4, 26.5). A config override keeps the stage independently
        # testable (mirrors the other stages).
        self._cfg = config or settings

    async def run(self, data: Landmarks) -> StageResult[Landmarks]:
        violations: list[StructuredError] = []

        prev: FrameLandmarks | None = None
        for frame in data.frames:
            # Per-pose anatomical checks (Req 26.1, 26.2).
            violations.extend(self._check_pose(frame))
            # Frame-to-frame transition check (Req 26.3).
            if prev is not None:
                violations.extend(self._check_transition(prev, frame))
            prev = frame

        if violations:
            return StageResult(success=False, error=self._aggregate(violations))

        # Additive success: landmarks pass through unchanged.
        return StageResult(success=True, output=data)

    # ── Per-pose anatomical validation (Req 26.1, 26.2) ──

    def _check_pose(self, frame: FrameLandmarks) -> list[StructuredError]:
        pts = [(lm.x, lm.y) for lm in frame.landmarks]

        # The COCO-17 convention is required to map joints to bones.
        if len(pts) != COCO_KEYPOINTS:
            return [
                self._error(
                    MALFORMED_LANDMARKS,
                    f"Pose at {frame.timestamp_ms}ms has {len(pts)} landmarks; "
                    f"COCO-17 requires exactly {COCO_KEYPOINTS}.",
                )
            ]

        found: list[StructuredError] = []
        found.extend(self._check_bone_lengths(frame.timestamp_ms, pts))
        found.extend(self._check_crossed_bones(frame.timestamp_ms, pts))
        found.extend(self._check_orientation(frame.timestamp_ms, pts))
        return found

    def _reference_length(self, pts: list[tuple[float, float]]) -> float:
        """Torso reference length: mid-shoulder to mid-hip distance.

        Falls back to shoulder width, then to hip width, so the ratio basis is
        robust even when one girdle is degenerate.
        """
        mid_sh = (
            (pts[L_SHOULDER][0] + pts[R_SHOULDER][0]) / 2.0,
            (pts[L_SHOULDER][1] + pts[R_SHOULDER][1]) / 2.0,
        )
        mid_hip = (
            (pts[L_HIP][0] + pts[R_HIP][0]) / 2.0,
            (pts[L_HIP][1] + pts[R_HIP][1]) / 2.0,
        )
        torso = _distance(mid_sh, mid_hip)
        if torso > 1e-6:
            return torso
        shoulders = _distance(pts[L_SHOULDER], pts[R_SHOULDER])
        if shoulders > 1e-6:
            return shoulders
        return _distance(pts[L_HIP], pts[R_HIP])

    def _check_bone_lengths(
        self, timestamp_ms: float, pts: list[tuple[float, float]]
    ) -> list[StructuredError]:
        """Reject bones whose torso-relative length is outside configured bounds (Req 26.2)."""
        ref = self._reference_length(pts)
        if ref <= 1e-6:
            # A fully collapsed skeleton (every reference joint coincident) is
            # itself anatomically impossible.
            return [
                self._error(
                    IMPOSSIBLE_BONE_LENGTH,
                    f"Pose at {timestamp_ms}ms has a degenerate torso "
                    "(zero reference length); cannot represent a real body.",
                )
            ]

        lo = self._cfg.BONE_LENGTH_MIN_RATIO
        hi = self._cfg.BONE_LENGTH_MAX_RATIO
        found: list[StructuredError] = []
        for a, b in BONES:
            ratio = _distance(pts[a], pts[b]) / ref
            if ratio < lo or ratio > hi:
                found.append(
                    self._error(
                        IMPOSSIBLE_BONE_LENGTH,
                        f"Bone ({a},{b}) at {timestamp_ms}ms has implausible "
                        f"torso-relative length {ratio:.3f} (allowed "
                        f"[{lo}, {hi}]).",
                    )
                )
        return found

    def _check_crossed_bones(
        self, timestamp_ms: float, pts: list[tuple[float, float]]
    ) -> list[StructuredError]:
        """Reject symmetric left/right limb segments that intersect (Req 26.2)."""
        found: list[StructuredError] = []
        for (la, lb), (ra, rb), label in SYMMETRIC_LIMB_PAIRS:
            if _segments_intersect(pts[la], pts[lb], pts[ra], pts[rb]):
                found.append(
                    self._error(
                        CROSSED_BONES,
                        f"Left and right {label} cross at {timestamp_ms}ms, "
                        "indicating a left/right tracking swap.",
                    )
                )
        return found

    def _check_orientation(
        self, timestamp_ms: float, pts: list[tuple[float, float]]
    ) -> list[StructuredError]:
        """Reject hinge joints whose angle is outside configured bounds (Req 26.1)."""
        bounds = self._cfg.ANATOMICAL_ANGLE_BOUNDS
        found: list[StructuredError] = []
        for key, (a_idx, b_idx, c_idx) in HINGE_JOINTS:
            bound = bounds.get(key)
            if not bound:
                continue
            lo, hi = bound[0], bound[1]
            angle = _angle(pts[a_idx], pts[b_idx], pts[c_idx])
            if angle < lo or angle > hi:
                found.append(
                    self._error(
                        IMPOSSIBLE_LIMB_ORIENTATION,
                        f"Joint '{key}' at {timestamp_ms}ms has impossible "
                        f"orientation: angle {angle:.1f}° outside allowed "
                        f"[{lo}, {hi}]°.",
                    )
                )
        return found

    # ── Frame-to-frame transition validation (Req 26.3) ──

    def _check_transition(
        self, prev: FrameLandmarks, curr: FrameLandmarks
    ) -> list[StructuredError]:
        """Reject any single landmark moving more than MAX_LANDMARK_JUMP (Req 26.3)."""
        max_jump = self._cfg.MAX_LANDMARK_JUMP
        found: list[StructuredError] = []
        # Compare only the landmarks the two frames share by position index.
        for i in range(min(len(prev.landmarks), len(curr.landmarks))):
            p = prev.landmarks[i]
            c = curr.landmarks[i]
            jump = _distance((p.x, p.y), (c.x, c.y))
            if jump > max_jump:
                found.append(
                    self._error(
                        IMPLAUSIBLE_LANDMARK_JUMP,
                        f"Landmark {i} jumped {jump:.3f} between "
                        f"{prev.timestamp_ms}ms and {curr.timestamp_ms}ms, "
                        f"exceeding the maximum of {max_jump}.",
                    )
                )
        return found

    # ── Internal construction helpers ──

    def _error(self, code: str, message: str) -> StructuredError:
        return StructuredError(code=code, message=message, stage=self.name)

    def _aggregate(self, violations: list[StructuredError]) -> StructuredError:
        """Fold one or more violations into a single Structured_Error (Req 26.4).

        When exactly one constraint is violated the top-level ``code`` is that
        constraint's code; when several are violated the top-level ``code`` is
        the aggregate ``INVALID_POSE``. In both cases every violation is
        preserved in ``details`` so the rejection cause is fully named.
        """
        if len(violations) == 1:
            single = violations[0]
            return StructuredError(
                code=single.code,
                message=single.message,
                stage=self.name,
                details=list(violations),
            )

        codes = ", ".join(dict.fromkeys(v.code for v in violations))
        return StructuredError(
            code=INVALID_POSE,
            message=f"Pose failed {len(violations)} landmark validation "
            f"constraints: {codes}.",
            stage=self.name,
            details=list(violations),
        )
