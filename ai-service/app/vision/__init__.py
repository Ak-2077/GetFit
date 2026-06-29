"""
Vision Adapter Package
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
A modular vision layer that exposes ONE common interface for all vision models.

Supported backends:
  • Qwen2.5-VL  (primary, food analysis)
  • Moondream   (fallback)
  • Gemini      (future)
  • Florence-2  (future)

Swapping or adding a model requires changing ONLY this package — never the
frontend, backend API, database schema, or reasoning engine.
"""

from .adapter import VisionAdapter, vision_adapter
from .base import VisionResult, VisionBackend

__all__ = ["VisionAdapter", "vision_adapter", "VisionResult", "VisionBackend"]
