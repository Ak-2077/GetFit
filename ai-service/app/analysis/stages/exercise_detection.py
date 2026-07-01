"""
Exercise_Detection_Service — Pipeline Stage 5 (KeyFrames → Detection)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Identifies which exercise was performed from the selected key frames. The stage
enforces the acceptance criteria of Requirement 6:

  • Req 6.1 — return a detected exercise identifier together with its
    Confidence_Score.
  • Req 6.2 — return a ranked list of alternative exercise identifiers, each
    with its Confidence_Score, in non-increasing confidence order.
  • Req 6.3 — when the highest Confidence_Score is below the configured
    `DETECTION_CONFIDENCE_MIN` threshold, return a Structured_Error with code
    `EXERCISE_NOT_RECOGNIZED`.
  • Req 6.4 — exclude posture-quality judgments from the detection output. The
    stage only ranks *which* exercise was performed; *how well* it was performed
    is the responsibility of the Biomechanics/Reasoning stages. The `Detection`
    contract carries no posture/quality field, so this exclusion is structural.

Design notes
------------
The actual frame-to-exercise classification is hidden behind an abstract
`ExerciseClassifier` seam (mirroring the `VisionBackend` ABC in
`app/vision/base.py` and the `FramePixelSource` seam in `frame_quality.py`).
This decouples the stage's ranking/gating logic — the part worth testing — from
any concrete model, so the stage is fully testable without a real classifier
(Req 14.4). A real model-backed classifier can be plugged in later without
touching this stage.

Following the pipeline contract in `base.py`, this stage NEVER raises on a
domain failure — it returns `StageResult(success=False, error=...)`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel, Field

from app.core.config import settings

from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import Detection, KeyFrames


def _clamp01(value: float) -> float:
    """Clamp a value into the closed interval [0.0, 1.0] (Req 6.1, 6.2)."""
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


class ClassifierScore(BaseModel):
    """
    A single candidate produced by an `ExerciseClassifier`: an exercise
    identifier and its raw Confidence_Score. Confidence is bounded to [0, 1]
    here so the seam can never feed an out-of-range value into the ranking or
    into the `Detection` contract.
    """
    exercise_id: str
    confidence: float = Field(..., ge=0.0, le=1.0)


class ExerciseClassifier(ABC):
    """
    Abstract classifier seam: maps a set of key frames to candidate exercise
    identifiers with Confidence_Scores.

    Real implementations run a model over the frames' pixel data; test/in-memory
    implementations return precomputed candidates. This is the only seam through
    which the stage obtains predictions, which keeps the ranking and threshold
    gating fully unit-testable.
    """

    @abstractmethod
    def classify(self, frames: KeyFrames) -> list[ClassifierScore]:
        """Return candidate exercises with Confidence_Scores for the key frames."""
        raise NotImplementedError


class StaticExerciseClassifier(ExerciseClassifier):
    """
    In-memory `ExerciseClassifier` that returns a fixed list of candidates,
    independent of the frames. Useful for tests and for wiring before a real
    model-backed classifier is available.
    """

    def __init__(self, candidates: list[ClassifierScore]):
        self._candidates = list(candidates)

    def classify(self, frames: KeyFrames) -> list[ClassifierScore]:
        return list(self._candidates)


class ExerciseDetectionService(PipelineStage[KeyFrames, Detection]):
    """
    Stage 5: rank candidate exercises by Confidence_Score and gate the top
    candidate on the configured detection threshold.
    """

    name: str = "exercise_detection"

    def __init__(
        self,
        classifier: ExerciseClassifier,
        *,
        confidence_min: float | None = None,
    ) -> None:
        """
        Args:
            classifier: abstract seam producing candidate exercises with scores.
            confidence_min: minimum top Confidence_Score required to accept a
                detection; defaults to `settings.DETECTION_CONFIDENCE_MIN`
                (Req 6.3 — config-driven, never hardcoded).
        """
        self._classifier = classifier
        self._confidence_min = (
            settings.DETECTION_CONFIDENCE_MIN
            if confidence_min is None
            else confidence_min
        )

    async def run(self, data: KeyFrames) -> StageResult[Detection]:
        # 1. Obtain candidate exercises from the injected classifier seam, then
        #    rank them in non-increasing Confidence_Score order (Req 6.2). The
        #    sort is stable, so equally-confident candidates keep their original
        #    relative order.
        candidates = sorted(
            self._classifier.classify(data),
            key=lambda c: c.confidence,
            reverse=True,
        )

        # 2. No candidate at all means nothing could be recognized (Req 6.3).
        if not candidates:
            return StageResult(success=False, error=self._not_recognized())

        # 3. Threshold gate (Req 6.3): if the highest Confidence_Score is below
        #    the configured minimum, the exercise is not recognized.
        top = candidates[0]
        if top.confidence < self._confidence_min:
            return StageResult(success=False, error=self._not_recognized())

        # 4. Build the detection output (Req 6.1, 6.2). The top candidate is the
        #    detected exercise; the remainder are the ranked alternatives. No
        #    posture-quality information is included (Req 6.4) — the Detection
        #    contract has no such field.
        alternatives = [
            {"exercise_id": c.exercise_id, "confidence": _clamp01(c.confidence)}
            for c in candidates[1:]
        ]
        return StageResult(
            success=True,
            output=Detection(
                exercise_id=top.exercise_id,
                confidence=_clamp01(top.confidence),
                alternatives=alternatives,
            ),
        )

    def _not_recognized(self) -> StructuredError:
        """Structured_Error emitted when no exercise clears the threshold (Req 6.3)."""
        return StructuredError(
            code="EXERCISE_NOT_RECOGNIZED",
            message="No exercise could be recognized with sufficient confidence.",
            stage=self.name,
        )
