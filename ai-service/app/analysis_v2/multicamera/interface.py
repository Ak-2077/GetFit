"""
Stage 49 · Multi_Camera_Interface (Req 50) — declaration only
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A **strictly additive**, *declared-but-unimplemented* seam (design.md
"Stage 49", "V2 Data Models", and "V2 Future Extensibility") that makes the
single-camera architecture multi-camera-ready without shipping any multi-camera
behavior in this version:

  • Req 50.1 — the interface accepts camera-angle inputs each labeled with
    exactly one value from {Front, Side, Rear} together with a single
    multi-angle fusion input. This shape is carried by the existing
    `MultiCameraInput` contract (`app/analysis_v2/models_v2.py`): an
    `angles: dict[CameraAngle, VideoRef]` map plus an optional `fusion_input`.
  • Req 50.2 — the interface is *declared only*; there is NO implemented
    multi-camera processing behavior in this version. `fuse` performs no angle
    fusion, reads no frames, and produces no `AnalysisResult`.
  • Req 50.3 — a future multi-camera implementation can be added by subclassing
    and overriding `fuse` *without modifying the interface signature of any
    existing `PipelineStage`* (no V1 stage is touched by this module).
  • Req 50.4 — the Analysis_Pipeline routes NO input through this interface in
    this version; it is never wired into the pipeline and the existing
    single-camera path is used unchanged. Nothing here imports or mutates any
    pipeline wiring.
  • Req 50.5 — IF the interface is invoked in this version, it returns a
    `Structured_Error` indicating multi-camera processing is not implemented
    (`code="MULTI_CAMERA_NOT_IMPLEMENTED"`), WITHOUT modifying the existing
    single-camera state (Property 59). It touches no single-camera object, no
    cache, and no pipeline stage — it simply constructs and returns the error.

Design notes
------------
`MultiCameraInterface` is defined as an `ABC` to mark it as an extension seam,
mirroring the ABC + registry convention used across V1/V2 (`app/vision/base.py`,
`app/analysis/base.py`). Unlike the abstract declaration mirrored in
`models_v2.py`, this module provides a **concrete default implementation** of
`fuse` on the ABC so the seam can actually be *invoked* (as required by
Property 59 / task 25.6) — the default implementation performs no fusion and
immediately returns the not-implemented `StructuredError`. Because the ABC
declares no unimplemented `@abstractmethod`, it is directly instantiable; the
provided `DeclaredMultiCameraInterface` is a named, explicitly-inert concrete
subclass for callers/tests that prefer a concrete type.

Following the V2 pipeline contract (`base.py`), invocation NEVER raises on this
"not implemented" condition — it returns
`StageResult(success=False, error=StructuredError(...))` so the orchestrator can
surface the sanitized error. The carried `StructuredError.code` is the stable
`MULTI_CAMERA_NOT_IMPLEMENTED` constant.

Privacy by construction (Req 1, preserved by Req 52.5): this module persists
nothing and reads no video/frames/pose — it only ever returns an error.
"""

from __future__ import annotations

from abc import ABC

# Build on the UNCHANGED V1 contracts, re-exported from the V2 package
# (Req 52.1, 52.6) — imported, never redefined.
from app.analysis_v2 import StageResult, StructuredError

# Reuse the declaration-only V2 input contracts (Req 50.1) — imported, not
# redefined, so there is a single source of truth for the multi-camera shape.
from app.analysis_v2.models_v2 import CameraAngle, MultiCameraInput

__all__ = [
    "STAGE_NAME",
    "MULTI_CAMERA_NOT_IMPLEMENTED",
    "MultiCameraInterface",
    "DeclaredMultiCameraInterface",
    "CameraAngle",
    "MultiCameraInput",
]

#: Stable Pipeline_Stage name identifying this seam in any emitted
#: `StructuredError` (never hardcoded at call sites).
STAGE_NAME: str = "multi_camera_interface"

#: Stable error code returned whenever the interface is invoked in this version
#: (see design.md Error Handling table, Req 50.5).
MULTI_CAMERA_NOT_IMPLEMENTED: str = "MULTI_CAMERA_NOT_IMPLEMENTED"


def not_implemented_error() -> StructuredError:
    """
    Build the sanitized `StructuredError` returned on any invocation of the
    multi-camera seam in this version (Req 50.5).

    Names this seam as the originating Pipeline_Stage and carries the stable
    `MULTI_CAMERA_NOT_IMPLEMENTED` code. Constructing this error reads and
    mutates no single-camera state.
    """
    return StructuredError(
        code=MULTI_CAMERA_NOT_IMPLEMENTED,
        message=(
            "Multi-camera processing is not implemented in this version; "
            "the single-camera path is unchanged."
        ),
        stage=STAGE_NAME,
    )


class MultiCameraInterface(ABC):
    """
    Declared-but-unimplemented multi-camera fusion seam (Req 50.2, 50.3, 50.5).

    Accepts Front/Side/Rear angle inputs and a single fusion input via
    `MultiCameraInput` (Req 50.1). The default `fuse` implementation performs no
    multi-camera behavior at all — any invocation returns a
    `StructuredError(code="MULTI_CAMERA_NOT_IMPLEMENTED")` inside a failed
    `StageResult`, leaving the single-camera state untouched (Property 59).

    A future version implements angle fusion simply by subclassing and
    overriding `fuse`; the signature is fixed here so no existing
    `PipelineStage` interface changes (Req 50.3).
    """

    #: Stable identifier for this seam (Req 50.5 error attribution).
    name: str = STAGE_NAME

    async def fuse(self, inputs: MultiCameraInput) -> StageResult:
        """
        Declaration only — no multi-camera fusion is performed (Req 50.2).

        Regardless of the supplied `inputs` (angle references and/or a fusion
        input), this returns a failed `StageResult` carrying the not-implemented
        `StructuredError` (Req 50.5). It deliberately ignores `inputs`, reads no
        frames, and mutates no single-camera state (Property 59).
        """
        # No fusion, no analysis, no state mutation — just surface the error.
        return StageResult(success=False, error=not_implemented_error())


class DeclaredMultiCameraInterface(MultiCameraInterface):
    """
    Concrete, explicitly-inert `MultiCameraInterface` (Req 50.2).

    Adds no behavior over the base seam — it exists so callers and tests can
    instantiate a clearly-named concrete type whose only action is to return the
    `MULTI_CAMERA_NOT_IMPLEMENTED` `StructuredError`. This is the interface as
    shipped in V2: present, invokable, and inert.
    """
