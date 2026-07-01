"""
Person Validation Layer — additive false "MULTIPLE_PEOPLE" mitigation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Real gyms are full of *printed* humans (posters, banners, wall graphics),
mirror reflections, TV screens, and background spectators. A naive
``person_count > 1`` gate rejects a perfectly good single-athlete clip because
of them. This module is a pure, deterministic decision layer that runs AFTER
pose detection and BEFORE the multi-person rejection, distinguishing a real
moving athlete from these false positives.

It is strictly ADDITIVE:
  • it does not perform or modify pose estimation,
  • it does not touch exercise recognition or the analytical metrics,
  • it changes no existing API contract,
  • and it only *narrows* rejections — it never rejects a case the old gate
    would have accepted.

Pipeline of stages (mirrors the product spec):
  1. Input   — per-frame, per-person detections (bbox + pose confidence).
  2. Track   — associate detections into per-person tracks across frames
               (greedy nearest-centroid, deterministic).
  3. Motion  — per-track centroid-travel motion score.
  4. Pose    — per-track average pose confidence + visibility.
  5. Select  — pick ONE primary athlete via a weighted composite score.
  6..10 Classify — label every other track (poster / mirror / TV / spectator /
               second athlete) using motion, size, confidence, visibility and
               position; never reject during classification.
  11. Decide — reject ONLY when TWO OR MORE tracks are genuine athletes.
  12. Report — a structured, JSON-friendly result for logging / optional API.

Everything is computed from the detection geometry the pose engine already
produces, so the layer stays deterministic and dependency-free (pure Python +
pydantic). Sub-labels (poster/mirror/TV/spectator) are best-effort and used for
explanation/logging; the *decision* that matters — "is this a second real
athlete?" — is driven by robust motion/size/confidence/visibility gating.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum

from pydantic import BaseModel, Field


class PersonCategory(str, Enum):
    """Classification assigned to each tracked person (Stage 6)."""

    PRIMARY_ATHLETE = "primary_athlete"
    SECOND_ATHLETE = "second_athlete"
    POSTER = "poster"                      # static printed human (poster/banner/wall)
    MIRROR_REFLECTION = "mirror_reflection"
    TV_SCREEN = "tv_screen"
    BACKGROUND_SPECTATOR = "background_spectator"
    UNKNOWN = "unknown"


class PersonDetection(BaseModel):
    """One detected person in one frame (raw, pre-tracking).

    Coordinates are normalized to the frame in [0, 1] so the layer is
    resolution-independent. Produced by the pose engine; carries no pixels.
    """

    frame_index: int
    timestamp_ms: float = 0.0
    cx: float = Field(ge=0.0, le=1.0)  # bbox center x
    cy: float = Field(ge=0.0, le=1.0)  # bbox center y
    width: float = Field(ge=0.0, le=1.0)   # bbox width
    height: float = Field(ge=0.0, le=1.0)  # bbox height
    mean_score: float = Field(ge=0.0, le=1.0)  # mean pose confidence
    visible_keypoints: int = 0

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)


@dataclass
class _Track:
    """A single person tracked across frames (internal, mutable)."""

    track_id: int
    observations: list[PersonDetection] = field(default_factory=list)

    def add(self, det: PersonDetection) -> None:
        self.observations.append(det)

    @property
    def last(self) -> PersonDetection:
        return self.observations[-1]

    @property
    def frames_visible(self) -> int:
        return len(self.observations)

    @property
    def avg_area(self) -> float:
        return _mean([o.area for o in self.observations])

    @property
    def avg_score(self) -> float:
        return _mean([o.mean_score for o in self.observations])

    @property
    def avg_visible_keypoints(self) -> float:
        return _mean([float(o.visible_keypoints) for o in self.observations])

    @property
    def mean_center(self) -> tuple[float, float]:
        return (
            _mean([o.cx for o in self.observations]),
            _mean([o.cy for o in self.observations]),
        )

    def motion_score(self) -> float:
        """Mean per-frame centroid travel (normalized). ~0 for a fixed poster."""
        if self.frames_visible < 2:
            return 0.0
        total = 0.0
        for a, b in zip(self.observations, self.observations[1:]):
            total += math.hypot(b.cx - a.cx, b.cy - a.cy)
        return total / (self.frames_visible - 1)


class TrackSummary(BaseModel):
    """Public, JSON-friendly per-person summary (Stage 12 / logging)."""

    track_id: int
    category: PersonCategory
    reason: str
    frames_visible: int
    visible_fraction: float
    motion_score: float
    avg_pose_confidence: float
    avg_area: float
    centeredness: float
    is_real_athlete: bool


class PersonValidationResult(BaseModel):
    """Outcome of the Person Validation Layer (Stage 11/12).

    ``reject`` is True ONLY when two or more genuine athletes are present.
    ``primary_athlete`` is the single selected athlete (or None when no person
    was detected). ``ignored`` lists every non-primary track with its label and
    reason (for logging / optional API surfacing).
    """

    reject: bool = False
    reject_code: str | None = None
    reason: str = ""
    real_athlete_count: int = 0
    primary_athlete: TrackSummary | None = None
    real_athletes: list[TrackSummary] = Field(default_factory=list)
    ignored: list[TrackSummary] = Field(default_factory=list)
    all_tracks: list[TrackSummary] = Field(default_factory=list)


@dataclass(frozen=True)
class PersonValidationConfig:
    """Immutable thresholds for the layer (mirrors Settings.PV_* fields)."""

    athlete_min_motion: float = 0.006
    athlete_min_pose_confidence: float = 0.45
    athlete_min_area: float = 0.08
    athlete_min_visible_fraction: float = 0.6
    athlete_max_center_dist: float = 0.45
    static_motion_max: float = 0.004
    spectator_max_area: float = 0.15
    mirror_min_anticorr: float = 0.5
    track_match_dist: float = 0.15
    weight_motion: float = 0.40
    weight_pose_confidence: float = 0.25
    weight_area: float = 0.15
    weight_centered: float = 0.10
    weight_visible_duration: float = 0.10

    @classmethod
    def from_settings(cls, settings) -> "PersonValidationConfig":
        w = getattr(settings, "PV_SELECTION_WEIGHTS", {}) or {}
        return cls(
            athlete_min_motion=getattr(settings, "PV_ATHLETE_MIN_MOTION", 0.006),
            athlete_min_pose_confidence=getattr(settings, "PV_ATHLETE_MIN_POSE_CONFIDENCE", 0.45),
            athlete_min_area=getattr(settings, "PV_ATHLETE_MIN_AREA", 0.08),
            athlete_min_visible_fraction=getattr(settings, "PV_ATHLETE_MIN_VISIBLE_FRACTION", 0.6),
            athlete_max_center_dist=getattr(settings, "PV_ATHLETE_MAX_CENTER_DIST", 0.45),
            static_motion_max=getattr(settings, "PV_STATIC_MOTION_MAX", 0.004),
            spectator_max_area=getattr(settings, "PV_SPECTATOR_MAX_AREA", 0.15),
            mirror_min_anticorr=getattr(settings, "PV_MIRROR_MIN_ANTICORR", 0.5),
            track_match_dist=getattr(settings, "PV_TRACK_MATCH_DIST", 0.15),
            weight_motion=float(w.get("motion", 0.40)),
            weight_pose_confidence=float(w.get("pose_confidence", 0.25)),
            weight_area=float(w.get("area", 0.15)),
            weight_centered=float(w.get("centered", 0.10)),
            weight_visible_duration=float(w.get("visible_duration", 0.10)),
        )


#: Stable code returned when two or more genuine athletes are present. Kept
#: distinct from the legacy MULTIPLE_PEOPLE for telemetry, but the caller maps
#: it to the existing MULTIPLE_PEOPLE user-facing behavior for API stability.
MULTIPLE_REAL_ATHLETES = "MULTIPLE_REAL_ATHLETES"


# ── Helpers ──────────────────────────────────────────────────────────────

def _mean(values: list[float]) -> float:
    return (sum(values) / len(values)) if values else 0.0


def _center_dist(center: tuple[float, float]) -> float:
    """Euclidean distance of a center from the frame center (0.5, 0.5)."""
    return math.hypot(center[0] - 0.5, center[1] - 0.5)


def _centeredness(center: tuple[float, float]) -> float:
    """1.0 at the frame center, decaying to 0.0 at the corner."""
    # Max possible distance from center is ~0.7071 (corner).
    return max(0.0, 1.0 - _center_dist(center) / 0.7071)


def _pearson(xs: list[float], ys: list[float]) -> float:
    """Pearson correlation of two equal-length series (0.0 when undefined)."""
    n = len(xs)
    if n < 2 or len(ys) != n:
        return 0.0
    mx, my = _mean(xs), _mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0.0 or dy == 0.0:
        return 0.0
    return num / (dx * dy)


# ── Stage 2: tracking ──────────────────────────────────────────────────────

def _build_tracks(
    detections: list[PersonDetection], match_dist: float
) -> list[_Track]:
    """Associate per-frame detections into per-person tracks (deterministic).

    Greedy nearest-centroid matching, frame by frame: within a frame, each
    detection (processed in a stable order) extends the closest still-unmatched
    active track whose last centroid is within ``match_dist``; otherwise it
    starts a new track. Deterministic given the same input ordering.
    """
    # Group detections by frame, preserving ascending frame order.
    frames: dict[int, list[PersonDetection]] = {}
    for det in detections:
        frames.setdefault(det.frame_index, []).append(det)

    tracks: list[_Track] = []
    next_id = 0

    for frame_index in sorted(frames):
        # Stable ordering of detections within the frame.
        dets = sorted(frames[frame_index], key=lambda d: (d.cx, d.cy, -d.area))
        # Candidate tracks: those seen so far (match against their last obs).
        matched_tracks: set[int] = set()

        for det in dets:
            best_track: _Track | None = None
            best_dist = match_dist
            for track in tracks:
                if track.track_id in matched_tracks:
                    continue
                last = track.last
                dist = math.hypot(det.cx - last.cx, det.cy - last.cy)
                if dist <= best_dist:
                    best_dist = dist
                    best_track = track
            if best_track is not None:
                best_track.add(det)
                matched_tracks.add(best_track.track_id)
            else:
                track = _Track(track_id=next_id)
                next_id += 1
                track.add(det)
                tracks.append(track)
                matched_tracks.add(track.track_id)

    return tracks


# ── Stage 5: composite scoring / primary selection ─────────────────────────

def _composite_score(
    track: _Track, total_frames: int, cfg: PersonValidationConfig
) -> float:
    """Weighted composite used to select the primary athlete (Stage 5)."""
    visible_fraction = (
        track.frames_visible / total_frames if total_frames > 0 else 0.0
    )
    # Normalize motion into ~[0,1] against a reasonable upper bound.
    motion_norm = min(1.0, track.motion_score() / 0.05)
    area_norm = min(1.0, track.avg_area / 0.5)
    centered = _centeredness(track.mean_center)
    return (
        cfg.weight_motion * motion_norm
        + cfg.weight_pose_confidence * track.avg_score
        + cfg.weight_area * area_norm
        + cfg.weight_centered * centered
        + cfg.weight_visible_duration * min(1.0, visible_fraction)
    )


def _is_real_athlete(
    track: _Track, total_frames: int, cfg: PersonValidationConfig
) -> bool:
    """Stage 11 gate: ALL criteria must hold for a genuine exercising athlete."""
    visible_fraction = (
        track.frames_visible / total_frames if total_frames > 0 else 0.0
    )
    return (
        track.motion_score() >= cfg.athlete_min_motion
        and track.avg_score >= cfg.athlete_min_pose_confidence
        and track.avg_area >= cfg.athlete_min_area
        and visible_fraction >= cfg.athlete_min_visible_fraction
        and _center_dist(track.mean_center) <= cfg.athlete_max_center_dist
    )


# ── Stage 6..10: classification ─────────────────────────────────────────────

def _classify(
    track: _Track,
    primary: _Track,
    total_frames: int,
    cfg: PersonValidationConfig,
) -> tuple[PersonCategory, str]:
    """Best-effort label + human reason for a non-primary track."""
    motion = track.motion_score()
    area = track.avg_area
    score = track.avg_score
    visible_fraction = (
        track.frames_visible / total_frames if total_frames > 0 else 0.0
    )

    # Stage 8: mirror — a true reflection moves OPPOSITE the athlete horizontally
    # while tracking them vertically, with a comparable size. Checked BEFORE the
    # athlete gate so an athletic-looking reflection never becomes a 2nd athlete.
    cx_anti, cy_corr = _mirror_signals(track, primary)
    area_comparable = 0.5 * primary.avg_area <= area <= 2.0 * primary.avg_area
    if cx_anti >= cfg.mirror_min_anticorr and cy_corr >= 0.5 and area_comparable:
        return (
            PersonCategory.MIRROR_REFLECTION,
            f"mirror reflection (h-anti-corr={cx_anti:.2f}, v-corr={cy_corr:.2f})",
        )

    # Stage 11: a genuine second athlete (drives the decision).
    if _is_real_athlete(track, total_frames, cfg):
        return (
            PersonCategory.SECOND_ATHLETE,
            f"second athlete (motion={motion:.3f}, pose={score:.2f}, "
            f"area={area:.2f}, visible={visible_fraction:.0%})",
        )

    # Stage 7: poster / static printed human — essentially no movement.
    if motion <= cfg.static_motion_max:
        return (
            PersonCategory.POSTER,
            f"static printed person (motion={motion:.3f}, pose={score:.2f})",
        )

    # Stage 10: background spectator — small and off to the side.
    if area < cfg.spectator_max_area and _center_dist(track.mean_center) > cfg.athlete_max_center_dist:
        return (
            PersonCategory.BACKGROUND_SPECTATOR,
            f"background spectator (area={area:.2f}, off-center)",
        )

    # Stage 9: TV / screen — small, has some motion, but not a real athlete.
    if area < cfg.spectator_max_area:
        return (
            PersonCategory.TV_SCREEN,
            f"screen/TV person (area={area:.2f}, not exercising)",
        )

    # Anything else that failed the athlete bar is ignored as unknown.
    return (
        PersonCategory.UNKNOWN,
        f"ignored (motion={motion:.3f}, pose={score:.2f}, area={area:.2f}, "
        f"visible={visible_fraction:.0%})",
    )


def _mirror_signals(track: _Track, primary: _Track) -> tuple[float, float]:
    """Reflection signals vs the primary over co-observed frames.

    Returns ``(cx_anticorr, cy_corr)``:
      • ``cx_anticorr`` — magnitude of NEGATIVE horizontal-position correlation
        (a mirror moves left when the athlete moves right); 0.0 if not negative.
      • ``cy_corr`` — POSITIVE vertical-position correlation (a mirror tracks the
        athlete vertically); 0.0 if not positive.
    No frame overlap → (0.0, 0.0).
    """
    px = {o.frame_index: o.cx for o in primary.observations}
    py = {o.frame_index: o.cy for o in primary.observations}
    xs_t: list[float] = []
    xs_p: list[float] = []
    ys_t: list[float] = []
    ys_p: list[float] = []
    for o in track.observations:
        if o.frame_index in px:
            xs_t.append(o.cx)
            xs_p.append(px[o.frame_index])
            ys_t.append(o.cy)
            ys_p.append(py[o.frame_index])
    cx_corr = _pearson(xs_t, xs_p)
    cy_corr = _pearson(ys_t, ys_p)
    return (-cx_corr if cx_corr < 0 else 0.0, cy_corr if cy_corr > 0 else 0.0)


def _summarize(
    track: _Track,
    category: PersonCategory,
    reason: str,
    total_frames: int,
    is_real: bool,
) -> TrackSummary:
    visible_fraction = (
        track.frames_visible / total_frames if total_frames > 0 else 0.0
    )
    return TrackSummary(
        track_id=track.track_id,
        category=category,
        reason=reason,
        frames_visible=track.frames_visible,
        visible_fraction=round(visible_fraction, 4),
        motion_score=round(track.motion_score(), 5),
        avg_pose_confidence=round(track.avg_score, 4),
        avg_area=round(track.avg_area, 4),
        centeredness=round(_centeredness(track.mean_center), 4),
        is_real_athlete=is_real,
    )


# ── Public entry point ──────────────────────────────────────────────────────

def validate_persons(
    detections: list[PersonDetection],
    *,
    total_frames: int,
    config: PersonValidationConfig | None = None,
) -> PersonValidationResult:
    """Run the full Person Validation Layer over per-frame detections.

    Returns a :class:`PersonValidationResult`. The result rejects ONLY when two
    or more tracks are genuine athletes (Stage 11); posters, mirrors, TVs and
    background spectators never cause a rejection.
    """
    cfg = config or PersonValidationConfig()

    if not detections:
        return PersonValidationResult(
            reject=False, reason="no persons detected", real_athlete_count=0
        )

    total = max(1, total_frames)
    tracks = _build_tracks(detections, cfg.track_match_dist)
    if not tracks:
        return PersonValidationResult(reject=False, reason="no tracks", real_athlete_count=0)

    # Stage 5: select the primary athlete (highest composite score). Ties are
    # broken deterministically by track_id.
    primary = max(
        tracks,
        key=lambda t: (_composite_score(t, total, cfg), -t.track_id),
    )

    # Stage 6..11: classify every track; count genuine athletes.
    all_summaries: list[TrackSummary] = []
    ignored: list[TrackSummary] = []
    real_athletes: list[TrackSummary] = []

    for track in tracks:
        if track.track_id == primary.track_id:
            is_real = _is_real_athlete(track, total, cfg) or len(tracks) == 1
            summary = _summarize(
                track, PersonCategory.PRIMARY_ATHLETE,
                "primary athlete", total, is_real=True,
            )
            all_summaries.append(summary)
            real_athletes.append(summary)
            continue

        category, reason = _classify(track, primary, total, cfg)
        is_real = category == PersonCategory.SECOND_ATHLETE
        summary = _summarize(track, category, reason, total, is_real=is_real)
        all_summaries.append(summary)
        if is_real:
            real_athletes.append(summary)
        else:
            ignored.append(summary)

    primary_summary = next(
        (s for s in all_summaries if s.track_id == primary.track_id), None
    )

    # Stage 11: reject ONLY when two or more genuine athletes are present.
    real_count = len(real_athletes)
    reject = real_count >= 2
    if reject:
        reason = (
            f"{real_count} real athletes detected and exercising in frame; "
            "analysis requires exactly one athlete."
        )
        reject_code = MULTIPLE_REAL_ATHLETES
    else:
        reason = "one athlete detected; background people ignored"
        reject_code = None

    return PersonValidationResult(
        reject=reject,
        reject_code=reject_code,
        reason=reason,
        real_athlete_count=real_count,
        primary_athlete=primary_summary,
        real_athletes=real_athletes,
        ignored=ignored,
        all_tracks=all_summaries,
    )
