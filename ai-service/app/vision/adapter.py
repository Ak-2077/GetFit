"""
Vision Adapter — Single entry point for all food vision.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The rest of the system calls ONLY vision_adapter.analyze(). The adapter:
  • Picks the configured primary backend (Qwen2.5-VL)
  • Automatically falls back to Moondream on unavailability/failure/timeout
  • Keeps backends as singletons (models stay warm in Ollama via keep_alive)
  • Supports concurrent requests (httpx async, no shared mutable state)

Adding a new model = register it in _build_registry(). Nothing else changes.
"""

import logging
from typing import Optional

from ..core.config import settings
from .base import VisionBackend, VisionResult
from .qwen_vl import QwenVLBackend
from .moondream import MoondreamBackend

logger = logging.getLogger("getfit-ai")


class VisionAdapter:
    def __init__(self):
        self._registry: dict[str, VisionBackend] = self._build_registry()
        self.primary_name = settings.VISION_PRIMARY
        self.fallback_name = settings.VISION_FALLBACK

    def _build_registry(self) -> dict[str, VisionBackend]:
        """
        Instantiate all known backends ONCE (singletons).
        To add Gemini/Florence-2 later: implement VisionBackend and add here.
        """
        backends: dict[str, VisionBackend] = {}
        qwen = QwenVLBackend()
        moon = MoondreamBackend()
        backends[qwen.name] = qwen
        backends[moon.name] = moon
        # Future:
        # gemini = GeminiBackend(); backends[gemini.name] = gemini
        # florence = FlorenceBackend(); backends[florence.name] = florence
        return backends

    def _get(self, name: str) -> Optional[VisionBackend]:
        return self._registry.get(name)

    async def analyze(self, image_base64: str, *, food_type: str = "homemade",
                      cooking_methods: Optional[list[str]] = None) -> VisionResult:
        """
        Analyze a food image with automatic primary → fallback handling.
        Never raises — always returns a VisionResult.
        """
        cooking_methods = cooking_methods or []
        primary = self._get(self.primary_name)
        fallback = self._get(self.fallback_name)

        # ── Try primary ──
        if primary is not None:
            try:
                if await primary.is_available():
                    result = await primary.analyze(
                        image_base64, food_type=food_type,
                        cooking_methods=cooking_methods,
                        timeout=settings.VISION_TIMEOUT,
                    )
                    if result.success:
                        return result
                    logger.warning(
                        f"[VisionAdapter] primary '{self.primary_name}' failed: {result.error} — falling back"
                    )
                else:
                    logger.warning(
                        f"[VisionAdapter] primary '{self.primary_name}' unavailable — falling back"
                    )
            except Exception as e:
                logger.warning(f"[VisionAdapter] primary '{self.primary_name}' raised: {e} — falling back")

        # ── Fallback ──
        if fallback is not None and fallback is not primary:
            try:
                if await fallback.is_available():
                    result = await fallback.analyze(
                        image_base64, food_type=food_type,
                        cooking_methods=cooking_methods,
                        timeout=settings.VISION_FALLBACK_TIMEOUT,
                    )
                    result.is_fallback = True
                    if result.success:
                        return result
                    logger.warning(f"[VisionAdapter] fallback '{self.fallback_name}' also failed: {result.error}")
                    return result
                else:
                    logger.error(f"[VisionAdapter] fallback '{self.fallback_name}' unavailable")
            except Exception as e:
                logger.error(f"[VisionAdapter] fallback '{self.fallback_name}' raised: {e}")

        # ── Both unavailable ──
        return VisionResult(
            success=False,
            error="No vision backend available. Ensure Ollama is running with a vision model pulled.",
            is_fallback=True,
        )

    async def health(self) -> dict:
        """Report availability of every registered backend."""
        out = {"primary": self.primary_name, "fallback": self.fallback_name, "backends": {}}
        for name, backend in self._registry.items():
            try:
                out["backends"][name] = await backend.is_available()
            except Exception:
                out["backends"][name] = False
        return out

    async def warmup(self):
        """Preload the primary (and fallback) into VRAM via a tiny request."""
        # Availability checks alone trigger Ollama to keep the model resolvable;
        # the real warm happens on first analyze. Keep this light & non-fatal.
        for name in (self.primary_name, self.fallback_name):
            backend = self._get(name)
            if backend:
                try:
                    await backend.is_available()
                except Exception:
                    pass


# Singleton used across the app
vision_adapter = VisionAdapter()
