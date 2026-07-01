"""
Pose_Engine — replaceable pose-estimation backend interface & registry
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A `Pose_Engine` is a swappable pose-estimation backend (MediaPipe, MoveNet,
BlazePose, OpenPose, …) accessed exclusively through the
`Pose_Extraction_Service`. This module mirrors the proven
`VisionBackend`/`VisionAdapter` convention in `app/vision/`:

  • `PoseEngine` is an ABC (analogous to `VisionBackend`) with `is_available`
    and `extract`.
  • Concrete engines are registered ONCE in a registry keyed by `name`
    (analogous to `VisionAdapter._build_registry`).
  • The active engine is selected by configuration (`settings.POSE_ENGINE`)
    inside the `Pose_Extraction_Service`, so swapping engines needs no change
    to any other Pipeline_Stage (Req 7.2, 7.3, 31.2).

Engines NEVER perform language-model reasoning (Req 7.5) and only ever receive
extracted frames — never the original video (Req 1.3, 3.7). Every engine
returns landmarks in a normalized, resolution-independent coordinate space
(Req 7.4) with a per-landmark Pose_Confidence (Req 21.1).

The four concrete engines here are dependency-gated stubs: each reports
availability by probing for its underlying library and, until that library is
wired in, returns an "unavailable" result rather than raising. This keeps the
registry complete and the interface stable while real inference is added
behind each engine independently.
"""

from __future__ import annotations

import importlib.util
from abc import ABC, abstractmethod

from pydantic import BaseModel, Field

from ..contracts import Frame, FrameLandmarks
from ..person_validation import PersonDetection


class PoseEngineResult(BaseModel):
    """
    Normalized output from ANY `Pose_Engine`.

    `frames` carries the per-frame normalized landmarks (Req 7.4, 21.1).
    `person_count` is the maximum number of distinct people the engine detected
    across the supplied frames; the `Pose_Extraction_Service` uses it to emit a
    `MULTIPLE_PEOPLE` error when more than one person is present (Req 7.6).
    `available` is False when the engine could not run (e.g. its backing library
    is not installed); in that case `frames` is empty.
    """
    frames: list[FrameLandmarks] = Field(default_factory=list)
    person_count: int = Field(default=0, ge=0)
    available: bool = True
    #: Optional per-frame, per-person raw detections (bbox + pose confidence),
    #: consumed by the additive Person Validation Layer to distinguish a real
    #: athlete from posters/mirrors/TVs/spectators. Empty by default so existing
    #: engines and tests are unaffected; when present, the Pose_Extraction_Service
    #: uses it instead of the naive person_count gate.
    detections: list[PersonDetection] = Field(default_factory=list)


class PoseEngine(ABC):
    """Abstract base every swappable pose-estimation backend must implement.

    Mirrors `app/vision/base.py::VisionBackend`. Implementations MUST NOT raise
    on inference failure — return a `PoseEngineResult(available=False)` (or an
    empty result) so the `Pose_Extraction_Service` can surface a sanitized
    Structured_Error. Implementations MUST NOT invoke any language model
    (Req 7.5).
    """

    #: Stable identifier, e.g. "mediapipe", "movenet", "blazepose", "openpose".
    name: str = "base"
    #: Engine version string, surfaced as poseEngineVersion in versioning (Req 29.1).
    version: str = "0.0.0"

    @abstractmethod
    async def is_available(self) -> bool:
        """Return True if this engine can currently serve extraction requests."""
        raise NotImplementedError

    @abstractmethod
    async def extract(self, frames: list[Frame]) -> PoseEngineResult:
        """
        Convert extracted frames into normalized body landmarks.

        Returns landmarks in a normalized, resolution-independent coordinate
        space (Req 7.4) with a per-landmark Pose_Confidence (Req 21.1). Receives
        only frames — never the original video (Req 1.3, 3.7). Must not raise on
        inference failure (return an unavailable/empty `PoseEngineResult`).
        """
        raise NotImplementedError


class _DependencyGatedPoseEngine(PoseEngine):
    """
    Shared stub behavior for engines whose real inference is added later.

    Availability is determined by probing for the engine's backing library via
    `import_module_name`. Until inference is implemented, `extract` returns an
    unavailable result instead of fabricating landmarks, keeping the registry
    complete and the interface stable (Req 31.2).
    """

    #: The importable module that must be present for the engine to run.
    import_module_name: str = ""

    async def is_available(self) -> bool:
        if not self.import_module_name:
            return False
        try:
            return importlib.util.find_spec(self.import_module_name) is not None
        except (ImportError, ValueError, ModuleNotFoundError):
            return False

    async def extract(self, frames: list[Frame]) -> PoseEngineResult:
        # Real inference is wired in per-engine later; until then the engine is
        # honestly reported as unavailable rather than returning fake poses.
        return PoseEngineResult(frames=[], person_count=0, available=False)


class MediaPipePoseEngine(_DependencyGatedPoseEngine):
    """MediaPipe Pose backend stub (Req 7.2)."""
    name = "mediapipe"
    version = "mediapipe-stub-0.0.0"
    import_module_name = "mediapipe"


class MoveNetPoseEngine(_DependencyGatedPoseEngine):
    """MoveNet (TensorFlow) backend stub (Req 7.2)."""
    name = "movenet"
    version = "movenet-stub-0.0.0"
    import_module_name = "tensorflow"


class BlazePosePoseEngine(_DependencyGatedPoseEngine):
    """BlazePose backend stub (Req 7.2)."""
    name = "blazepose"
    version = "blazepose-stub-0.0.0"
    import_module_name = "mediapipe"


class OpenPosePoseEngine(_DependencyGatedPoseEngine):
    """OpenPose backend stub (Req 7.2)."""
    name = "openpose"
    version = "openpose-stub-0.0.0"
    import_module_name = "pyopenpose"


def build_pose_engine_registry() -> dict[str, PoseEngine]:
    """
    Instantiate every known `Pose_Engine` ONCE (singletons), keyed by `name`.

    Adding a new engine = implement `PoseEngine` and register it here; nothing
    else in the pipeline changes (Req 7.3, 31.2). Mirrors
    `VisionAdapter._build_registry`.
    """
    engines: list[PoseEngine] = [
        MediaPipePoseEngine(),
        MoveNetPoseEngine(),
        BlazePosePoseEngine(),
        OpenPosePoseEngine(),
    ]
    return {engine.name: engine for engine in engines}


#: Names of all engines known to the registry (for validation / diagnostics).
POSE_ENGINE_NAMES: tuple[str, ...] = (
    "mediapipe",
    "movenet",
    "blazepose",
    "openpose",
)
