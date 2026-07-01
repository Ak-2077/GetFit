"""
Smoothing_Adapter — Pipeline Stage (Landmarks → Landmarks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A replaceable temporal-smoothing layer that sits additively between pose
extraction and the Biomechanics_Service (Req 25.1, 25.4, 25.5). It exposes the
single `Landmarks → Landmarks` stage interface and delegates the actual
filtering to a swappable `SmoothingAlgorithm` chosen from configuration
(`settings.SMOOTHING_ALGORITHM`, Req 25.3) via a registry — so a different
supported algorithm (One Euro / Kalman / Savitzky-Golay / Moving Average) can
be configured without changing any other Pipeline_Stage (Req 25.2). This
mirrors the `Pose_Extraction_Service` / `VisionAdapter` pattern.

Stage guarantees:
  • Operates additively (Req 25.1, 25.4, 25.5): consumes the `Landmarks`
    contract produced upstream and emits the same contract, preserving
    `source_meta` and the `pose_engine` tag so the Biomechanics_Service input
    interface is unchanged.
  • Structure- and length-preserving (Req 25.2, 25.3): the smoothed output has
    the same number of frames and the same number of landmarks per frame as the
    input (enforced by the algorithm via the shared adapter machinery).
  • Purely numerical — performs NO language-model reasoning.

Like every stage, this one NEVER raises on domain failure — it returns a
`StageResult(success=False, error=StructuredError(...))` (see `base.py`).
"""

from __future__ import annotations

from app.core.config import Settings, settings

from ..adapters.smoothing import (
    SmoothingAlgorithm,
    build_smoothing_registry,
)
from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import Landmarks

# ── Stable error codes ──
# The configured smoothing algorithm name is not present in the registry.
SMOOTHING_ALGORITHM_NOT_CONFIGURED = "SMOOTHING_ALGORITHM_NOT_CONFIGURED"
# The selected algorithm raised while smoothing.
SMOOTHING_FAILED = "SMOOTHING_FAILED"


class SmoothingAdapter(PipelineStage[Landmarks, Landmarks]):
    """
    Stage: apply the config-selected, replaceable `SmoothingAlgorithm` to the
    extracted landmarks before biomechanics (Req 25.1, 25.4).
    """

    name: str = "smoothing"

    def __init__(
        self,
        config: Settings | None = None,
        registry: dict[str, SmoothingAlgorithm] | None = None,
        active_algorithm: str | None = None,
    ) -> None:
        # Algorithm selection is read from configuration (never hardcoded); the
        # registry and active-algorithm overrides keep the stage independently
        # testable (mirrors the Pose_Extraction_Service override pattern).
        self._cfg = config or settings
        self._registry = (
            registry if registry is not None else build_smoothing_registry()
        )
        self.active_algorithm = (
            active_algorithm
            if active_algorithm is not None
            else self._cfg.SMOOTHING_ALGORITHM
        )

    async def run(self, data: Landmarks) -> StageResult[Landmarks]:
        # 1. Resolve the active algorithm from configuration (Req 25.3). An
        #    unknown name is a configuration error surfaced distinctly.
        algorithm = self._registry.get(self.active_algorithm)
        if algorithm is None:
            return StageResult(
                success=False,
                error=self._error(
                    SMOOTHING_ALGORITHM_NOT_CONFIGURED,
                    f"Configured smoothing algorithm '{self.active_algorithm}' "
                    f"is not registered. Known algorithms: {sorted(self._registry)}.",
                ),
            )

        # 2. Delegate filtering. The algorithm preserves structure and length
        #    (Req 25.2, 25.3); guard defensively so a numerical failure becomes
        #    a sanitized Structured_Error rather than a raised exception.
        try:
            smoothed = algorithm.smooth(data.frames)
        except Exception as exc:  # pragma: no cover - defensive guard
            return StageResult(
                success=False,
                error=self._error(
                    SMOOTHING_FAILED,
                    f"Smoothing algorithm '{self.active_algorithm}' failed: {exc!s}",
                ),
            )

        # 3. Success: re-emit the Landmarks contract additively, preserving
        #    source metadata and the producing pose engine so the downstream
        #    Biomechanics_Service interface is unchanged (Req 25.4, 25.5).
        return StageResult(
            success=True,
            output=Landmarks(
                frames=smoothed,
                source_meta=data.source_meta,
                pose_engine=data.pose_engine,
            ),
        )

    def _error(self, code: str, message: str) -> StructuredError:
        return StructuredError(code=code, message=message, stage=self.name)
