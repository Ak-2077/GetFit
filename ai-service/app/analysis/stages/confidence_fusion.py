"""
Confidence_Fusion_Service — Pipeline Stage (ConfidenceSources → OverallConfidence)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fuses the six per-stage confidence sources (vision, pose, detection,
movement quality, biomechanics, reasoning) into a single calibrated overall
Confidence_Score. The stage enforces the invariants of Requirement 27:

  • Req 27.1 — combine all six per-source confidences into one overall score.
  • Req 27.2 / 27.4 — the overall Confidence_Score is bounded to [0.0, 1.0].
  • Req 27.3 — no single source determines the overall score on its own: each
    source's effective weight is capped at FUSION_MAX_SINGLE_WEIGHT before
    fusion, so varying any one source across its full [0,1] range can move the
    overall score by at most that source's (bounded) effective weight.
  • Req 27.2 (config) — the per-source weights are read from configuration
    (settings.FUSION_WEIGHTS), never hardcoded.

Fusion is a weighted average: with weights that sum to 1.0 and each input in
[0,1], the weighted sum is mathematically in [0,1]; the result is additionally
clamped to absorb floating-point error and guarantee the bound.

Weights are capped at FUSION_MAX_SINGLE_WEIGHT and then re-normalized to sum to
1.0 so the output stays a true weighted average while the cap prevents any one
source from dominating.

Like every stage, this one NEVER raises on domain failure — it returns a
`StageResult` (see `base.py`).
"""

from __future__ import annotations

from collections.abc import Mapping

from app.core.config import settings

from ..base import PipelineStage, StageResult
from ..contracts import ConfidenceSources, OverallConfidence

#: The six per-stage confidence sources fused into the overall score (Req 27.1),
#: in a fixed canonical order. The fusion weights in configuration are keyed by
#: these same names.
SOURCE_NAMES: tuple[str, ...] = (
    "vision",
    "pose",
    "detection",
    "movement_quality",
    "biomechanics",
    "reasoning",
)


class ConfidenceFusionService(PipelineStage[ConfidenceSources, OverallConfidence]):
    """
    Stage: combine the six per-source confidences into one bounded overall
    Confidence_Score using config-driven, capped, re-normalized weights.
    """

    name: str = "confidence_fusion"

    def __init__(
        self,
        weights: Mapping[str, float] | None = None,
        max_single_weight: float | None = None,
    ) -> None:
        # Weights and the per-source cap are read from configuration (Req 27.2,
        # 27.3), never hardcoded, with optional overrides to keep the stage
        # independently testable.
        self.weights: dict[str, float] = dict(
            settings.FUSION_WEIGHTS if weights is None else weights
        )
        self.max_single_weight: float = (
            settings.FUSION_MAX_SINGLE_WEIGHT
            if max_single_weight is None
            else max_single_weight
        )

    def _effective_weights(self) -> dict[str, float]:
        """
        Derive the effective fusion weights so that (a) they sum to 1.0, keeping
        the fusion a proper weighted average bounded to [0,1] (Req 27.2), and
        (b) no single source's effective weight exceeds `max_single_weight`, so
        no single source can determine the overall score on its own (Req 27.3).

        A plain cap-then-renormalize is insufficient: when the configured weight
        is concentrated on one source, re-normalizing the capped weights divides
        by that same source's cap and restores its effective weight to 1.0,
        defeating the cap. Instead we *water-fill*: normalize the configured
        weights, cap any source that exceeds the cap, and redistribute the
        removed excess uniformly across the sources that are still below the
        cap, iterating to a fixed point. This guarantees every final effective
        weight is <= cap while the total stays 1.0.

        Degenerate configurations fall back to a uniform distribution:
          • every configured weight non-positive, or
          • the cap is too small to spread 1.0 across the sources without some
            source exceeding it (i.e. cap * n < 1.0), which is infeasible.
        Missing/non-positive weights are treated as 0.0.
        """
        n = len(SOURCE_NAMES)
        cap = max(self.max_single_weight, 0.0)

        raw = {name: max(self.weights.get(name, 0.0), 0.0) for name in SOURCE_NAMES}
        total = sum(raw.values())

        # Degenerate weights, or a cap too small to keep every source <= cap
        # while summing to 1.0 — fall back to a uniform (non-dominating) split.
        if total <= 0.0 or cap <= 0.0 or cap * n < 1.0:
            uniform = 1.0 / n
            return {name: uniform for name in SOURCE_NAMES}

        eff = {name: w / total for name, w in raw.items()}

        # Water-filling: cap over-weight sources and spread the excess uniformly
        # across the sub-cap sources until no source exceeds the cap. Feasible
        # because cap * n >= 1.0, so the loop converges within n passes.
        tol = 1e-12
        for _ in range(n + 1):
            over = [name for name in SOURCE_NAMES if eff[name] > cap + tol]
            if not over:
                break
            excess = sum(eff[name] - cap for name in over)
            for name in over:
                eff[name] = cap
            receivers = [name for name in SOURCE_NAMES if eff[name] < cap - tol]
            if not receivers:
                break
            share = excess / len(receivers)
            for name in receivers:
                eff[name] += share

        return eff

    async def run(self, data: ConfidenceSources) -> StageResult[OverallConfidence]:
        effective = self._effective_weights()
        sources = {
            "vision": data.vision,
            "pose": data.pose,
            "detection": data.detection,
            "movement_quality": data.movement_quality,
            "biomechanics": data.biomechanics,
            "reasoning": data.reasoning,
        }

        # Weighted average of the six bounded sources (Req 27.1). With weights
        # summing to 1.0 and each source in [0,1], the result is in [0,1].
        score = sum(effective[name] * sources[name] for name in SOURCE_NAMES)

        # Clamp to absorb floating-point drift and guarantee the bound (Req 27.2).
        score = max(0.0, min(1.0, score))

        return StageResult(success=True, output=OverallConfidence(overall=score))
