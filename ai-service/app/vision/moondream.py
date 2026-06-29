"""
Moondream Vision Backend (FALLBACK)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Lightweight (~1.7GB) vision model. Used when Qwen2.5-VL is unavailable or
fails. Produces a description + object counts (no rich structured fields).
"""

import time
import logging
import httpx
from typing import Optional

from ..core.config import settings
from .base import VisionBackend, VisionResult
from .parsing import is_garbage, extract_objects, strip_json_blocks

logger = logging.getLogger("getfit-ai")


MOONDREAM_PROMPT = (
    "Describe the food in this image in detail. "
    "Include: what food items you see, how they are cooked (fried, boiled, grilled, etc.), "
    "their color, texture, and arrangement. If on a plate or in a bowl, mention that.\n\n"
    "After your description, provide a JSON block listing detected objects and counts:\n"
    "```json\n"
    '{"objects": [{"name": "egg", "count": 3}]}\n'
    "```"
)


class MoondreamBackend(VisionBackend):
    name = "moondream"

    def __init__(self):
        self.model = settings.OLLAMA_VISION_FAST_MODEL
        self.base_url = settings.OLLAMA_BASE_URL
        self._available_cache: Optional[bool] = None
        self._available_checked_at: float = 0.0

    async def is_available(self) -> bool:
        now = time.time()
        if self._available_cache is not None and (now - self._available_checked_at) < 60:
            return self._available_cache
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
            if resp.status_code == 200:
                models = [m["name"] for m in resp.json().get("models", [])]
                base_tag = self.model.split(":")[0]
                avail = any(base_tag in m for m in models)
                self._available_cache = avail
                self._available_checked_at = now
                return avail
        except Exception as e:
            logger.warning(f"[Moondream] availability check failed: {e}")
        self._available_cache = False
        self._available_checked_at = now
        return False

    async def analyze(self, image_base64: str, *, food_type: str = "homemade",
                      cooking_methods: Optional[list[str]] = None,
                      timeout: float = 30.0) -> VisionResult:
        start = time.time()
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": MOONDREAM_PROMPT, "images": [image_base64]}],
            "stream": False,
            "keep_alive": settings.OLLAMA_KEEP_ALIVE,
            "options": {"temperature": 0.1, "num_predict": 300},
        }

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(f"{self.base_url}/api/chat", json=payload)

            if resp.status_code != 200:
                return VisionResult(
                    success=False, model_used=self.name,
                    error=f"Moondream HTTP {resp.status_code}",
                    processing_time_ms=int((time.time() - start) * 1000),
                )

            raw_text = resp.json().get("message", {}).get("content", "").strip()
            logger.info(f"[Moondream] ({time.time()-start:.1f}s): {raw_text[:160]}")

            # One retry with a simpler prompt on garbage
            if is_garbage(raw_text):
                retry = {
                    "model": self.model,
                    "messages": [{"role": "user", "content": "What food is this? How many? How is it cooked?", "images": [image_base64]}],
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 150},
                }
                try:
                    async with httpx.AsyncClient(timeout=min(timeout, 30.0)) as client:
                        rr = await client.post(f"{self.base_url}/api/chat", json=retry)
                    if rr.status_code == 200:
                        rt = rr.json().get("message", {}).get("content", "").strip()
                        if not is_garbage(rt):
                            raw_text = rt
                except Exception:
                    pass

            if is_garbage(raw_text):
                return VisionResult(
                    success=False, model_used=self.name,
                    error="Moondream returned unusable output",
                    processing_time_ms=int((time.time() - start) * 1000),
                )

            objects = extract_objects(raw_text)
            return VisionResult(
                success=True,
                raw_description=strip_json_blocks(raw_text),
                objects=objects,
                model_used=self.name,
                processing_time_ms=int((time.time() - start) * 1000),
            )

        except httpx.TimeoutException:
            return VisionResult(
                success=False, model_used=self.name,
                error="Moondream timed out",
                processing_time_ms=int((time.time() - start) * 1000),
            )
        except Exception as e:
            logger.warning(f"[Moondream] error: {e}")
            return VisionResult(
                success=False, model_used=self.name, error=str(e),
                processing_time_ms=int((time.time() - start) * 1000),
            )
