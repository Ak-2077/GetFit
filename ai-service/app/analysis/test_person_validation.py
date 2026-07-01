"""
Tests for the additive Person Validation Layer (person_validation.py) and its
integration into the Pose_Extraction_Service.

Covers the real-gym scenarios that used to trip the naive person_count gate:
  ✓ one athlete + poster            → 1 athlete, poster ignored, NOT rejected
  ✓ one athlete + mirror            → 1 athlete, reflection ignored, NOT rejected
  ✓ one athlete + TV                → 1 athlete, screen ignored, NOT rejected
  ✓ one athlete + spectators        → 1 athlete, spectator ignored, NOT rejected
  ✓ two athletes exercising         → REJECTED (multiple real athletes)
  ✓ three posters                   → NOT rejected (no real athletes)
  ✓ empty gym                       → NOT rejected
  ✓ gym banner with printed people  → NOT rejected
  ✓ reflection only                 → NOT rejected (single subject)
  ✓ background advertisement        → NOT rejected

Plus: the Pose_Extraction_Service uses the layer when detections are present
(a poster-inflated person_count no longer rejects; two athletes still do), and
the legacy person_count gate is preserved when no detections are supplied.
"""

import asyncio

from app.analysis.contracts import (
    Frame,
    FrameLandmarks,
    KeyFrames,
    Landmark,
    Landmarks,
    VideoMeta,
)
from app.analysis.person_validation import (
    PersonCategory,
    PersonDetection,
    PersonValidationConfig,
    validate_persons,
)
from app.analysis.adapters.pose_engines import PoseEngine, PoseEngineResult
from app.analysis.stages.pose_extraction import MULTIPLE_PEOPLE, PoseExtractionService

CFG = PersonValidationConfig()
N = 20  # frames per synthetic clip


# ── Synthetic detection builders ────────────────────────────────────────────

def _series(cx_fn, cy_fn, *, w, h, score, kp=15, n=N):
    return [
        PersonDetection(
            frame_index=k,
            timestamp_ms=float(k * 100),
            cx=cx_fn(k),
            cy=cy_fn(k),
            width=w,
            height=h,
            mean_score=score,
            visible_keypoints=kp,
        )
        for k in range(n)
    ]


def athlete(cx=0.5, *, w=0.35, h=0.55, score=0.85):
    """A large, confident, centered person moving vertically (e.g. squats)."""
    return _series(
        cx_fn=lambda k: cx,
        cy_fn=lambda k: 0.5 + (0.05 if k % 2 == 0 else -0.05),
        w=w, h=h, score=score,
    )


def poster(cx, cy, *, w=0.12, h=0.30, score=0.55):
    """A fixed, motionless printed person (poster/banner/wall graphic)."""
    return _series(cx_fn=lambda k: cx, cy_fn=lambda k: cy, w=w, h=h, score=score)


def small_mover(cx, cy, *, w=0.08, h=0.11, score=0.5, amp=0.01):
    """A small, off-center person with slight motion (TV / spectator)."""
    return _series(
        cx_fn=lambda k: cx,
        cy_fn=lambda k: cy + (amp if k % 2 == 0 else -amp),
        w=w, h=h, score=score,
    )


def horizontal_athlete(base=0.4, *, w=0.32, h=0.55, score=0.85):
    """A confident person moving horizontally (for mirror geometry)."""
    return _series(
        cx_fn=lambda k: base + (0.03 if k % 2 == 0 else -0.03),
        cy_fn=lambda k: 0.5 + (0.03 if k % 2 == 0 else -0.03),
        w=w, h=h, score=score,
    )


def mirror_of(primary_cx_base=0.4, *, w=0.32, h=0.55, score=0.8):
    """A reflection: horizontally opposite, vertically in-sync with the athlete."""
    return _series(
        cx_fn=lambda k: (1.0 - (primary_cx_base + (0.03 if k % 2 == 0 else -0.03))),
        cy_fn=lambda k: 0.5 + (0.03 if k % 2 == 0 else -0.03),
        w=w, h=h, score=score,
    )


def _cat_of(result, track_id):
    return next(s.category for s in result.all_tracks if s.track_id == track_id)


# ── Scenario tests ──────────────────────────────────────────────────────────

def test_one_athlete_plus_poster_not_rejected():
    dets = athlete(cx=0.5) + poster(0.85, 0.3)
    r = validate_persons(dets, total_frames=N, config=CFG)
    assert r.reject is False
    assert r.real_athlete_count == 1
    assert any(s.category == PersonCategory.POSTER for s in r.ignored)


def test_one_athlete_plus_mirror_not_rejected():
    dets = horizontal_athlete(0.4) + mirror_of(0.4)
    r = validate_persons(dets, total_frames=N, config=CFG)
    assert r.reject is False
    assert r.real_athlete_count == 1
    assert any(s.category == PersonCategory.MIRROR_REFLECTION for s in r.ignored)


def test_one_athlete_plus_tv_not_rejected():
    # Small screen person in the corner with a little motion.
    dets = athlete(cx=0.5) + small_mover(0.12, 0.18, amp=0.015)
    r = validate_persons(dets, total_frames=N, config=CFG)
    assert r.reject is False
    assert r.real_athlete_count == 1
    # The TV/screen person is ignored (not a real athlete).
    assert len(r.ignored) == 1
    assert r.ignored[0].is_real_athlete is False


def test_one_athlete_plus_spectator_not_rejected():
    dets = athlete(cx=0.5) + small_mover(0.9, 0.85, amp=0.008)
    r = validate_persons(dets, total_frames=N, config=CFG)
    assert r.reject is False
    assert r.real_athlete_count == 1
    assert len(r.ignored) == 1
    assert r.ignored[0].is_real_athlete is False


def test_two_athletes_exercising_rejected():
    dets = athlete(cx=0.32) + athlete(cx=0.72)
    r = validate_persons(dets, total_frames=N, config=CFG)
    assert r.reject is True
    assert r.reject_code == "MULTIPLE_REAL_ATHLETES"
    assert r.real_athlete_count == 2


def test_three_posters_not_rejected():
    dets = poster(0.2, 0.3) + poster(0.5, 0.3) + poster(0.8, 0.3)
    r = validate_persons(dets, total_frames=N, config=CFG)
    assert r.reject is False
    # No genuine movers → at most the (forced) primary counts; never ≥2.
    assert r.real_athlete_count <= 1


def test_empty_gym_not_rejected():
    r = validate_persons([], total_frames=N, config=CFG)
    assert r.reject is False
    assert r.real_athlete_count == 0
    assert r.primary_athlete is None


def test_gym_banner_with_printed_people_not_rejected():
    dets = athlete(cx=0.5) + poster(0.15, 0.25) + poster(0.85, 0.25) + poster(0.85, 0.6)
    r = validate_persons(dets, total_frames=N, config=CFG)
    assert r.reject is False
    assert r.real_athlete_count == 1
    assert sum(1 for s in r.ignored if s.category == PersonCategory.POSTER) == 3


def test_reflection_only_not_rejected():
    # Only one person-like track present → never rejected (single subject).
    dets = mirror_of(0.4)
    r = validate_persons(dets, total_frames=N, config=CFG)
    assert r.reject is False
    assert r.real_athlete_count == 1


def test_background_advertisement_not_rejected():
    dets = athlete(cx=0.5) + poster(0.9, 0.15, w=0.1, h=0.18, score=0.6)
    r = validate_persons(dets, total_frames=N, config=CFG)
    assert r.reject is False
    assert r.real_athlete_count == 1


def test_primary_is_the_moving_athlete_not_the_poster():
    dets = poster(0.2, 0.3) + athlete(cx=0.6)
    r = validate_persons(dets, total_frames=N, config=CFG)
    assert r.primary_athlete is not None
    assert r.primary_athlete.category == PersonCategory.PRIMARY_ATHLETE
    # The primary must be the moving, confident, large person (not the poster).
    assert r.primary_athlete.motion_score > CFG.static_motion_max
    assert r.primary_athlete.avg_pose_confidence >= CFG.athlete_min_pose_confidence


# ── Pose_Extraction_Service integration ─────────────────────────────────────

class _StubEngine(PoseEngine):
    """Engine that reports an inflated person_count but supplies detections."""

    name = "stub_pv"
    version = "1.0.0"

    def __init__(self, detections):
        self._detections = detections

    async def is_available(self) -> bool:
        return True

    async def extract(self, frames):
        return PoseEngineResult(
            frames=[
                FrameLandmarks(
                    timestamp_ms=0.0,
                    landmarks=[Landmark(x=0.5, y=0.5, z=0.0, confidence=0.9)],
                    overall_confidence=0.9,
                )
            ],
            person_count=99,  # would trip the legacy gate — proves the layer overrides it
            available=True,
            detections=self._detections,
        )


def _key_frames(n=N):
    meta = VideoMeta(
        container_format="mp4", codec="h264", duration_sec=5.0,
        width=1080, height=1920, fps=30.0, size_bytes=1024, orientation="portrait",
    )
    return KeyFrames(frames=[Frame(index=k, timestamp_ms=float(k * 100)) for k in range(n)], source_meta=meta)


def _run_stage(detections):
    engine = _StubEngine(detections)
    stage = PoseExtractionService(registry={engine.name: engine}, active_engine=engine.name)
    return asyncio.run(stage.run(_key_frames()))


def test_stage_ignores_poster_despite_inflated_person_count():
    # One athlete + poster, but the engine claims person_count=99. The Person
    # Validation Layer must let it through (success), NOT MULTIPLE_PEOPLE.
    res = _run_stage(athlete(cx=0.5) + poster(0.85, 0.3))
    assert res.success is True
    assert res.output is not None


def test_stage_rejects_two_real_athletes():
    res = _run_stage(athlete(cx=0.32) + athlete(cx=0.72))
    assert res.success is False
    assert res.error is not None
    assert res.error.code == MULTIPLE_PEOPLE  # API-stable code


def test_stage_legacy_person_count_gate_preserved_without_detections():
    # No detections supplied → the legacy person_count>1 guard still rejects.
    class _LegacyEngine(PoseEngine):
        name = "legacy"
        version = "1.0.0"

        async def is_available(self):
            return True

        async def extract(self, frames):
            return PoseEngineResult(frames=[], person_count=3, available=True)

    stage = PoseExtractionService(registry={"legacy": _LegacyEngine()}, active_engine="legacy")
    res = asyncio.run(stage.run(_key_frames()))
    assert res.success is False
    assert res.error.code == MULTIPLE_PEOPLE
