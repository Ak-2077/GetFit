"""
Pose_Extraction_Service — Pipeline Stage 6 (KeyFrames → Landmarks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Single, model-agnostic interface that accepts selected key frames and returns
normalized body landmarks (Req 7.1). It delegates inference to a swappable
`Pose_Engine` chosen from configuration (`settings.POSE_ENGINE`, Req 7.2) via a
registry, so a different supported engine can be configured without changing
any other Pipeline_Stage (Req 7.3, 31.2). This mirrors the proven
`VisionAdapter` pattern in `app/vision/adapter.py`.

Stage guarantees:
  • Normalized, resolution-independent coordinates (Req 7.4) — enforced by the
    `Landmark` contract bounds and produced by the engine.
  • A per-landmark Pose_Confidence on every returned landmark (Req 21.1) —
    carried on the `Landmark` / `FrameLandmarks` contracts.
  • If more than one person is detected, a Structured_Error with code
    `MULTIPLE_PEOPLE` (Req 7.6).
  • NO language-model reasoning anywhere in this stage (Req 7.5).
  • Only frames / derived landmarks reach the engine — never the original video
    (Req 1.3, 3.7); the stage receives `KeyFrames`, which carry only frame
    index + timestamp, never pixel bytes.

Like every stage, this one NEVER raises on domain failure — it returns a
`StageResult(success=False, error=StructuredError(...))` (see `base.py`).
"""

from __future__ import annotations

import logging

from app.core.config import Settings, settings

from ..adapters.pose_engines import (
    PoseEngine,
    PoseEngineResult,
    build_pose_engine_registry,
)
from ..base import PipelineStage, StageResult, StructuredError
from ..contracts import KeyFrames, Landmarks
from ..person_validation import (
    PersonValidationConfig,
    validate_persons,
)

logger = logging.getLogger("getfit-ai")

# ── Stable error codes ──
# More than one person detected in the frames (Req 7.6, 15.2).
MULTIPLE_PEOPLE = "MULTIPLE_PEOPLE"
# The configured engine name is not present in the registry (Req 7.2 / 43.x).
POSE_ENGINE_NOT_CONFIGURED = "POSE_ENGINE_NOT_CONFIGURED"
# The selected engine cannot currently serve requests (e.g. backing library
# absent). No dedicated Req 15.2 code exists; this stable code reports the
# condition distinctly rather than masquerading as another failure.
POSE_ENGINE_UNAVAILABLE = "POSE_ENGINE_UNAVAILABLE"
# The engine raised / produced no usable output.
POSE_EXTRACTION_FAILED = "POSE_EXTRACTION_FAILED"


class PoseExtractionService(PipelineStage[KeyFrames, Landmarks]):
    """
    Stage 6: extract normalized body landmarks from key frames using the
    config-selected, replaceable `Pose_Engine`.
    """

    name: str = "pose_extraction"

    def __init__(
        self,
        config: Settings | None = None,
        registry: dict[str, PoseEngine] | None = None,
        active_engine: str | None = None,
    ) -> None:
        # Engine selection is read from configuration (never hardcoded); the
        # registry and active-engine overrides keep the stage independently
        # testable (mirrors the override pattern used by other stages).
        self._cfg = config or settings
        self._registry = (
            registry if registry is not None else build_pose_engine_registry()
        )
        self.active_engine = (
            active_engine if active_engine is not None else self._cfg.POSE_ENGINE
        )

    async def run(self, data: KeyFrames) -> StageResult[Landmarks]:
        # 1. Resolve the active engine from configuration (Req 7.2). An unknown
        #    engine name is a configuration error surfaced distinctly.
        engine = self._registry.get(self.active_engine)
        if engine is None:
            return StageResult(
                success=False,
                error=self._error(
                    POSE_ENGINE_NOT_CONFIGURED,
                    f"Configured pose engine '{self.active_engine}' is not "
                    f"registered. Known engines: {sorted(self._registry)}.",
                ),
            )

        # 2. Ensure the engine can serve requests before invoking it (mirrors
        #    VisionAdapter's is_available gate).
        try:
            available = await engine.is_available()
        except Exception:
            available = False
        if not available:
            return StageResult(
                success=False,
                error=self._error(
                    POSE_ENGINE_UNAVAILABLE,
                    f"Pose engine '{self.active_engine}' is unavailable.",
                ),
            )

        # 3. Delegate inference. The engine receives only frames (Req 1.3, 3.7)
        #    and must not raise on domain failure; guard defensively regardless.
        try:
            result: PoseEngineResult = await engine.extract(data.frames)
        except Exception as exc:  # pragma: no cover - defensive guard
            return StageResult(
                success=False,
                error=self._error(
                    POSE_EXTRACTION_FAILED,
                    f"Pose engine '{self.active_engine}' failed to extract "
                    f"landmarks: {exc!s}",
                ),
            )

        if not result.available:
            return StageResult(
                success=False,
                error=self._error(
                    POSE_ENGINE_UNAVAILABLE,
                    f"Pose engine '{self.active_engine}' is unavailable.",
                ),
            )

        # 4. Multi-person handling.
        #
        #    Preferred path (additive Person Validation Layer): when the engine
        #    supplies per-frame, per-person detections, distinguish a real
        #    moving athlete from static printed people (posters/banners),
        #    mirror reflections, TV screens, and background spectators. Reject
        #    ONLY when two or more genuine athletes are exercising in frame —
        #    never because of a poster. Maps the decision back to the stable,
        #    API-compatible MULTIPLE_PEOPLE code.
        if getattr(self._cfg, "PERSON_VALIDATION_ENABLED", True) and result.detections:
            pv = validate_persons(
                result.detections,
                total_frames=len(data.frames),
                config=PersonValidationConfig.from_settings(self._cfg),
            )

            # Stage 14 — log every ignored person with its reason.
            for s in pv.ignored:
                logger.info(
                    "PersonValidation: track %d IGNORED as %s — %s "
                    "[motion=%.3f pose=%.0f%% area=%.2f visible=%.0f%%]",
                    s.track_id, s.category.value, s.reason,
                    s.motion_score, s.avg_pose_confidence * 100.0,
                    s.avg_area, s.visible_fraction * 100.0,
                )
            if pv.primary_athlete is not None:
                logger.info(
                    "PersonValidation: primary athlete = track %d "
                    "(pose=%.0f%% motion=%.3f); real_athletes=%d, ignored=%d",
                    pv.primary_athlete.track_id,
                    pv.primary_athlete.avg_pose_confidence * 100.0,
                    pv.primary_athlete.motion_score,
                    pv.real_athlete_count, len(pv.ignored),
                )

            if pv.reject:
                return StageResult(
                    success=False,
                    error=self._error(MULTIPLE_PEOPLE, pv.reason),
                )
            # One athlete (background people ignored) → proceed to landmarks.

        # Legacy fallback (Req 7.6): engines that report only a person_count
        # (no per-person detections) keep the original guard, so a genuine
        # multi-person clip is still rejected and existing behavior is preserved.
        elif result.person_count > 1:
            return StageResult(
                success=False,
                error=self._error(
                    MULTIPLE_PEOPLE,
                    f"Detected {result.person_count} people in the frames; "
                    "analysis requires exactly one person.",
                ),
            )

        # 5. Success: normalized landmarks (Req 7.4) with per-landmark
        #    Pose_Confidence (Req 21.1), tagged with the producing engine for
        #    stable swapping and versioning (Req 7.3, 29.1, 31.2).
        return StageResult(
            success=True,
            output=Landmarks(
                frames=result.frames,
                source_meta=data.source_meta,
                pose_engine=engine.name,
            ),
        )

    def _error(self, code: str, message: str) -> StructuredError:
        return StructuredError(code=code, message=message, stage=self.name)
