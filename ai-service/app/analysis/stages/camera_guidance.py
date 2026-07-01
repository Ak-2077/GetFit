"""
Camera_Guidance_Service — Pipeline Stage (FrameSet → CameraGuidance)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Analyzes recording quality **before pose extraction** and returns actionable
guidance describing any detected recording problems, so an End_User can re-record
a usable video (Req 22.x).

Responsibilities (single-responsibility, behind the PipelineStage interface):
  • Run before the Pose_Extraction_Service (Req 22.1) — operates additively as an
    independent stage without changing any other stage's interface (Req 22.6).
  • Detect each recording condition from the recorded frames (Req 22.2):
        body cut off · body too small · body too close · incorrect camera angle
        · poor lighting · excessive camera shake · landscape-vs-portrait
        orientation · multiple people present.
  • Attach a non-empty, actionable recommendation to every detected issue and
    mark the recording unsuitable (Req 22.3).
  • When no issues are detected, return a result marked suitable with an empty
    issue list (Req 22.4).
  • Read every detection threshold from configuration (Req 22.4 / 22.5).

Design notes
------------
Like the Frame_Quality_Service, all detection math operates on an abstract
`CameraSignalSource` that yields raw, physically-meaningful `CameraSignals` per
frame. This decouples the guidance logic (the part worth testing) from real
image/pose decoding, so the stage is fully testable without pixel data
(Req 22.5 — executed and tested in isolation). A real CV/pose-backed source can
be plugged in later without touching this stage.

Per-frame signals are aggregated into a single representative reading (mean for
continuous signals, max for person count) and then each condition is evaluated
once against its configured threshold. Orientation is read directly from the
validated `VideoMeta` carried on the `FrameSet`, so it is checked even when no
frames are present.

Following the pipeline contract in `base.py`, this stage NEVER raises on a
domain failure — it returns a successful `StageResult` carrying the structured
`CameraGuidance` (unsuitable recordings are a normal, expected domain outcome
that downstream code inspects, not an error).
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel, Field

from app.core.config import settings

from ..base import PipelineStage, StageResult
from ..contracts import CameraGuidance, CameraIssue, Frame, FrameSet

# ── Stable issue identifiers (Req 22.2) ───────────────────────────────────
ISSUE_BODY_CUT_OFF = "body_cut_off"
ISSUE_BODY_TOO_SMALL = "body_too_small"
ISSUE_BODY_TOO_CLOSE = "body_too_close"
ISSUE_INCORRECT_ANGLE = "incorrect_angle"
ISSUE_POOR_LIGHTING = "poor_lighting"
ISSUE_EXCESSIVE_SHAKE = "excessive_shake"
ISSUE_INCORRECT_ORIENTATION = "incorrect_orientation"
ISSUE_MULTIPLE_PEOPLE = "multiple_people"


class CameraSignals(BaseModel):
    """
    Raw, physically-meaningful per-frame recording-setup measurements.

    These are the inputs to the camera-guidance detection. Keeping them separate
    from the `CameraGuidance` output lets the detection be tested without real
    images: a test (or a mocked source) supplies `CameraSignals` directly.
    """
    body_coverage: float = Field(..., ge=0.0, le=1.0)       # fraction of the body kept inside the frame (1.0 = fully in)
    body_area_fraction: float = Field(..., ge=0.0, le=1.0)  # fraction of frame area the body occupies
    view_angle_deg: float = Field(..., ge=0.0)              # deviation from a frontal recording angle, in degrees
    brightness: float = Field(..., ge=0.0, le=1.0)          # mean scene luminance, normalized 0..1
    shake: float = Field(..., ge=0.0, le=1.0)               # normalized camera shake (higher = shakier)
    person_count: int = Field(..., ge=0)                    # number of people detected in the frame


class CameraSignalSource(ABC):
    """
    Abstract accessor that yields raw `CameraSignals` for a given `Frame`.

    Real implementations derive these signals from pixel/pose data (e.g. a body
    bounding box, brightness histogram, inter-frame shift, person detector);
    test/in-memory implementations return precomputed signals. This is the only
    seam through which the stage touches pixel data, so the guidance math stays
    fully unit-testable.
    """

    @abstractmethod
    def signals(self, frame: Frame) -> CameraSignals:
        """Return the raw recording-setup signals for a single frame."""
        raise NotImplementedError


class StaticCameraSignalSource(CameraSignalSource):
    """
    In-memory `CameraSignalSource` backed by a `{frame_index: CameraSignals}` map.

    Useful for tests and for wiring when an upstream stage has already computed
    per-frame signals. Frames absent from the map fall back to `default`, which
    keeps the stage robust when only a subset of frames carries signals.
    """

    def __init__(
        self,
        signals_by_index: dict[int, CameraSignals],
        *,
        default: CameraSignals | None = None,
    ) -> None:
        self._by_index = dict(signals_by_index)
        self._default = default

    def signals(self, frame: Frame) -> CameraSignals:
        signals = self._by_index.get(frame.index, self._default)
        if signals is None:
            raise KeyError(frame.index)
        return signals


# Actionable recommendation for each detected condition (Req 22.3). Kept beside
# the detection logic so every issue is guaranteed a non-empty correction.
def _orientation_recommendation(expected: str) -> str:
    return f"Rotate your device to {expected} orientation and record again."


_RECOMMENDATIONS: dict[str, str] = {
    ISSUE_BODY_CUT_OFF: "Reposition the camera so your entire body stays within the frame.",
    ISSUE_BODY_TOO_SMALL: "Move closer to the camera so your body fills more of the frame.",
    ISSUE_BODY_TOO_CLOSE: "Step back from the camera so your full body is visible.",
    ISSUE_INCORRECT_ANGLE: "Face the camera straight on and keep it level with your body.",
    ISSUE_POOR_LIGHTING: "Record in a brighter, evenly lit space so your body is clearly visible.",
    ISSUE_EXCESSIVE_SHAKE: "Stabilize the camera on a tripod or steady surface before recording.",
    ISSUE_MULTIPLE_PEOPLE: "Make sure only the person being analyzed is in the frame.",
}


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def aggregate_signals(per_frame: list[CameraSignals]) -> CameraSignals | None:
    """
    Reduce per-frame signals to a single representative reading.

    Continuous signals use the mean across frames (robust to single-frame
    noise); person count uses the max so a brief appearance of an extra person
    still surfaces. Returns None when there are no frames to aggregate.
    """
    if not per_frame:
        return None
    return CameraSignals(
        body_coverage=_mean([s.body_coverage for s in per_frame]),
        body_area_fraction=_mean([s.body_area_fraction for s in per_frame]),
        view_angle_deg=_mean([s.view_angle_deg for s in per_frame]),
        brightness=_mean([s.brightness for s in per_frame]),
        shake=_mean([s.shake for s in per_frame]),
        person_count=max(s.person_count for s in per_frame),
    )


class CameraGuidanceService(PipelineStage[FrameSet, CameraGuidance]):
    """
    Camera_Guidance_Service: detects recording-setup problems before pose
    extraction and returns actionable `CameraGuidance` (Req 22.1–22.6).
    """

    name = "camera_guidance"

    def __init__(
        self,
        signal_source: CameraSignalSource,
        *,
        min_body_coverage: float | None = None,
        min_body_area: float | None = None,
        max_body_area: float | None = None,
        max_view_angle_deg: float | None = None,
        min_brightness: float | None = None,
        max_shake: float | None = None,
        expected_orientation: str | None = None,
        max_people: int | None = None,
    ) -> None:
        """
        Args:
            signal_source: abstract accessor yielding raw `CameraSignals` per frame.

        All detection thresholds default to their `settings` value (Req 22.4) and
        can be overridden for testing.
        """
        self._signals = signal_source
        self._min_body_coverage = (
            min_body_coverage if min_body_coverage is not None else settings.CAMERA_MIN_BODY_COVERAGE
        )
        self._min_body_area = (
            min_body_area if min_body_area is not None else settings.CAMERA_MIN_BODY_AREA
        )
        self._max_body_area = (
            max_body_area if max_body_area is not None else settings.CAMERA_MAX_BODY_AREA
        )
        self._max_view_angle_deg = (
            max_view_angle_deg if max_view_angle_deg is not None else settings.CAMERA_MAX_VIEW_ANGLE_DEG
        )
        self._min_brightness = (
            min_brightness if min_brightness is not None else settings.CAMERA_MIN_BRIGHTNESS
        )
        self._max_shake = max_shake if max_shake is not None else settings.CAMERA_MAX_SHAKE
        self._expected_orientation = (
            expected_orientation
            if expected_orientation is not None
            else settings.CAMERA_EXPECTED_ORIENTATION
        )
        self._max_people = max_people if max_people is not None else settings.CAMERA_MAX_PEOPLE

    async def run(self, data: FrameSet) -> StageResult[CameraGuidance]:
        per_frame = [self._signals.signals(frame) for frame in data.frames]
        aggregate = aggregate_signals(per_frame)

        issues = self._detect_issues(aggregate, data.source_meta.orientation)

        return StageResult[CameraGuidance](
            success=True,
            output=CameraGuidance(suitable=not issues, issues=issues),
        )

    def _detect_issues(
        self, aggregate: CameraSignals | None, orientation: str
    ) -> list[CameraIssue]:
        """
        Evaluate every recording condition once and build an ordered list of
        detected issues, each carrying its actionable recommendation (Req 22.2,
        22.3). Returns an empty list when the recording is clean (Req 22.4).
        """
        detected: list[str] = []

        # Orientation is read from the validated VideoMeta, so it is always
        # checkable — even when no frames carry signals (Req 22.2).
        if orientation != self._expected_orientation:
            detected.append(ISSUE_INCORRECT_ORIENTATION)

        if aggregate is not None:
            # Framing: cut off vs. too small vs. too close (mutually exclusive
            # area conditions can never both fire on the same reading).
            if aggregate.body_coverage < self._min_body_coverage:
                detected.append(ISSUE_BODY_CUT_OFF)
            if aggregate.body_area_fraction < self._min_body_area:
                detected.append(ISSUE_BODY_TOO_SMALL)
            elif aggregate.body_area_fraction > self._max_body_area:
                detected.append(ISSUE_BODY_TOO_CLOSE)

            if aggregate.view_angle_deg > self._max_view_angle_deg:
                detected.append(ISSUE_INCORRECT_ANGLE)
            if aggregate.brightness < self._min_brightness:
                detected.append(ISSUE_POOR_LIGHTING)
            if aggregate.shake > self._max_shake:
                detected.append(ISSUE_EXCESSIVE_SHAKE)
            if aggregate.person_count > self._max_people:
                detected.append(ISSUE_MULTIPLE_PEOPLE)

        return [
            CameraIssue(issue=issue, recommendation=self._recommendation(issue))
            for issue in detected
        ]

    def _recommendation(self, issue: str) -> str:
        """Return the non-empty actionable correction for a detected issue (Req 22.3)."""
        if issue == ISSUE_INCORRECT_ORIENTATION:
            return _orientation_recommendation(self._expected_orientation)
        return _RECOMMENDATIONS[issue]
