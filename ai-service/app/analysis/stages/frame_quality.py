"""
Frame_Quality_Service — Pipeline Stage 3 (FrameSet → QualityScoredFrames)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Computes seven per-frame visual-quality scores, discards frames that fall
below the configured thresholds, and surfaces the dominant recording failure
as a Structured_Error.

Responsibilities (single-responsibility, behind the PipelineStage interface):
  • Compute blur, brightness, contrast, motion-blur, camera-shake,
    body-visibility, and occlusion scores for every frame (Req 4.1, 4.2).
  • Discard frames whose scores fall below the configured thresholds so they
    never reach the Key_Frame_Selector (Req 4.3).
  • Return the retained frames together with their computed scores (Req 4.4).
  • Process each extracted frame through quality analysis at most once
    (Req 16.3).
  • Emit `BODY_NOT_VISIBLE` when every frame is discarded and the dominant
    cause is absent body visibility (Req 4.5).
  • Emit `CAMERA_TOO_DARK` when retained-frame brightness is below the
    configured minimum (Req 15.3).
  • Emit `CAMERA_SHAKING` when retained-frame camera shake exceeds the
    configured maximum (Req 15.4).

Design notes
------------
All scoring math operates on an abstract `FramePixelSource` that yields raw,
physically-meaningful `FrameSignals` per frame. This decouples the quality
math (the part worth testing) from real image decoding, so the stage is fully
testable without pixel data (Req 14.4 — stages testable in isolation). A real
OpenCV-backed source can be plugged in later without touching this stage.

All quality scores are normalized to the closed interval [0.0, 1.0] where
**higher always means better quality**. A frame is retained iff every score is
greater than or equal to its configured threshold, which makes the retention
decision uniform across all seven metrics.

Following the pipeline contract in `base.py`, this stage NEVER raises on a
domain failure — it returns `StageResult(success=False, error=...)`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections import Counter

from pydantic import BaseModel, Field

from app.core.config import settings

from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import (
    Frame,
    FrameQuality,
    FrameSet,
    QualityScoredFrame,
    QualityScoredFrames,
)

# ── Normalization reference constants ─────────────────────────────────────
# Raw signals are physical measurements; these references map them onto the
# normalized [0,1] quality scale. They are intentionally NOT thresholds (which
# live in config) — they only set the sensitivity of each score.
_SHARPNESS_REF = 150.0   # Laplacian variance at/above which blur score saturates to 1.0
_CONTRAST_REF = 64.0     # luminance std-dev (0..255) mapped to full contrast
_MOTION_REF = 25.0       # inter-frame local motion magnitude mapped to full motion blur
_SHAKE_REF = 20.0        # inter-frame global shift mapped to full camera shake

#: Metrics that participate in the per-frame retention decision (Req 4.3).
QUALITY_METRICS: tuple[str, ...] = (
    "blur",
    "brightness",
    "contrast",
    "motion_blur",
    "camera_shake",
    "body_visibility",
    "occlusion",
)


def _clamp01(value: float) -> float:
    """Clamp a value into the closed interval [0.0, 1.0]."""
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


class FrameSignals(BaseModel):
    """
    Raw, physically-meaningful per-frame measurements extracted from pixel data.

    These are the inputs to the quality-scoring math. Keeping them separate from
    the normalized `FrameQuality` scores lets the scoring be tested without real
    images: a test (or a mocked source) supplies `FrameSignals` directly.
    """
    sharpness: float = Field(..., ge=0.0)        # Laplacian variance (higher = sharper)
    mean_luminance: float = Field(..., ge=0.0)   # mean luma on a 0..255 scale
    luminance_std: float = Field(..., ge=0.0)    # luma std-dev on a 0..255 scale (contrast)
    motion_magnitude: float = Field(..., ge=0.0)  # local inter-frame motion (higher = more blur)
    global_shift: float = Field(..., ge=0.0)     # global inter-frame translation (camera shake)
    visible_keypoints: float = Field(..., ge=0.0, le=1.0)  # fraction of body keypoints visible
    occluded_fraction: float = Field(..., ge=0.0, le=1.0)  # fraction of body region occluded


class FramePixelSource(ABC):
    """
    Abstract accessor that yields raw `FrameSignals` for a given `Frame`.

    Real implementations decode pixel data (e.g. via OpenCV) from the frame's
    transient handle; test/in-memory implementations return precomputed signals.
    This is the only seam through which the stage touches pixel data, so the
    quality math stays fully unit-testable.
    """

    @abstractmethod
    def signals(self, frame: Frame) -> FrameSignals:
        """Return the raw visual-quality signals for a single frame."""
        raise NotImplementedError


class StaticFramePixelSource(FramePixelSource):
    """
    In-memory `FramePixelSource` backed by a `{frame_index: FrameSignals}` map.

    Useful for tests and for wiring when an upstream stage has already computed
    per-frame signals. Frames absent from the map raise a `KeyError`, which the
    stage treats as a fatal domain failure rather than silently scoring zero.
    """

    def __init__(self, signals_by_index: dict[int, FrameSignals]):
        self._by_index = dict(signals_by_index)

    def signals(self, frame: Frame) -> FrameSignals:
        return self._by_index[frame.index]


def score_frame(signals: FrameSignals) -> FrameQuality:
    """
    Pure scoring math: map raw `FrameSignals` onto the seven normalized quality
    scores (Req 4.1, 4.2). Every score lands in [0.0, 1.0] with higher = better.
    """
    return FrameQuality(
        blur=_clamp01(signals.sharpness / _SHARPNESS_REF),
        brightness=_clamp01(signals.mean_luminance / 255.0),
        contrast=_clamp01(signals.luminance_std / _CONTRAST_REF),
        # motion blur / camera shake are "bad when high", so invert into a
        # quality score where higher = steadier / less blur.
        motion_blur=_clamp01(1.0 - signals.motion_magnitude / _MOTION_REF),
        camera_shake=_clamp01(1.0 - signals.global_shift / _SHAKE_REF),
        body_visibility=_clamp01(signals.visible_keypoints),
        occlusion=_clamp01(1.0 - signals.occluded_fraction),
    )


def failing_metrics(quality: FrameQuality, thresholds: dict[str, float]) -> list[str]:
    """Return the metrics whose score falls below its configured threshold."""
    failed: list[str] = []
    for metric in QUALITY_METRICS:
        threshold = thresholds.get(metric)
        if threshold is None:
            continue
        if getattr(quality, metric) < threshold:
            failed.append(metric)
    return failed


class FrameQualityService(PipelineStage[FrameSet, QualityScoredFrames]):
    """
    Frame_Quality_Service: scores every frame once, discards sub-threshold
    frames, and reports the dominant recording failure as a Structured_Error.
    """

    name = "frame_quality"

    def __init__(
        self,
        pixel_source: FramePixelSource,
        *,
        quality_thresholds: dict[str, float] | None = None,
        min_brightness: float | None = None,
        max_camera_shake: float | None = None,
    ) -> None:
        """
        Args:
            pixel_source: abstract accessor yielding raw `FrameSignals` per frame.
            quality_thresholds: per-metric minimum acceptable score; defaults to
                `settings.QUALITY_THRESHOLDS` (Req 4.3 — config-driven).
            min_brightness: minimum mean brightness across retained frames before
                `CAMERA_TOO_DARK` is emitted; defaults to `settings.MIN_BRIGHTNESS`.
            max_camera_shake: maximum mean shake across retained frames before
                `CAMERA_SHAKING` is emitted; defaults to `settings.MAX_CAMERA_SHAKE`.
        """
        self._pixels = pixel_source
        self._thresholds = dict(
            quality_thresholds if quality_thresholds is not None else settings.QUALITY_THRESHOLDS
        )
        self._min_brightness = (
            min_brightness if min_brightness is not None else settings.MIN_BRIGHTNESS
        )
        self._max_camera_shake = (
            max_camera_shake if max_camera_shake is not None else settings.MAX_CAMERA_SHAKE
        )

    async def run(self, data: FrameSet) -> StageResult[QualityScoredFrames]:
        # ── Score every frame exactly once (Req 4.1, 4.2, 16.3) ──
        scored: list[QualityScoredFrame] = []
        # Tracks which metric caused each discard, to find the dominant cause.
        discard_causes: Counter[str] = Counter()
        try:
            for frame in data.frames:
                quality = score_frame(self._pixels.signals(frame))
                failed = failing_metrics(quality, self._thresholds)
                retained = not failed
                if failed:
                    discard_causes.update(failed)
                scored.append(
                    QualityScoredFrame(frame=frame, quality=quality, retained=retained)
                )
        except KeyError:
            return StageResult(
                success=False,
                error=StructuredError(
                    code="BODY_NOT_VISIBLE",
                    message="Frame pixel data was unavailable for quality analysis.",
                    stage=self.name,
                ),
            )

        retained_frames = [sf for sf in scored if sf.retained]

        # ── Error evaluation ──
        # Case 1: every frame discarded → report the dominant failure cause.
        if data.frames and not retained_frames:
            error = self._all_discarded_error(discard_causes)
            return StageResult(success=False, error=error)

        # Case 2: frames retained → aggregate brightness / shake gates over the
        # retained set (Req 15.3, 15.4).
        if retained_frames:
            gate_error = self._retained_gate_error(retained_frames)
            if gate_error is not None:
                return StageResult(success=False, error=gate_error)

        # ── Success: return retained frames with their scores (Req 4.4) ──
        return StageResult(
            success=True,
            output=QualityScoredFrames(frames=scored, source_meta=data.source_meta),
        )

    def _all_discarded_error(self, discard_causes: Counter[str]) -> StructuredError:
        """
        Build the Structured_Error for the case where every frame was discarded.

        The dominant cause is the metric that failed in the most frames. Absent
        body visibility maps to `BODY_NOT_VISIBLE` (Req 4.5); a dominant
        brightness or shake failure maps to its dedicated code; any other
        dominant cause means the body could not be analyzed, so it also surfaces
        as `BODY_NOT_VISIBLE`.
        """
        dominant = discard_causes.most_common(1)[0][0] if discard_causes else "body_visibility"
        if dominant == "brightness":
            return StructuredError(
                code="CAMERA_TOO_DARK",
                message="Every frame was discarded; the recording is too dark to analyze.",
                stage=self.name,
            )
        if dominant == "camera_shake":
            return StructuredError(
                code="CAMERA_SHAKING",
                message="Every frame was discarded; the camera was too shaky to analyze.",
                stage=self.name,
            )
        # body_visibility-dominant (Req 4.5) and all other unusable-frame causes.
        return StructuredError(
            code="BODY_NOT_VISIBLE",
            message="Every frame was discarded; the body was not clearly visible.",
            stage=self.name,
        )

    def _retained_gate_error(
        self, retained_frames: list[QualityScoredFrame]
    ) -> StructuredError | None:
        """
        Apply the retained-frame brightness and shake gates (Req 15.3, 15.4).

        Brightness is the mean brightness score across retained frames; shake is
        the mean normalized shake (1 - camera_shake score) across retained
        frames. Returns the first triggered error, or None when both gates pass.
        """
        count = len(retained_frames)
        mean_brightness = sum(sf.quality.brightness for sf in retained_frames) / count
        if mean_brightness < self._min_brightness:
            return StructuredError(
                code="CAMERA_TOO_DARK",
                message="Retained-frame brightness is below the configured minimum.",
                stage=self.name,
            )

        mean_shake = sum(1.0 - sf.quality.camera_shake for sf in retained_frames) / count
        if mean_shake > self._max_camera_shake:
            return StructuredError(
                code="CAMERA_SHAKING",
                message="Retained-frame camera shake exceeds the configured maximum.",
                stage=self.name,
            )

        return None
