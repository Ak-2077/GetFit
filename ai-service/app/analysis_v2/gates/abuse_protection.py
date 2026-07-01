"""
Stage 46 · Abuse_Protection_Service (Req 47)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive** pre-pipeline gate (design.md "Stage 46") that runs
*after* duplicate detection and *before any V1 AI stage*. It classifies whether
the submitted content is a genuine exercise recording and gates the rest of the
pipeline on that decision (Req 47):

  • Req 47.1 — compute an exercise-content Confidence_Score in [0.0, 1.0] before
    any Analysis_Pipeline AI stage executes.
  • Req 47.2 — when the score is BELOW the configured classification threshold
    (movie, TV, gaming, pet, landscape, car, empty room, unrelated people,
    cartoon, or any other non-exercise content), stop the subsequent AI stages
    and return a `StructuredError(code="NOT_EXERCISE_VIDEO")`.
  • Req 47.3 — when the score is AT OR ABOVE the threshold, pass the frames
    through unchanged so the pipeline proceeds to the next stage.
  • Req 47.4 — operate additively: the stage's input and output are the SAME
    contract (`KeyFrames` → `KeyFrames`), so it is contract-identical to a
    passthrough stage and never modifies any existing stage's interface.
  • Req 47.5 — read the classification threshold from configuration
    (`ABUSE_CONTENT_THRESHOLD`), never hardcoded.
  • Req 47.6 — when classification CANNOT complete, stop the subsequent AI
    stages and return a `StructuredError` identifying this stage and the failure
    cause, producing no `AnalysisResult`. A classification failure is treated as
    a rejection (below-threshold); the gate NEVER raises.

Design notes
------------
The actual frame-to-exercise-content classification is hidden behind an
abstract `ContentClassifier` seam, mirroring the `ExerciseClassifier` seam in
`app/analysis/stages/exercise_detection.py` (and the `VisionBackend` ABC in
`app/vision/base.py`). This decouples the gate's threshold/gating logic — the
part worth testing — from any concrete model, so the gate is fully testable
without a real classifier. A real model-backed classifier can be plugged in
later without touching this gate.

Following the pipeline contract in `base.py`, this gate NEVER raises on a
domain failure — it returns `StageResult(success=False, error=...)`.

Privacy by construction (Req 1, preserved by Req 52.5): the gate carries only
the frame references it received and passes them through unchanged; it persists
no video, frames, or pose images.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

# Build on the UNCHANGED V1 contracts, re-exported from the V2 package
# (Req 52.1, 52.6) — imported, never redefined.
from app.analysis.contracts import KeyFrames
from app.analysis_v2 import PipelineStage, StageResult, StructuredError
from app.analysis_v2.config_v2 import settings_v2


class ContentClassifier(ABC):
    """
    Abstract classifier seam: maps a set of key frames to an exercise-content
    Confidence_Score in the closed interval [0.0, 1.0] (Req 47.1).

    Real implementations run a content/scene model over the frames' pixel data;
    test/in-memory implementations return precomputed scores. This is the only
    seam through which the gate obtains a confidence, which keeps the threshold
    gating fully unit-testable.

    A higher score means the content is more likely a genuine exercise
    recording. Implementations MAY raise to signal that classification could not
    complete; the gate catches this and treats it as a rejection (Req 47.6) —
    implementations are NOT required to encode failure as a score.
    """

    @abstractmethod
    def classify(self, frames: KeyFrames) -> float:
        """Return the exercise-content Confidence_Score in [0.0, 1.0]."""
        raise NotImplementedError


class StaticContentClassifier(ContentClassifier):
    """
    In-memory `ContentClassifier` that returns a fixed score, independent of the
    frames. Useful for tests and for wiring before a real model-backed
    classifier is available. Pass ``confidence=None`` to simulate a classifier
    that cannot complete classification (it raises), exercising the Req 47.6
    failure path.
    """

    def __init__(self, confidence: float | None) -> None:
        self._confidence = confidence

    def classify(self, frames: KeyFrames) -> float:
        if self._confidence is None:
            raise RuntimeError("content classification could not complete")
        return self._confidence


class AbuseProtectionService(PipelineStage[KeyFrames, KeyFrames]):
    """
    Stage 46: gate the AI pipeline on an exercise-content Confidence_Score.

    Runs after duplicate detection and before any V1 AI stage. Additive: its
    input and output are the same `KeyFrames` contract (Req 47.4), so on success
    it is indistinguishable from a passthrough stage; on rejection it halts the
    pipeline with a `StructuredError`.
    """

    name: str = "abuse_protection"

    def __init__(
        self,
        classifier: ContentClassifier,
        *,
        content_threshold: float | None = None,
    ) -> None:
        """
        Args:
            classifier: abstract seam producing an exercise-content confidence.
            content_threshold: minimum exercise-content Confidence_Score required
                to allow the pipeline to proceed; defaults to
                `settings_v2.ABUSE_CONTENT_THRESHOLD` (Req 47.5 — config-driven,
                never hardcoded).
        """
        self._classifier = classifier
        self._content_threshold = (
            settings_v2.ABUSE_CONTENT_THRESHOLD
            if content_threshold is None
            else content_threshold
        )

    async def run(self, data: KeyFrames) -> StageResult[KeyFrames]:
        # 1. Obtain the exercise-content Confidence_Score from the injected
        #    classifier seam (Req 47.1). A classifier that cannot complete is
        #    treated as a rejection (Req 47.6) — never raise out of the gate.
        try:
            confidence = self._classifier.classify(data)
        except Exception:  # noqa: BLE001 — degrade gracefully on any failure
            return StageResult(
                success=False,
                error=self._not_exercise_video(
                    "Exercise-content classification could not complete."
                ),
            )

        # 2. Defensive bound: a confidence outside [0.0, 1.0] is not a valid
        #    classification result, so treat it as a failure to classify
        #    (Req 47.1, 47.6).
        if not (0.0 <= confidence <= 1.0):
            return StageResult(
                success=False,
                error=self._not_exercise_video(
                    "Exercise-content classification produced an out-of-range score."
                ),
            )

        # 3. Threshold gate (Req 47.2, 47.3): below the configured threshold the
        #    content is rejected as non-exercise and the subsequent AI stages are
        #    stopped with a Structured_Error and no Analysis_Result.
        if confidence < self._content_threshold:
            return StageResult(
                success=False,
                error=self._not_exercise_video(
                    "Submitted content is not a genuine exercise recording."
                ),
            )

        # 4. At or above the threshold: pass the frames through UNCHANGED so the
        #    pipeline proceeds to the next stage (Req 47.3, 47.4).
        return StageResult(success=True, output=data)

    def _not_exercise_video(self, message: str) -> StructuredError:
        """
        Structured_Error emitted on rejection or classification failure
        (Req 47.2, 47.6). Names this gate as the originating Pipeline_Stage and
        carries no Analysis_Result.
        """
        return StructuredError(
            code="NOT_EXERCISE_VIDEO",
            message=message,
            stage=self.name,
        )
