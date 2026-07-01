"""
Pose_Confidence_Validator — Pipeline Stage (Landmarks → Landmarks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Filters landmarks by Pose_Confidence and gates overall pose reliability before
the analytical (biomechanics) stages run. The stage enforces the acceptance
criteria of Requirement 21:

  • Req 21.1 — every landmark already carries a per-landmark Pose_Confidence
    (guaranteed by the `Landmark` contract); this stage reads it.
  • Req 21.2 — a landmark whose Pose_Confidence is below the configured
    per-landmark threshold (`POSE_LANDMARK_CONFIDENCE_MIN`) is rejected, i.e.
    excluded from the emitted landmarks. Landmarks at or above the threshold are
    retained unchanged.
  • Req 21.3 — when the overall Pose_Confidence is below the configured overall
    threshold (`POSE_OVERALL_CONFIDENCE_MIN`), the stage returns a
    Structured_Error with code `LOW_CONFIDENCE` and produces no output, halting
    analysis before the Biomechanics_Service.
  • Req 21.4 — because a low-confidence pose halts the pipeline here (and
    rejected landmarks are dropped from the emitted contract), the affected
    landmarks never reach the Biomechanics_Service input.
  • Req 21.5 — both thresholds are read from configuration (never hardcoded),
    with optional constructor overrides to keep the stage independently testable.

The stage operates *additively*: it never mutates its input. It builds and
returns a fresh `Landmarks` payload, preserving `source_meta` and `pose_engine`
so downstream stages and Analysis_Versioning are unaffected.

Like every stage, this one NEVER raises on domain failure — it returns a
`StageResult` (see `base.py`).
"""

from __future__ import annotations

from app.core.config import settings

from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import FrameLandmarks, Landmarks

#: Stable error code emitted when overall pose confidence falls below the
#: configured threshold (Req 21.3; see the Error Handling table in design.md).
LOW_CONFIDENCE = "LOW_CONFIDENCE"


class PoseConfidenceValidator(PipelineStage[Landmarks, Landmarks]):
    """
    Stage: reject sub-threshold landmarks (Req 21.2), then gate the overall
    pose confidence (Req 21.3) before the analytical stages.
    """

    name: str = "pose_confidence_validation"

    def __init__(
        self,
        landmark_confidence_min: float | None = None,
        overall_confidence_min: float | None = None,
    ) -> None:
        # Thresholds are read from configuration (Req 21.5); optional overrides
        # keep the stage independently testable without touching global config.
        self.landmark_confidence_min = (
            settings.POSE_LANDMARK_CONFIDENCE_MIN
            if landmark_confidence_min is None
            else landmark_confidence_min
        )
        self.overall_confidence_min = (
            settings.POSE_OVERALL_CONFIDENCE_MIN
            if overall_confidence_min is None
            else overall_confidence_min
        )

    async def run(self, data: Landmarks) -> StageResult[Landmarks]:
        # 1. Per-landmark filtering (Req 21.2): retain exactly the landmarks
        #    whose Pose_Confidence is at or above the per-landmark threshold;
        #    landmarks strictly below it are rejected (excluded). Build fresh
        #    FrameLandmarks so the input is never mutated (additive operation).
        filtered_frames: list[FrameLandmarks] = [
            FrameLandmarks(
                timestamp_ms=fl.timestamp_ms,
                landmarks=[
                    lm
                    for lm in fl.landmarks
                    if lm.confidence >= self.landmark_confidence_min
                ],
                overall_confidence=fl.overall_confidence,
            )
            for fl in data.frames
        ]

        # 2. Determine overall pose confidence and gate it (Req 21.3).
        overall = self._overall_confidence(filtered_frames)
        if overall < self.overall_confidence_min:
            # Low overall confidence halts the pipeline before biomechanics
            # (Req 21.4): no output is produced and a sanitized Structured_Error
            # is surfaced (Req 21.3).
            return StageResult(
                success=False,
                error=StructuredError(
                    code=LOW_CONFIDENCE,
                    message=(
                        "Overall pose confidence is below the minimum required "
                        "for reliable analysis."
                    ),
                    stage=self.name,
                ),
            )

        # 3. Above threshold: emit the confidence-filtered landmarks, preserving
        #    source metadata and the producing engine for downstream stages.
        return StageResult(
            success=True,
            output=Landmarks(
                frames=filtered_frames,
                source_meta=data.source_meta,
                pose_engine=data.pose_engine,
            ),
        )

    def _overall_confidence(self, frames: list[FrameLandmarks]) -> float:
        """
        Aggregate overall Pose_Confidence across frames as the mean of the
        per-frame `overall_confidence` values.

        Degenerate cases are treated as low confidence (returns 0.0): no frames
        at all, or every landmark rejected so that no frame retains any landmark
        (design edge case: "all landmarks rejected → overall low confidence →
        LOW_CONFIDENCE").
        """
        if not frames:
            return 0.0
        if all(len(fl.landmarks) == 0 for fl in frames):
            return 0.0
        return sum(fl.overall_confidence for fl in frames) / len(frames)
