"""
Analysis Pipeline — Version 2 (Production Extensions)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This package contains **Version 2 (Production Extensions)** of the exercise
analysis feature. It is **strictly additive** to Version 1 (`app/analysis/`):
no V1 module, signature, data contract, or adapter is modified by V2 code
(Req 52.1). Every V2 component lives entirely in this new package and builds
on the *unchanged* V1 interfaces.

V2 conventions (inherited from V1, see design.md "V2 Design Principles"):
  • ABC + registry + config-driven selection — the `app/vision/` template is
    reused for every new replaceable backend.
  • `PipelineStage` ABC — every component that participates in the analysis
    flow implements the existing `PipelineStage[TIn, TOut]` interface and
    returns `StageResult`/`StructuredError` rather than raising.
  • Privacy by construction — no V2 component persists video, frames, or pose
    images; caches are volatile-only; only hashes/aggregates are stored.
  • Additive-only — V2 lives in new packages and new optional fields, so all
    existing V1 tests continue to pass unchanged.

To guarantee V2 builds on the unchanged V1 contracts, the core V1 interfaces
are re-exported here (imported, NOT redefined) from `app.analysis.base`
(Req 52.6). V2 modules import these from `app.analysis_v2` and never define
their own copies.

Subpackages:
  • gates/        — pre-pipeline gates (duplicate detection, abuse protection)
  • resilience/   — retry manager, GPU recovery, worker health monitoring
  • caching/      — volatile frame and pose caches
  • telemetry/    — cost tracking, admin analytics
  • registries/   — model registry, exercise-version registry
  • storage/      — secure temporary storage service
  • feedback_ext/ — human review mode and explainable-AI feedback extensions
  • multicamera/  — multi-camera-ready interface (declared only)
"""

# Re-export (import, do NOT modify) the V1 core contracts so V2 modules build
# on the unchanged Version 1 interfaces (Req 52.1, 52.6).
from app.analysis.base import PipelineStage, StageResult, StructuredError

__all__ = [
    "PipelineStage",
    "StageResult",
    "StructuredError",
]
