"""
Feedback_Service — Pipeline Stage 10 ((ReasoningOutput, ObjectiveMetrics, MovementTimeline) → AnalysisResult)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Assembles the final, bounded `AnalysisResult` from the structured outputs of the
earlier analytical stages — the `ReasoningOutput`, the `ObjectiveMetrics`, and
the `MovementTimeline` (plus the per-job `RepetitionSummary` and detected
exercise id that flow alongside them). It performs NO new model inference: every
field is a deterministic projection of data already produced upstream.

Responsibilities (single-responsibility, behind the PipelineStage interface):
  • Req 11.1 — produce all score fields: Overall Score, Movement Score, Range of
    Motion, Tempo, Stability, Symmetry, and Joint Alignment.
  • Req 11.2 — produce all qualitative fields: Strengths, Mistakes, Corrections,
    Safety Warnings, Improvement Tips, and Training Advice.
  • Req 11.3 — derive EVERY Analysis_Result field from the Objective_Metrics, the
    Movement_Timeline, or the Reasoning_Service output. The scores are projected
    from the deterministic metrics; the qualitative fields are taken from the
    reasoning output; nothing is invented here.
  • Req 11.4 — when ANY contributing Confidence_Score is below the configured
    threshold, mark the result low confidence (`low_confidence=True`) AND include
    an explicit, human-readable low-confidence statement in the result.
  • Req 17.1 — Version 1 scope: emit the full Analysis_Result *structure* without
    requiring validated exercise-quality scoring logic. The score projections
    below are transparent, deterministic placeholders, NOT validated coaching
    scores; per-exercise quality logic plugs in later through the
    Exercise_Plugin interface (Req 17.x, 28.x).

Design notes
------------
The canonical stage signature in design.md is
`(ReasoningOutput, ObjectiveMetrics, MovementTimeline) → AnalysisResult`. Since a
`PipelineStage[TIn, TOut]` takes exactly one Pydantic input, the three analytical
inputs are wrapped in a single validated `FeedbackInput` contract — mirroring the
`ReasoningInput` pattern in `reasoning.py`. `FeedbackInput` additionally carries
the `RepetitionSummary` and `exercise_id` that the persisted `AnalysisResult`
requires (Req 13.1) and an optional fused `overall_confidence` from the
Confidence_Fusion_Service (Req 27.x); when the fused value is absent the stage
derives a conservative overall confidence from the contributing sources so the
stage is usable and testable independently of fusion (Req 14.4).

Version metadata (Req 29.1) is assembled with `build_analysis_versioning` from
`contracts.py` using the active engine/model identifiers (config-driven, never
hardcoded in the stage).

Following the pipeline contract in `base.py`, this stage NEVER raises on a domain
failure — it returns `StageResult(success=False, error=StructuredError(...))`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from app.core.config import settings

from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import (
    AnalysisResult,
    MovementTimeline,
    ObjectiveMetrics,
    ReasoningOutput,
    RepetitionSummary,
    build_analysis_versioning,
)

logger = logging.getLogger("getfit-ai")

# Stable error code for the (non-domain) unexpected-failure guard.
FEEDBACK_ERROR = "FEEDBACK_ERROR"

# Decimal places used when rounding derived score placeholders. Rounding is a
# deterministic, cosmetic operation and never affects which fields are present.
_ROUND = 6

# The explicit, human-readable low-confidence statement attached to the result
# when any contributing Confidence_Score is below the configured threshold
# (Req 11.4). Surfaced through `safety_warnings` so it reaches the End_User
# alongside the boolean `low_confidence` flag.
LOW_CONFIDENCE_STATEMENT: str = (
    "Low confidence: this analysis is based on data with confidence below the "
    "configured threshold and should be interpreted with caution."
)


def _clamp01(value: float) -> float:
    """Clamp a value into the closed interval [0.0, 1.0]."""
    return max(0.0, min(1.0, value))


def _default_repetition_summary() -> RepetitionSummary:
    """A zero-rep RepetitionSummary used when none is supplied (degenerate case)."""
    return RepetitionSummary(
        rep_count=0,
        phase_timestamps=[],
        avg_rep_duration_ms=0.0,
        movement_consistency=0.0,
    )


class FeedbackInput(BaseModel):
    """
    The single, validated input contract for the Feedback_Service.

    Wraps the three analytical inputs named in the design signature — the
    Reasoning_Service output, the deterministic Objective_Metrics, and the
    Movement_Timeline — so the `PipelineStage[TIn, TOut]` interface (one input)
    is satisfied, mirroring `ReasoningInput` in `reasoning.py`.

    It also carries the contextual values the persisted `AnalysisResult` requires
    but that are not part of the analytical triple:
      • `exercise_id` — the detected exercise identifier (Req 13.1); defaults to
        empty when detection is unavailable.
      • `repetition_summary` — the per-job rep summary; defaults to a zero-rep
        summary when reps were not counted.
      • `overall_confidence` — the fused overall Confidence_Score from the
        Confidence_Fusion_Service (Req 27.x). When omitted, the stage derives a
        conservative value from the contributing sources.
    """
    reasoning: ReasoningOutput
    metrics: ObjectiveMetrics
    timeline: MovementTimeline
    exercise_id: str = ""
    repetition_summary: RepetitionSummary = Field(
        default_factory=_default_repetition_summary
    )
    overall_confidence: float | None = None


class FeedbackService(PipelineStage[FeedbackInput, AnalysisResult]):
    """
    Stage 10: assemble the bounded `AnalysisResult` from upstream structured data.

    Projects the deterministic Objective_Metrics into the Req 11.1 score fields,
    copies the Req 11.2 qualitative fields from the Reasoning_Service output,
    derives every field from metrics/timeline/reasoning (Req 11.3), and marks the
    result low confidence with an explicit statement when any contributing
    confidence is below the configured threshold (Req 11.4). Emits the full
    structure without validated quality-scoring logic (Req 17.1).
    """

    name: str = "feedback"

    def __init__(
        self,
        *,
        confidence_min: float | None = None,
        pose_engine_version: str | None = None,
        vision_model_version: str | None = None,
        reasoning_model_version: str | None = None,
    ) -> None:
        """
        Args:
            confidence_min: threshold below which any contributing
                Confidence_Score marks the result low confidence (Req 11.4);
                defaults to `settings.REASONING_CONFIDENCE_MIN` (config-driven,
                never hardcoded).
            pose_engine_version / vision_model_version / reasoning_model_version:
                active engine/model identifiers recorded in Analysis_Versioning
                (Req 29.1); default to the configured engine/model values.
        """
        self._confidence_min = (
            settings.REASONING_CONFIDENCE_MIN
            if confidence_min is None
            else confidence_min
        )
        self._pose_engine_version = (
            settings.POSE_ENGINE
            if pose_engine_version is None
            else pose_engine_version
        )
        self._vision_model_version = (
            settings.OLLAMA_VISION_MODEL
            if vision_model_version is None
            else vision_model_version
        )
        self._reasoning_model_version = (
            settings.OLLAMA_MODEL
            if reasoning_model_version is None
            else reasoning_model_version
        )

    async def run(self, data: FeedbackInput) -> StageResult[AnalysisResult]:
        try:
            result = self._build(data)
        except Exception:  # pragma: no cover - defensive; never raise (base.py)
            return StageResult(
                success=False,
                error=StructuredError(
                    code=FEEDBACK_ERROR,
                    message="Failed to assemble the analysis result.",
                    stage=self.name,
                ),
            )
        return StageResult(success=True, output=result)

    # ── Result assembly (Req 11.1–11.4, 17.1) ──

    def _build(self, data: FeedbackInput) -> AnalysisResult:
        metrics = data.metrics
        reasoning = data.reasoning
        reps = data.repetition_summary

        # Contributing Confidence_Scores available at this point (Req 11.4). The
        # overall analysis confidence is the fused value when supplied, otherwise
        # a conservative minimum of the contributing sources — the result is only
        # as trustworthy as its least-confident input.
        metric_confidence = _clamp01(metrics.confidence)
        reasoning_confidence = _clamp01(reasoning.confidence)
        consistency = _clamp01(reps.movement_consistency)

        if data.overall_confidence is None:
            overall_confidence = min(
                metric_confidence, reasoning_confidence, consistency
            )
        else:
            overall_confidence = _clamp01(data.overall_confidence)

        # Low-confidence determination (Req 11.4): low when ANY contributing
        # confidence is below the configured threshold, or when the upstream
        # Reasoning_Service already flagged its output low confidence (Req 10.4).
        contributing = [
            metric_confidence,
            reasoning_confidence,
            consistency,
            overall_confidence,
        ]
        low_confidence = reasoning.low_confidence or any(
            value < self._confidence_min for value in contributing
        )

        # Score fields (Req 11.1) — deterministic projections of the metrics.
        # These are V1 structural placeholders, NOT validated quality scores
        # (Req 17.1): per-exercise scoring plugs in later via Exercise_Plugin.
        stability = round(_clamp01(metrics.balance), _ROUND)
        symmetry = round(_clamp01(metrics.symmetry), _ROUND)
        # Movement score: transparent composite of the available structural
        # signals, expressed on a 0–100 scale.
        movement_score = round(100.0 * (stability + symmetry) / 2.0, _ROUND)
        # Overall score: movement quality tempered by the overall confidence in
        # the underlying data, on the same 0–100 scale.
        overall_score = round(movement_score * overall_confidence, _ROUND)

        # Qualitative feedback (Req 11.2) — taken directly from the reasoning
        # output (copied so the result owns its lists).
        safety_warnings = list(reasoning.safety_warnings)

        # Explicit low-confidence statement (Req 11.4): surfaced to the End_User
        # alongside the boolean flag.
        if low_confidence and LOW_CONFIDENCE_STATEMENT not in safety_warnings:
            safety_warnings.insert(0, LOW_CONFIDENCE_STATEMENT)

        versions = build_analysis_versioning(
            pose_engine_version=self._pose_engine_version,
            vision_model_version=self._vision_model_version,
            reasoning_model_version=self._reasoning_model_version,
        )

        return AnalysisResult(
            exercise_id=data.exercise_id,
            analysis_date=datetime.now(timezone.utc).isoformat(),
            overall_score=overall_score,
            # Scores (Req 11.1)
            movement_score=movement_score,
            range_of_motion=dict(metrics.range_of_motion),
            tempo=metrics.tempo,
            stability=stability,
            symmetry=symmetry,
            joint_alignment=dict(metrics.joint_angles),
            # Qualitative feedback (Req 11.2)
            strengths=list(reasoning.strengths),
            mistakes=list(reasoning.mistakes),
            corrections=list(reasoning.corrections),
            safety_warnings=safety_warnings,
            improvement_tips=list(reasoning.improvement_tips),
            training_advice=list(reasoning.training_advice),
            # Movement metrics + reps
            movement_metrics=metrics,
            repetition_summary=reps,
            overall_confidence=overall_confidence,
            low_confidence=low_confidence,
            # Versioning metadata (Req 29.1)
            **versions,
        )
