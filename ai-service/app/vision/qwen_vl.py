"""
Qwen2.5-VL Vision Backend (PRIMARY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Runs Qwen2.5-VL via Ollama. Produces rich structured food analysis:
detected foods, counts, ingredients, cooking style, meal type, OCR.
"""

import time
import json
import logging
import httpx
from typing import Optional

from ..core.config import settings
from .base import VisionBackend, VisionResult, DetectedObject
from .parsing import is_garbage, extract_objects, extract_structured, strip_json_blocks

logger = logging.getLogger("getfit-ai")


QWEN_PROMPT = (
    "You are a food vision expert. Analyze the food image and respond with a short "
    "natural description followed by a single JSON block.\n\n"
    "STRICT RULES:\n"
    "1. In 'objects', list ONLY physical raw food items you literally see "
    "(e.g. 'egg', 'chicken', 'rice'). NEVER put prepared dish names like "
    "'omelet', 'poached egg', or 'scrambled egg' in 'objects'.\n"
    "2. Count whole physical items. If one item is cut into halves or slices, "
    "count it as ONE item, not multiple (e.g. an egg cut in half = count 1).\n"
    "3. 'cooking_style' must reflect ONLY what is visually evident. If you see a "
    "shell, peel, or smooth whole/halved egg with visible yolk, that is 'boiled', "
    "not fried/poached/omelet. Do not guess a cooking style with no evidence.\n"
    "4. 'detected_foods' may name the most likely prepared dish ONLY if there is "
    "clear visual evidence (folding, browning, scrambled curds, sauce, etc.).\n\n"
    "The JSON MUST follow this exact schema:\n"
    "```json\n"
    "{\n"
    '  "detected_foods": ["..."],\n'
    '  "objects": [{"name": "egg", "count": 3}],\n'
    '  "visible_ingredients": ["..."],\n'
    '  "cooking_style": "boiled|fried|grilled|steamed|raw|baked|roasted|unknown",\n'
    '  "visual_cues": ["color/texture/shape notes"],\n'
    '  "meal_type": "breakfast|lunch|dinner|snack",\n'
    '  "confidence": 0.0,\n'
    '  "ocr_text": "any text visible on packaging or labels"\n'
    "}\n"
    "```\n"
    "Count individual items precisely. If unsure of a field, use an empty value."
)


class QwenVLBackend(VisionBackend):
    name = "qwen2.5-vl"

    def __init__(self):
        self.model = settings.OLLAMA_QWEN_VL_MODEL
        self.base_url = settings.OLLAMA_BASE_URL
        self._available_cache: Optional[bool] = None
        self._available_checked_at: float = 0.0

    async def is_available(self) -> bool:
        # Cache availability for 60s to avoid hammering /api/tags
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
            logger.warning(f"[QwenVL] availability check failed: {e}")
        self._available_cache = False
        self._available_checked_at = now
        return False

    async def analyze(self, image_base64: str, *, food_type: str = "homemade",
                      cooking_methods: Optional[list[str]] = None,
                      timeout: float = 60.0) -> VisionResult:
        start = time.time()
        cooking_methods = cooking_methods or []

        context = ""
        if food_type:
            context += f"This is {food_type} food. "
        if cooking_methods:
            context += f"Cooking methods used: {', '.join(cooking_methods)}. "

        payload = {
            "model": self.model,
            "messages": [{
                "role": "user",
                "content": (context + QWEN_PROMPT).strip(),
                "images": [image_base64],
            }],
            "stream": False,
            "keep_alive": settings.OLLAMA_KEEP_ALIVE,
            "options": {"temperature": 0.1, "num_predict": 600},
        }

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(f"{self.base_url}/api/chat", json=payload)

            if resp.status_code != 200:
                return VisionResult(
                    success=False, model_used=self.name,
                    error=f"Qwen2.5-VL HTTP {resp.status_code}",
                    processing_time_ms=int((time.time() - start) * 1000),
                )

            raw_text = resp.json().get("message", {}).get("content", "").strip()
            logger.info(f"[QwenVL] ({time.time()-start:.1f}s): {raw_text[:160]}")

            if is_garbage(raw_text):
                return VisionResult(
                    success=False, model_used=self.name,
                    error="Qwen2.5-VL returned unusable output",
                    processing_time_ms=int((time.time() - start) * 1000),
                )

            structured = extract_structured(raw_text)
            objects = extract_objects(raw_text)

            # Build a clean human description. If the model returned ONLY a JSON
            # block (no prose), synthesize a description from structured fields
            # so the reasoning engine never receives raw JSON.
            description = strip_json_blocks(raw_text)
            if not description or description.strip().startswith("{") or "```" in description:
                foods = structured.get("detected_foods") or [o.name for o in objects]
                style = structured.get("cooking_style", "")
                parts = []
                if foods:
                    parts.append(", ".join(str(f) for f in foods))
                if style and style != "unknown":
                    parts.append(f"({style})")
                cues = structured.get("visual_cues") or []
                if cues:
                    parts.append("- " + "; ".join(str(c) for c in cues))
                description = " ".join(parts).strip() or "food detected"
            if not objects and structured.get("objects"):
                for o in structured["objects"]:
                    if isinstance(o, dict) and o.get("name"):
                        objects.append(DetectedObject(
                            name=str(o["name"]).strip(),
                            count=int(o.get("count", 1)) if str(o.get("count", 1)).isdigit() else 1,
                        ))

            conf = structured.get("confidence", 0.0)
            try:
                conf = float(conf)
                if conf > 1:
                    conf = conf / 100.0
            except (TypeError, ValueError):
                conf = 0.0

            return VisionResult(
                success=True,
                raw_description=description,
                objects=objects,
                detected_foods=[str(x) for x in structured.get("detected_foods", []) if x],
                visible_ingredients=[str(x) for x in structured.get("visible_ingredients", []) if x],
                cooking_style=str(structured.get("cooking_style", "") or ""),
                visual_cues=[str(x) for x in structured.get("visual_cues", []) if x],
                meal_type=str(structured.get("meal_type", "") or ""),
                confidence=conf,
                ocr_text=str(structured.get("ocr_text", "") or ""),
                model_used=self.name,
                processing_time_ms=int((time.time() - start) * 1000),
            )

        except httpx.TimeoutException:
            return VisionResult(
                success=False, model_used=self.name,
                error="Qwen2.5-VL timed out",
                processing_time_ms=int((time.time() - start) * 1000),
            )
        except Exception as e:
            logger.warning(f"[QwenVL] error: {e}")
            return VisionResult(
                success=False, model_used=self.name, error=str(e),
                processing_time_ms=int((time.time() - start) * 1000),
            )
