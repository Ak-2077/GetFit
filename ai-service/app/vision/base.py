"""
Vision Backend — Common Interface & Result Schema
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every vision model implements VisionBackend and returns a VisionResult.
This is the contract that keeps the rest of the system model-agnostic.
"""

from abc import ABC, abstractmethod
from pydantic import BaseModel, Field
from typing import Optional


class DetectedObject(BaseModel):
    """A single detected food object with count."""
    name: str
    count: int = 1


class VisionResult(BaseModel):
    """
    Normalized output from ANY vision backend.
    The backend/reasoning engine only ever sees this shape.
    """
    success: bool = False
    # Core description (always present on success)
    raw_description: str = ""
    objects: list[DetectedObject] = Field(default_factory=list)
    # Rich structured fields (best-effort; empty if model can't provide)
    detected_foods: list[str] = Field(default_factory=list)
    visible_ingredients: list[str] = Field(default_factory=list)
    cooking_style: str = ""
    visual_cues: list[str] = Field(default_factory=list)
    meal_type: str = ""           # breakfast | lunch | dinner | snack
    confidence: float = 0.0       # 0..1 model's self-reported confidence
    ocr_text: str = ""            # any text read from packaging/labels
    # Provenance & telemetry
    model_used: str = ""          # which backend actually produced this
    is_fallback: bool = False     # True if primary failed and fallback ran
    processing_time_ms: int = 0
    error: Optional[str] = None


class VisionBackend(ABC):
    """Abstract base every vision model adapter must implement."""

    #: Stable identifier, e.g. "qwen2.5-vl", "moondream", "gemini"
    name: str = "base"

    @abstractmethod
    async def is_available(self) -> bool:
        """Return True if this backend can currently serve requests."""
        raise NotImplementedError

    @abstractmethod
    async def analyze(self, image_base64: str, *, food_type: str = "homemade",
                      cooking_methods: Optional[list[str]] = None,
                      timeout: float = 60.0) -> VisionResult:
        """
        Analyze a food image and return a normalized VisionResult.
        Implementations must NOT raise on model errors — return a
        VisionResult(success=False, error=...) instead so the adapter
        can decide whether to fall back.
        """
        raise NotImplementedError
