"""
Food Vision Recognition Router — v7 (Vision Adapter Architecture)

The router NO LONGER talks to any model directly. It calls the Vision Adapter,
which selects Qwen2.5-VL (primary) and automatically falls back to Moondream.

API contract is UNCHANGED:
  POST /food-vision/recognize       → VisionResponse
  POST /food-vision/analyze-quality → ImageQuality
  POST /food-vision/feedback
  GET  /food-vision/health

The reasoning engine / ontology / nutrition pipeline in the backend still
receive raw_description + objects exactly as before.
"""

import hashlib
import json
import time
import logging
import httpx
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from app.core.config import settings  # type: ignore
from app.vision import vision_adapter

logger = logging.getLogger("getfit-ai")

try:
    import redis.asyncio as aioredis
    _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
except Exception:
    _redis = None

router = APIRouter(prefix="/food-vision", tags=["food-vision"])


# ═══ MODELS (UNCHANGED CONTRACT) ═══
class FoodRecognitionRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"
    food_type: str = "homemade"
    cooking_methods: list[str] = []


class ImageQuality(BaseModel):
    acceptable: bool = True
    brightness: str = "ok"
    blur: str = "ok"
    suggestion: str = ""


class VisionResponse(BaseModel):
    """Same shape the backend already consumes — plus optional rich fields."""
    success: bool
    raw_description: str = ""
    objects: list = []
    processing_time_ms: int = 0
    cached: bool = False
    error: Optional[str] = None
    # New optional fields (additive — backward compatible)
    detected_foods: list = []
    visible_ingredients: list = []
    cooking_style: str = ""
    meal_type: str = ""
    visual_cues: list = []
    confidence: float = 0.0
    ocr_text: str = ""
    model_used: str = ""
    is_fallback: bool = False


# ═══ CACHE ═══
async def _get_cache(image_hash: str) -> Optional[dict]:
    if not _redis:
        return None
    try:
        cached = await _redis.get(f"fv7:{image_hash}")
        if cached:
            return json.loads(cached)
    except Exception:
        pass
    return None


async def _set_cache(image_hash: str, data: dict, ttl: int = 3600):
    if not _redis:
        return
    try:
        await _redis.setex(f"fv7:{image_hash}", ttl, json.dumps(data))
    except Exception:
        pass


# ═══ MAIN ENDPOINT ═══
@router.post("/recognize", response_model=VisionResponse)
async def recognize_food(request: FoodRecognitionRequest):
    """
    Stage 1 of the pipeline: Visual understanding via the Vision Adapter.
    Qwen2.5-VL primary → Moondream fallback. Backend does the reasoning.
    """
    start = time.time()
    try:
        img_data = request.image_base64
        if "base64," in img_data:
            img_data = img_data.split("base64,")[1]

        # ── Cache (SHA-256 of full image for collision safety) ──
        img_hash = hashlib.sha256(img_data.encode()).hexdigest()
        cached = await _get_cache(img_hash)
        if cached:
            return VisionResponse(
                success=True,
                raw_description=cached.get("raw_description", ""),
                objects=cached.get("objects", []),
                detected_foods=cached.get("detected_foods", []),
                visible_ingredients=cached.get("visible_ingredients", []),
                cooking_style=cached.get("cooking_style", ""),
                meal_type=cached.get("meal_type", ""),
                visual_cues=cached.get("visual_cues", []),
                confidence=cached.get("confidence", 0.0),
                ocr_text=cached.get("ocr_text", ""),
                model_used=cached.get("model_used", ""),
                cached=True,
                processing_time_ms=int((time.time() - start) * 1000),
            )

        # ── Vision Adapter (primary → fallback handled internally) ──
        result = await vision_adapter.analyze(
            img_data,
            food_type=request.food_type,
            cooking_methods=request.cooking_methods,
        )

        if not result.success:
            return VisionResponse(
                success=False,
                error=result.error or "Vision analysis failed",
                model_used=result.model_used,
                is_fallback=result.is_fallback,
                processing_time_ms=int((time.time() - start) * 1000),
            )

        objects = [o.model_dump() for o in result.objects]

        # ── Cache the normalized result ──
        await _set_cache(img_hash, {
            "raw_description": result.raw_description,
            "objects": objects,
            "detected_foods": result.detected_foods,
            "visible_ingredients": result.visible_ingredients,
            "cooking_style": result.cooking_style,
            "meal_type": result.meal_type,
            "visual_cues": result.visual_cues,
            "confidence": result.confidence,
            "ocr_text": result.ocr_text,
            "model_used": result.model_used,
        })

        elapsed = int((time.time() - start) * 1000)
        logger.info(f"[FoodVision] {result.model_used} parsed {len(objects)} objects in {elapsed}ms (fallback={result.is_fallback})")

        return VisionResponse(
            success=True,
            raw_description=result.raw_description,
            objects=objects,
            detected_foods=result.detected_foods,
            visible_ingredients=result.visible_ingredients,
            cooking_style=result.cooking_style,
            meal_type=result.meal_type,
            visual_cues=result.visual_cues,
            confidence=result.confidence,
            ocr_text=result.ocr_text,
            model_used=result.model_used,
            is_fallback=result.is_fallback,
            processing_time_ms=elapsed,
        )

    except Exception as e:
        logger.error(f"[FoodVision] Error: {e}", exc_info=True)
        return VisionResponse(
            success=False,
            error=str(e),
            processing_time_ms=int((time.time() - start) * 1000),
        )


# ═══ QUALITY CHECK (still a quick direct call — not core food analysis) ═══
@router.post("/analyze-quality")
async def analyze_image_quality(request: FoodRecognitionRequest):
    """Quick image quality check using the fast fallback model."""
    try:
        img_data = request.image_base64
        if "base64," in img_data:
            img_data = img_data.split("base64,")[1]

        payload = {
            "model": settings.OLLAMA_VISION_FAST_MODEL,
            "messages": [{"role": "user", "content": "Is this food photo clear? Answer: CLEAR, DARK, BLURRY, or NOFOOD", "images": [img_data]}],
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 10},
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{settings.OLLAMA_BASE_URL}/api/chat", json=payload)

        if resp.status_code != 200:
            return ImageQuality(acceptable=True)

        answer = resp.json().get("message", {}).get("content", "").strip().upper()
        if "DARK" in answer:
            return ImageQuality(acceptable=False, brightness="dark", suggestion="Improve lighting")
        elif "BLUR" in answer:
            return ImageQuality(acceptable=False, blur="blurry", suggestion="Hold camera steady")
        elif "NO" in answer and "FOOD" in answer:
            return ImageQuality(acceptable=False, suggestion="No food detected")
        return ImageQuality(acceptable=True)
    except Exception:
        return ImageQuality(acceptable=True)


# ═══ FEEDBACK ═══
@router.post("/feedback")
async def submit_feedback(data: dict):
    """Accept vision feedback (stored by backend in MongoDB)."""
    logger.info(f"[FoodVision] Feedback received: {data}")
    return {"status": "ok"}


# ═══ HEALTH ═══
@router.get("/health")
async def vision_health():
    """Report Vision Adapter health (all backends)."""
    adapter_health = await vision_adapter.health()
    return {
        "pipeline_version": "v7-adapter",
        "vision_adapter": adapter_health,
        "redis_connected": _redis is not None,
    }
