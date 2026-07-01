"""
Analysis Pipeline Package
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A modular exercise-analysis pipeline built from replaceable stages and
adapters, mirroring the `app/vision/` conventions (ABC + concrete
implementations + registry + config-driven selection).

Subpackages:
  • stages/   — concrete PipelineStage implementations
  • adapters/ — replaceable engine/transport/backend adapters + registries
  • plugins/  — per-exercise plugins (Exercise_Plugin_Registry)

Adding or swapping a stage/adapter requires changing ONLY this package —
never the frontend, backend API, or persistence schema.
"""

from .base import PipelineStage, StageResult, StructuredError
from .errors import (
    SUPPORTED_ERROR_CODES,
    SanitizedError,
    is_supported_code,
    sanitize_error,
)

__all__ = [
    "PipelineStage",
    "StageResult",
    "StructuredError",
    "SUPPORTED_ERROR_CODES",
    "SanitizedError",
    "is_supported_code",
    "sanitize_error",
]
