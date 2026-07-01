"""
Property-based tests for the Landmark_Validation_Service
(app/analysis/stages/landmark_validation.py).

Covers design Property 17 — "Landmark validation rejects implausible poses and
transitions" — using Hypothesis with a minimum of 100 iterations.

Validates: Requirements 26.1, 26.2, 26.3
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.contracts import (
    FrameLandmarks,
    Landmark,
    Landmarks,
    VideoMeta,
)
from app.analysis.stages.landmark_validation import (
    CROSSED_BONES,
    IMPLAUSIBLE_LANDMARK_JUMP,
    IMPOSSIBLE_BONE_LENGTH,
    IMPOSSIBLE_LIMB_ORIENTATION,
    L_ANKLE,
    L_ELBOW,
    L_HIP,
    L_KNEE,
    L_SHOULDER,
    L_WRIST,
    NOSE,
    R_ANKLE,
    R_ELBOW,
    R_HIP,
    R_KNEE,
    R_SHOULDER,
    R_WRIST,
    LandmarkValidationService,
)
from app.core.config import Settings

# ── Fixtures / constants ──────────────────────────────────────────────────

#: A fixed, fully valid VideoMeta — landmark validation never inspects it, so a
#: single constant suffices as the source metadata for every generated pose.
_VIDEO_META = VideoMeta(
    container_format="mp4",
    codec="h264",
    duration_sec=10.0,
    width=1080,
    height=1920,
    fps=30.0,
    size_bytes=10_000_000,
    orientation="portrait",
)

#: A canonical, anatomically plausible standing COCO-17 pose in normalized
#: [0,1] image coordinates (y increases downward). Left-side joints sit at
#: smaller x than their right-side counterparts so symmetric limbs never cross;
#: every bone's torso-relative length lands inside the configured ratio bounds;
#: the torso reference (mid-shoulder → mid-hip) is exactly 0.25.
BASE_POSE: tuple[tuple[float, float], ...] = (
    (0.50, 0.18),  # 0  nose
    (0.47, 0.16),  # 1  left eye
    (0.53, 0.16),  # 2  right eye
    (0.45, 0.17),  # 3  left ear
    (0.55, 0.17),  # 4  right ear
    (0.42, 0.30),  # 5  left shoulder
    (0.58, 0.30),  # 6  right shoulder
    (0.40, 0.42),  # 7  left elbow
    (0.60, 0.42),  # 8  right elbow
    (0.39, 0.53),  # 9  left wrist
    (0.61, 0.53),  # 10 right wrist
    (0.45, 0.55),  # 11 left hip
    (0.55, 0.55),  # 12 right hip
    (0.44, 0.72),  # 13 left knee
    (0.56, 0.72),  # 14 right knee
    (0.44, 0.90),  # 15 left ankle
    (0.56, 0.90),  # 16 right ankle
)

#: Centroid-ish anchor used for scale transforms that keep the pose in-frame.
_CX, _CY = 0.50, 0.54


# ── Builders ───────────────────────────────────────────────────────────────

def _frame(points: list[tuple[float, float]], timestamp_ms: float) -> FrameLandmarks:
    return FrameLandmarks(
        timestamp_ms=timestamp_ms,
        landmarks=[Landmark(x=x, y=y, z=0.0, confidence=0.9) for x, y in points],
        overall_confidence=0.9,
    )


def _landmarks(frames: list[FrameLandmarks]) -> Landmarks:
    return Landmarks(frames=frames, source_meta=_VIDEO_META, pose_engine="test")


def _run(stage: LandmarkValidationService, data: Landmarks):
    return asyncio.run(stage.run(data))


def _reported_codes(result) -> set[str]:
    """The set of rejection-cause codes carried by a failed StageResult.

    A single violation surfaces its own code at the top level; multiple
    violations surface the ``INVALID_POSE`` aggregate. In both cases every
    cause is preserved in ``details`` (the service names the cause there), so
    the reported set is taken from ``details`` when present.
    """
    if result.success:
        return set()
    err = result.error
    if err.details:
        return {d.code for d in err.details}
    return {err.code}


# ── Generators ───────────────────────────────────────────────────────────
# Translation and uniform scale are exactly the transforms that preserve every
# anatomical constraint: bone *ratios*, joint *angles*, and left/right ordering
# are all invariant under them. Combined with tiny per-landmark jitter this
# yields a wide family of poses that are all genuinely valid, so a single
# generator drives both the "valid passes" property and the targeted-violation
# properties (which inject one defect into an otherwise-valid pose).

def _transform(
    scale: float, tx: float, ty: float, jitter: list[tuple[float, float]]
) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for (x, y), (jx, jy) in zip(BASE_POSE, jitter):
        nx = _CX + (x - _CX) * scale + tx + jx
        ny = _CY + (y - _CY) * scale + ty + jy
        pts.append((nx, ny))
    return pts


_JITTER = st.lists(
    st.tuples(
        st.floats(min_value=-0.005, max_value=0.005),
        st.floats(min_value=-0.005, max_value=0.005),
    ),
    min_size=len(BASE_POSE),
    max_size=len(BASE_POSE),
)


@st.composite
def valid_pose_points(draw) -> list[tuple[float, float]]:
    scale = draw(st.floats(min_value=0.85, max_value=1.15))
    tx = draw(st.floats(min_value=-0.02, max_value=0.02))
    ty = draw(st.floats(min_value=-0.02, max_value=0.02))
    return _transform(scale, tx, ty, draw(_JITTER))


@st.composite
def compact_pose_points(draw) -> list[tuple[float, float]]:
    """A valid pose held within scale <= 1.0 and no offset, leaving headroom for
    a sequence of small inter-frame translations to stay inside [0,1]."""
    scale = draw(st.floats(min_value=0.85, max_value=1.0))
    return _transform(scale, 0.0, 0.0, draw(_JITTER))


# ── Property 17 ─────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 17: Landmark validation rejects
# implausible poses and transitions — an anatomically valid pose with small
# inter-frame motion passes unchanged, while a pose carrying any single
# anatomical defect (impossible bone length, crossed bones, impossible limb
# orientation) or an implausible frame-to-frame jump is rejected with a
# Structured_Error naming that cause.


@given(pts=valid_pose_points())
@settings(max_examples=150)
def test_valid_pose_passes(pts):
    # A plausible single-frame pose is accepted and passed through unchanged.
    data = _landmarks([_frame(pts, 0.0)])
    result = _run(LandmarkValidationService(), data)

    assert result.success is True
    assert result.error is None
    assert result.output is data  # additive stage: input returned unchanged


@given(pts=compact_pose_points(), steps=st.integers(min_value=1, max_value=3))
@settings(max_examples=120)
def test_valid_sequence_with_small_motion_passes(pts, steps):
    # Consecutive frames separated by small translations (< MAX_LANDMARK_JUMP)
    # are an admissible transition, so the whole sequence passes.
    frames = [_frame(pts, 0.0)]
    current = pts
    for i in range(steps):
        current = [(x + 0.03, y + 0.02) for x, y in current]  # ~0.036 < 0.25
        frames.append(_frame(current, float((i + 1) * 40)))
    result = _run(LandmarkValidationService(), _landmarks(frames))

    assert result.success is True
    assert result.error is None


# Limb bones that can be collapsed without disturbing the torso reference.
_COLLAPSIBLE_BONES = st.sampled_from(
    [
        (L_SHOULDER, L_ELBOW),
        (R_SHOULDER, R_ELBOW),
        (L_ELBOW, L_WRIST),
        (R_ELBOW, R_WRIST),
        (L_HIP, L_KNEE),
        (R_HIP, R_KNEE),
        (L_KNEE, L_ANKLE),
        (R_KNEE, R_ANKLE),
    ]
)


@given(pts=valid_pose_points(), bone=_COLLAPSIBLE_BONES)
@settings(max_examples=120)
def test_impossible_bone_length_is_rejected(pts, bone):
    # Req 26.2: collapsing a bone to zero length drives its torso-relative ratio
    # below BONE_LENGTH_MIN_RATIO — anatomically impossible.
    a, b = bone
    pts = list(pts)
    pts[b] = pts[a]  # collapse: endpoint coincides with its joint
    result = _run(LandmarkValidationService(), _landmarks([_frame(pts, 0.0)]))

    assert result.success is False
    assert IMPOSSIBLE_BONE_LENGTH in _reported_codes(result)
    assert result.error.stage == "landmark_validation"


@given(pts=valid_pose_points())
@settings(max_examples=120)
def test_crossed_bones_is_rejected(pts):
    # Req 26.2: swapping the left/right knees and ankles makes the symmetric
    # limb segments intersect — the signature of a left/right tracking swap.
    pts = list(pts)
    pts[L_KNEE], pts[R_KNEE] = pts[R_KNEE], pts[L_KNEE]
    pts[L_ANKLE], pts[R_ANKLE] = pts[R_ANKLE], pts[L_ANKLE]
    result = _run(LandmarkValidationService(), _landmarks([_frame(pts, 0.0)]))

    assert result.success is False
    assert CROSSED_BONES in _reported_codes(result)
    assert result.error.stage == "landmark_validation"


def _tight_elbow_config() -> Settings:
    """Config that bounds the left elbow to [0, 90]; other joints unrestricted."""
    return Settings(
        ANATOMICAL_ANGLE_BOUNDS={
            "left_elbow": [0.0, 90.0],
            "right_elbow": [0.0, 180.0],
            "left_knee": [0.0, 180.0],
            "right_knee": [0.0, 180.0],
        }
    )


@given(pts=valid_pose_points())
@settings(max_examples=120)
def test_impossible_limb_orientation_is_rejected(pts):
    # Req 26.1: the canonical pose holds the left elbow nearly straight (~175°).
    # Under a config that bounds the left elbow to [0, 90], that orientation is
    # impossible, so the pose is rejected naming the orientation cause.
    stage = LandmarkValidationService(config=_tight_elbow_config())
    result = _run(stage, _landmarks([_frame(list(pts), 0.0)]))

    assert result.success is False
    assert IMPOSSIBLE_LIMB_ORIENTATION in _reported_codes(result)
    assert result.error.stage == "landmark_validation"


@given(
    pts=valid_pose_points(),
    jump=st.floats(min_value=0.26, max_value=0.45),
)
@settings(max_examples=120)
def test_implausible_landmark_jump_is_rejected(pts, jump):
    # Req 26.3: two individually-valid frames where a single landmark (the nose,
    # which participates in no bone) leaps more than MAX_LANDMARK_JUMP (0.25)
    # form an implausible transition that is rejected.
    pts = list(pts)
    frame0 = _frame(pts, 0.0)
    moved = list(pts)
    nx, ny = moved[NOSE]
    moved[NOSE] = (nx, ny + jump)  # vertical leap exceeding the configured max
    frame1 = _frame(moved, 40.0)
    result = _run(LandmarkValidationService(), _landmarks([frame0, frame1]))

    assert result.success is False
    assert IMPLAUSIBLE_LANDMARK_JUMP in _reported_codes(result)
    assert result.error.stage == "landmark_validation"
