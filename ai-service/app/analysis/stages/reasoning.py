"""
Reasoning_Service — Pipeline Stage 9 ((MovementTimeline, ObjectiveMetrics) → ReasoningOutput)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Uses a large language model to reason over the structured Movement_Timeline and
the deterministic Objective_Metrics produced by the Biomechanics_Service, and
turns that reasoning into qualitative feedback (strengths, mistakes,
corrections, safety warnings, improvement tips, training advice).

Responsibilities (single-responsibility, behind the PipelineStage interface):
  • Req 10.1 — execute only after the Biomechanics_Service has produced
    Objective_Metrics. This is enforced structurally: the stage's input is the
    `(MovementTimeline, ObjectiveMetrics)` pair, so it cannot run until the
    Biomechanics_Service output exists.
  • Req 10.2 — accept the Movement_Timeline and Objective_Metrics as the only
    analytical inputs.
  • Req 10.3 / Req 1.4 — exclude raw video and raw frames from the input. The
    `ReasoningInput` contract below carries only the two structured analytical
    inputs; there is no field through which pixel data could enter.
  • Req 10.4 — when the supporting Objective_Metrics Confidence_Score is below
    the configured threshold, mark the produced output low confidence
    (`low_confidence=True`) while still returning it.
  • Req 15.5 — when the overall analysis Confidence_Score is below the
    configured threshold, return a Structured_Error with code `LOW_CONFIDENCE`.

Design notes
------------
The actual LLM call is hidden behind an abstract `Reasoner` seam (mirroring the
`VisionBackend` ABC in `app/vision/base.py`, the `ExerciseClassifier` seam in
`exercise_detection.py`, and the `OllamaClient` conventions in
`app/core/llm.py`). This decouples the stage's confidence-gating logic — the
part worth testing — from any concrete model, so the stage is fully testable
without a real LLM (Req 14.4). A real model-backed reasoner (`OllamaReasoner`)
is provided and can be swapped for any other implementation without touching
the stage.

The "overall analysis Confidence_Score" available at this point in the pipeline
is derived conservatively as the minimum of the supporting Objective_Metrics
confidence and the reasoner's self-reported reasoning confidence: the analysis
is only as trustworthy as its least-confident contributing source. The final
fused, calibrated confidence is computed later by the Confidence_Fusion_Service
(Req 27.x); this stage only needs a grounded gate for the `LOW_CONFIDENCE`
failure path (Req 15.5).

Following the pipeline contract in `base.py`, this stage NEVER raises on a
domain failure — it returns `StageResult(success=False, error=...)`. The
`Reasoner` seam likewise must not raise on model failure; `OllamaReasoner`
degrades to a zero-confidence output, which the stage then surfaces as
`LOW_CONFIDENCE`.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod

from pydantic import BaseModel

from app.core.config import settings

from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import MovementTimeline, ObjectiveMetrics, ReasoningOutput

logger = logging.getLogger("getfit-ai")


def _clamp01(value: float) -> float:
    """Clamp a value into the closed interval [0.0, 1.0]."""
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


class ReasoningInput(BaseModel):
    """
    The single, validated input contract for the Reasoning_Service (Req 10.2).

    It wraps the *only* two analytical inputs the stage is permitted to see — the
    Movement_Timeline and the Objective_Metrics — so the `PipelineStage[TIn, TOut]`
    interface (which takes one Pydantic input) is satisfied without ever exposing
    raw video or raw frames (Req 10.3, 1.4). There is deliberately no field for
    pixel data, frames, or a video reference: the privacy boundary is structural.
    """
    timeline: MovementTimeline
    metrics: ObjectiveMetrics


class Reasoner(ABC):
    """
    Abstract reasoning seam: maps the structured `(MovementTimeline,
    ObjectiveMetrics)` inputs to a `ReasoningOutput`.

    Real implementations run a language model over the structured data;
    test/in-memory implementations return precomputed output. This is the only
    seam through which the stage obtains qualitative feedback, which keeps the
    confidence-gating logic fully unit-testable (Req 14.4).

    Implementations MUST NOT raise on model failure (mirroring `VisionBackend`):
    they should degrade to a low/zero-confidence `ReasoningOutput` instead, so
    the stage can apply its `LOW_CONFIDENCE` gate uniformly. The `low_confidence`
    flag on the returned output is owned by the *stage*, not the seam — the seam
    only needs to populate the qualitative fields and its self-reported
    `confidence`.
    """

    @abstractmethod
    async def reason(
        self, timeline: MovementTimeline, metrics: ObjectiveMetrics
    ) -> ReasoningOutput:
        """Produce qualitative reasoning over the structured analytical inputs."""
        raise NotImplementedError


class StaticReasoner(Reasoner):
    """
    In-memory `Reasoner` that returns a fixed `ReasoningOutput`, independent of
    the inputs. Useful for tests and for wiring before a real model-backed
    reasoner is available.
    """

    def __init__(self, output: ReasoningOutput):
        self._output = output

    async def reason(
        self, timeline: MovementTimeline, metrics: ObjectiveMetrics
    ) -> ReasoningOutput:
        # Return a copy so callers/tests cannot mutate the canned fixture and so
        # the stage is free to set `low_confidence` on its own instance.
        return self._output.model_copy(deep=True)


class OllamaReasoner(Reasoner):
    """
    `Reasoner` backed by the shared `OllamaClient` (see `app/core/llm.py`).

    Reasons over the structured Movement_Timeline and Objective_Metrics ONLY
    (Req 10.2, 10.3) — the prompt is built purely from those structured values,
    so no raw video or frames can ever reach the model. Follows the JSON-output
    convention of `OllamaClient.generate_json` and degrades to a zero-confidence
    output on any model/parse failure rather than raising (so the stage's
    `LOW_CONFIDENCE` gate handles it uniformly).
    """

    _SYSTEM = (
        "You are a strength-and-conditioning analyst. You reason ONLY over the "
        "structured biomechanical metrics and movement timeline provided. Never "
        "assume anything you cannot derive from those numbers. Respond with a "
        "single JSON object with these array-of-string fields: strengths, "
        "mistakes, corrections, safety_warnings, improvement_tips, "
        "training_advice; and a numeric field 'confidence' in [0,1] reflecting "
        "how well-supported your reasoning is by the data."
    )

    def __init__(self, client=None, *, model: str | None = "main"):
        # Lazy default to the shared singleton so importing this module never
        # requires a live Ollama connection.
        if client is None:
            from app.core.llm import ollama

            client = ollama
        self._client = client
        self._model = model

    def _build_prompt(
        self, timeline: MovementTimeline, metrics: ObjectiveMetrics
    ) -> str:
        """Serialize the two structured inputs into a compact, model-ready prompt."""
        payload = {
            "objective_metrics": metrics.model_dump(),
            "movement_timeline": timeline.model_dump(),
        }
        return (
            "Analyze the following structured exercise data and return the JSON "
            "object described in the system prompt.\n\n"
            f"{json.dumps(payload, separators=(',', ':'))}"
        )

    async def reason(
        self, timeline: MovementTimeline, metrics: ObjectiveMetrics
    ) -> ReasoningOutput:
        try:
            raw = await self._client.generate_json(
                self._build_prompt(timeline, metrics),
                system=self._SYSTEM,
                model=self._model,
            )
            data = json.loads(raw)
        except Exception as exc:  # never raise on model/parse failure
            logger.warning("OllamaReasoner failed; degrading to low confidence: %s", exc)
            return ReasoningOutput(confidence=0.0)

        def _strs(key: str) -> list[str]:
            value = data.get(key, [])
            if isinstance(value, list):
                return [str(item) for item in value]
            return []

        try:
            confidence = _clamp01(float(data.get("confidence", 0.0)))
        except (TypeError, ValueError):
            confidence = 0.0

        return ReasoningOutput(
            strengths=_strs("strengths"),
            mistakes=_strs("mistakes"),
            corrections=_strs("corrections"),
            safety_warnings=_strs("safety_warnings"),
            improvement_tips=_strs("improvement_tips"),
            training_advice=_strs("training_advice"),
            confidence=confidence,
        )


class ReasoningService(PipelineStage[ReasoningInput, ReasoningOutput]):
    """
    Stage 9: reason over structured data and gate the result on confidence.

    Runs only after biomechanics (structurally, via its `ReasoningInput`),
    accepts only the timeline + metrics (Req 10.1, 10.2, 10.3), marks
    low-confidence output (Req 10.4), and emits `LOW_CONFIDENCE` when the overall
    analysis confidence is below the configured threshold (Req 15.5).
    """

    name: str = "reasoning"

    def __init__(
        self,
        reasoner: Reasoner,
        *,
        reasoning_confidence_min: float | None = None,
        overall_confidence_min: float | None = None,
    ) -> None:
        """
        Args:
            reasoner: abstract seam producing qualitative reasoning over the
                structured inputs.
            reasoning_confidence_min: supporting-confidence threshold below which
                the output is marked low confidence (Req 10.4); defaults to
                `settings.REASONING_CONFIDENCE_MIN` (config-driven, never hardcoded).
            overall_confidence_min: overall-analysis-confidence threshold below
                which a `LOW_CONFIDENCE` Structured_Error is returned (Req 15.5);
                defaults to `settings.OVERALL_CONFIDENCE_MIN`.
        """
        self._reasoner = reasoner
        self._reasoning_confidence_min = (
            settings.REASONING_CONFIDENCE_MIN
            if reasoning_confidence_min is None
            else reasoning_confidence_min
        )
        self._overall_confidence_min = (
            settings.OVERALL_CONFIDENCE_MIN
            if overall_confidence_min is None
            else overall_confidence_min
        )

    async def run(self, data: ReasoningInput) -> StageResult[ReasoningOutput]:
        # 1. Obtain qualitative reasoning from the injected seam. The seam only
        #    ever receives the two structured inputs (Req 10.2, 10.3) — there is
        #    no path for raw video/frames into the reasoner.
        output = await self._reasoner.reason(data.timeline, data.metrics)

        # 2. Bound the seam's self-reported confidence defensively so all
        #    downstream comparisons operate on a value in [0, 1].
        reasoning_confidence = _clamp01(output.confidence)
        supporting_confidence = _clamp01(data.metrics.confidence)

        # 3. Overall analysis confidence (Req 15.5): conservative — the analysis
        #    is only as trustworthy as its least-confident contributing source.
        overall_confidence = min(supporting_confidence, reasoning_confidence)

        # 4. LOW_CONFIDENCE gate (Req 15.5): a fatal failure when the overall
        #    analysis confidence is below the configured threshold.
        if overall_confidence < self._overall_confidence_min:
            return StageResult(success=False, error=self._low_confidence())

        # 5. Low-confidence marking (Req 10.4): non-fatal — when the supporting
        #    Objective_Metrics confidence is below the configured threshold, the
        #    output is marked low confidence but still returned.
        output.confidence = reasoning_confidence
        output.low_confidence = supporting_confidence < self._reasoning_confidence_min

        return StageResult(success=True, output=output)

    def _low_confidence(self) -> StructuredError:
        """Structured_Error emitted when overall analysis confidence is too low (Req 15.5)."""
        return StructuredError(
            code="LOW_CONFIDENCE",
            message="Overall analysis confidence is below the configured threshold.",
            stage=self.name,
        )
