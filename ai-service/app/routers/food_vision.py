"""
Food Vision Recognition Router — Production Grade
Multi-food detection, confidence scoring, image quality analysis,
Indian food normalization, Redis vision cache.
"""

import httpx
import hashlib
import json
import re
import time
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from ..core.config import settings

try:
    import redis.asyncio as aioredis
    _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
except Exception:
    _redis = None

router = APIRouter(prefix="/food-vision", tags=["food-vision"])

# ═══ VISION PROMPT — optimized for multi-food detection ═══
VISION_PROMPT = """List ALL food items visible in this image. For each item give:
- the food name (simple, specific)
- whether it appears raw, cooked, or packaged
- estimated portion (e.g. 1 bowl, 2 pieces, 1 cup)

Be thorough - identify every distinct food item on the plate/table.
Format each food on its own line like: food name | state | portion"""

# ═══ INDIAN FOOD NORMALIZATION MAP ═══
FOOD_NORMALIZATION = {
    # Indian staples
    "roti": "whole wheat flatbread",
    "chapati": "whole wheat flatbread",
    "naan": "naan bread",
    "paratha": "whole wheat paratha",
    "puri": "deep fried wheat bread",
    "dosa": "rice lentil crepe",
    "idli": "steamed rice cake",
    "uttapam": "thick rice pancake",
    "vada": "lentil fritter",
    # Rice dishes
    "biryani": "rice biryani",
    "pulao": "rice pilaf",
    "khichdi": "rice lentil porridge",
    "jeera rice": "cumin rice",
    # Curries & dals
    "dal": "lentil curry",
    "dal fry": "lentil curry fried",
    "dal tadka": "lentil curry tempered",
    "dal makhani": "black lentil curry",
    "rajma": "kidney bean curry",
    "chole": "chickpea curry",
    "chana masala": "chickpea curry",
    "kadhi": "yogurt curry",
    "sambar": "lentil vegetable stew",
    "rasam": "tamarind lentil soup",
    # Paneer
    "paneer butter masala": "cottage cheese curry",
    "paneer bhurji": "scrambled cottage cheese",
    "palak paneer": "spinach cottage cheese curry",
    "shahi paneer": "cottage cheese cream curry",
    "paneer tikka": "grilled cottage cheese",
    # Vegetables
    "sabzi": "vegetable curry",
    "aloo gobi": "potato cauliflower curry",
    "aloo matar": "potato peas curry",
    "bhindi": "okra stir fry",
    "baingan": "eggplant curry",
    "lauki": "bottle gourd curry",
    "palak": "spinach",
    "methi": "fenugreek leaves",
    # Snacks
    "samosa": "fried pastry with potato filling",
    "pakora": "vegetable fritter",
    "bhel puri": "puffed rice snack",
    "pav bhaji": "mashed vegetable curry with bread",
    "chaat": "tangy snack",
    "kachori": "fried stuffed bread",
    # Non-veg
    "butter chicken": "chicken butter curry",
    "chicken tikka": "grilled chicken",
    "tandoori chicken": "roasted spiced chicken",
    "fish curry": "fish curry",
    "egg curry": "egg curry",
    "keema": "minced meat curry",
    # Sweets
    "gulab jamun": "fried milk dough in syrup",
    "rasgulla": "cottage cheese ball in syrup",
    "jalebi": "deep fried sweet pretzel",
    "kheer": "rice pudding",
    "halwa": "semolina pudding",
    "ladoo": "sweet ball",
    # Drinks
    "lassi": "yogurt drink",
    "chaas": "buttermilk",
    "chai": "milk tea",
    # Gym foods
    "whey": "whey protein powder",
    "protein shake": "protein shake",
    "oats": "oatmeal",
}

# ═══ PORTION ESTIMATION MAP ═══
PORTION_DEFAULTS = {
    "rice": "1 bowl (150g)",
    "roti": "1 piece (40g)",
    "chapati": "1 piece (40g)",
    "naan": "1 piece (90g)",
    "dal": "1 bowl (150ml)",
    "curry": "1 bowl (150ml)",
    "salad": "1 bowl (100g)",
    "egg": "1 piece (50g)",
    "bread": "1 slice (30g)",
    "chicken": "1 piece (100g)",
    "fish": "1 piece (100g)",
    "fruit": "1 medium (150g)",
    "milk": "1 glass (200ml)",
    "juice": "1 glass (200ml)",
    "dosa": "1 piece (80g)",
    "idli": "2 pieces (60g)",
}


# ═══ MODELS ═══
class FoodRecognitionRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"
    food_type: str = "homemade"
    cooking_methods: list[str] = []


class FoodItem(BaseModel):
    name: str
    normalized_name: str = ""
    state: str = "general"
    portion: str = ""
    confidence: float = 0.8


class ImageQuality(BaseModel):
    acceptable: bool = True
    brightness: str = "ok"  # ok, dark, overexposed
    blur: str = "ok"  # ok, blurry
    suggestion: str = ""


class FoodRecognitionResponse(BaseModel):
    success: bool
    foods: list[FoodItem] = []
    image_quality: Optional[ImageQuality] = None
    raw_ai_response: str = ""
    processing_time_ms: int = 0
    cached: bool = False
    error: Optional[str] = None


# ═══ HELPERS ═══
def _normalize_food_name(name: str) -> str:
    """Normalize food name for better USDA/OFF matching."""
    lower = name.lower().strip()
    # Direct match in normalization map
    if lower in FOOD_NORMALIZATION:
        return FOOD_NORMALIZATION[lower]
    # Partial match
    for key, val in FOOD_NORMALIZATION.items():
        if key in lower:
            return val
    return name


def _estimate_portion(food_name: str, portion_text: str) -> str:
    """Estimate realistic portion if AI gives vague answer."""
    if portion_text and len(portion_text) > 2:
        return portion_text
    lower = food_name.lower()
    for key, default in PORTION_DEFAULTS.items():
        if key in lower:
            return default
    return "1 serving"


def _estimate_confidence(line: str, index: int) -> float:
    """Heuristic confidence based on line specificity and position."""
    base = 0.85 - (index * 0.05)  # First items more confident
    # Boost if line has specific details
    if any(w in line.lower() for w in ["piece", "bowl", "cup", "slice", "plate"]):
        base += 0.05
    # Lower if vague
    if any(w in line.lower() for w in ["something", "unknown", "maybe", "possibly"]):
        base -= 0.2
    return max(0.3, min(0.98, base))


def _parse_foods_from_text(text: str) -> list[FoodItem]:
    """Parse food items from plain text/pipe-separated response."""
    foods = []
    lines = text.strip().split("\n")

    for idx, line in enumerate(lines):
        line = line.strip()
        if not line or len(line) < 3:
            continue
        # Remove bullet points, numbers, dashes
        line = re.sub(r"^[\d\.\-\*\•\–\>]+\s*", "", line).strip()
        if not line or len(line) < 3:
            continue

        # Try pipe-separated format: name | state | portion
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 2:
            name = parts[0]
            state = parts[1].lower() if len(parts) > 1 else "general"
            portion = parts[2] if len(parts) > 2 else ""
        else:
            name = line
            state = "general"
            portion = ""

        # Detect state from text
        lower = name.lower()
        if state == "general":
            if any(w in lower for w in ["raw", "uncooked", "fresh", "unripe"]):
                state = "raw"
            elif any(w in lower for w in ["cooked", "boiled", "fried", "grilled", "roasted", "baked", "steamed", "sauteed", "curry", "stew"]):
                state = "cooked"
            elif any(w in lower for w in ["packaged", "branded", "sealed", "bottled"]):
                state = "packaged"

        # Clean food name
        name = re.sub(r"\b(raw|cooked|boiled|fried|grilled|roasted|baked|steamed|fresh)\b", "", name, flags=re.IGNORECASE).strip()
        name = re.sub(r"\s+", " ", name).strip(" ,.")

        if name and 2 <= len(name) <= 60:
            normalized = _normalize_food_name(name)
            portion = _estimate_portion(name, portion)
            confidence = _estimate_confidence(line, idx)

            foods.append(FoodItem(
                name=name,
                normalized_name=normalized,
                state=state,
                portion=portion,
                confidence=confidence,
            ))

    return foods


async def _get_cache(image_hash: str) -> Optional[dict]:
    """Check Redis vision cache."""
    if not _redis:
        return None
    try:
        cached = await _redis.get(f"fv:{image_hash}")
        if cached:
            return json.loads(cached)
    except Exception:
        pass
    return None


async def _set_cache(image_hash: str, data: dict, ttl: int = 3600):
    """Store in Redis vision cache (1h TTL)."""
    if not _redis:
        return
    try:
        await _redis.setex(f"fv:{image_hash}", ttl, json.dumps(data))
    except Exception:
        pass


# ═══ ENDPOINTS ═══
@router.post("/recognize", response_model=FoodRecognitionResponse)
async def recognize_food(request: FoodRecognitionRequest):
    """Multi-food recognition with confidence scoring and caching."""
    start = time.time()
    try:
        # Clean base64
        img_data = request.image_base64
        if "base64," in img_data:
            img_data = img_data.split("base64,")[1]

        # Check vision cache
        img_hash = hashlib.md5(img_data[:2000].encode()).hexdigest()
        cached = await _get_cache(img_hash)
        if cached:
            foods = [FoodItem(**f) for f in cached.get("foods", [])]
            return FoodRecognitionResponse(
                success=True,
                foods=foods,
                cached=True,
                processing_time_ms=int((time.time() - start) * 1000),
            )

        # Build context-aware prompt
        context_parts = []
        if request.food_type:
            context_parts.append(f"This is {request.food_type} food.")
        if request.cooking_methods:
            methods = ", ".join(request.cooking_methods)
            context_parts.append(f"Cooking methods used: {methods}.")
        context = " ".join(context_parts)
        full_prompt = f"{context}\n\n{VISION_PROMPT}" if context else VISION_PROMPT

        # Call Ollama vision model
        payload = {
            "model": settings.OLLAMA_VISION_MODEL,
            "prompt": full_prompt,
            "images": [img_data],
            "stream": False,
            "options": {
                "temperature": 0.2,
                "num_predict": 500,
            },
        }

        async with httpx.AsyncClient(timeout=50.0) as client:
            resp = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/generate",
                json=payload,
            )

        if resp.status_code != 200:
            return FoodRecognitionResponse(
                success=False,
                error=f"Vision model returned {resp.status_code}",
                processing_time_ms=int((time.time() - start) * 1000),
            )

        data = resp.json()
        raw_response = data.get("response", "").strip()

        if not raw_response:
            return FoodRecognitionResponse(
                success=False,
                error="Empty response from vision model",
                processing_time_ms=int((time.time() - start) * 1000),
            )

        # Parse foods
        foods = []

        # Try JSON first
        json_start = raw_response.find("{")
        json_end = raw_response.rfind("}") + 1
        if json_start != -1 and json_end > json_start:
            try:
                parsed = json.loads(raw_response[json_start:json_end])
                foods_raw = parsed.get("foods", [])
                for idx, f in enumerate(foods_raw):
                    if isinstance(f, dict) and f.get("name"):
                        name = f["name"].strip()
                        foods.append(FoodItem(
                            name=name,
                            normalized_name=_normalize_food_name(name),
                            state=f.get("state", "general").strip(),
                            portion=_estimate_portion(name, f.get("portion", "")),
                            confidence=f.get("confidence", _estimate_confidence(name, idx)),
                        ))
            except json.JSONDecodeError:
                pass

        # Fallback: parse text
        if not foods:
            foods = _parse_foods_from_text(raw_response)

        # Cache result
        if foods:
            await _set_cache(img_hash, {"foods": [f.model_dump() for f in foods]})

        elapsed = int((time.time() - start) * 1000)

        if foods:
            return FoodRecognitionResponse(
                success=True,
                foods=foods,
                raw_ai_response=raw_response[:300],
                processing_time_ms=elapsed,
            )
        else:
            return FoodRecognitionResponse(
                success=False,
                error="Could not identify any food items in the image",
                raw_ai_response=raw_response[:300],
                processing_time_ms=elapsed,
            )

    except httpx.TimeoutException:
        return FoodRecognitionResponse(
            success=False,
            error="Vision model timed out. Ensure moondream is pulled: ollama pull moondream",
            processing_time_ms=int((time.time() - start) * 1000),
        )
    except Exception as e:
        return FoodRecognitionResponse(
            success=False,
            error=str(e),
            processing_time_ms=int((time.time() - start) * 1000),
        )


@router.post("/analyze-quality")
async def analyze_image_quality(request: FoodRecognitionRequest):
    """Quick image quality check before full recognition."""
    try:
        img_data = request.image_base64
        if "base64," in img_data:
            img_data = img_data.split("base64,")[1]

        # Use vision model for quick quality assessment
        payload = {
            "model": settings.OLLAMA_VISION_MODEL,
            "prompt": "Is this image clear enough to identify food? Answer only: CLEAR, DARK, BLURRY, or NO_FOOD",
            "images": [img_data],
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 20},
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/generate",
                json=payload,
            )

        if resp.status_code != 200:
            return ImageQuality(acceptable=True)

        answer = resp.json().get("response", "").strip().upper()

        if "DARK" in answer:
            return ImageQuality(acceptable=False, brightness="dark", suggestion="Improve lighting for better results")
        elif "BLUR" in answer:
            return ImageQuality(acceptable=False, blur="blurry", suggestion="Hold camera steady and move closer")
        elif "NO_FOOD" in answer or "NO FOOD" in answer:
            return ImageQuality(acceptable=False, suggestion="No food detected in image. Try again.")
        else:
            return ImageQuality(acceptable=True)

    except Exception:
        return ImageQuality(acceptable=True)  # Don't block on quality check failure


@router.get("/health")
async def vision_health():
    """Check if vision model is available."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
        if resp.status_code == 200:
            models = [m["name"] for m in resp.json().get("models", [])]
            vision_available = any(settings.OLLAMA_VISION_MODEL in m for m in models)
            return {
                "vision_model": settings.OLLAMA_VISION_MODEL,
                "available": vision_available,
                "all_models": models,
                "redis_connected": _redis is not None,
            }
        return {"vision_model": settings.OLLAMA_VISION_MODEL, "available": False}
    except Exception as e:
        return {"vision_model": settings.OLLAMA_VISION_MODEL, "available": False, "error": str(e)}
