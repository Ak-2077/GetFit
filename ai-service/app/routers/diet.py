import json
import re
import hashlib
import logging
import time
from fastapi import APIRouter, HTTPException
from app.models.schemas import DietRequest, DietResponse
from app.core.llm import ollama

log = logging.getLogger(__name__)

router = APIRouter()

DIET_CACHE_TTL = 3600  # 1h — same params get cached plan
DIET_CACHE_PREFIX = "diet:"

DIET_SYSTEM = """/no_think
You are a sports nutritionist. Output ONLY valid JSON. No markdown, no extra text."""


MEAL_STRUCTURES = {
    3: [
        ("Breakfast", "8:00 AM", "breakfast foods: eggs, oats, toast, smoothie, fruits, cereal, paratha, idli, poha"),
        ("Lunch", "1:00 PM", "full meal: rice/roti, dal/curry, sabzi, salad, protein dish"),
        ("Dinner", "8:00 PM", "lighter full meal: soup, grilled protein, roti, salad, light curry"),
    ],
    4: [
        ("Breakfast", "8:00 AM", "breakfast foods: eggs, oats, toast, smoothie, fruits, cereal, paratha, idli, poha"),
        ("Lunch", "1:00 PM", "full meal: rice/roti, dal/curry, sabzi, salad, protein dish"),
        ("Snacks", "4:30 PM", "light snacks: fruits, nuts, yogurt, protein bar, chaat, sprouts, tea with biscuits"),
        ("Dinner", "8:00 PM", "lighter full meal: soup, grilled protein, roti, salad, light curry"),
    ],
    5: [
        ("Breakfast", "8:00 AM", "breakfast foods: eggs, oats, toast, smoothie, fruits, cereal, paratha, idli, poha"),
        ("Mid-Morning Snack", "11:00 AM", "light snack: fruit, nuts, yogurt, protein shake"),
        ("Lunch", "1:00 PM", "full meal: rice/roti, dal/curry, sabzi, salad, protein dish"),
        ("Evening Snack", "4:30 PM", "light snacks: fruits, nuts, chaat, sprouts, tea with biscuits"),
        ("Dinner", "8:00 PM", "lighter full meal: soup, grilled protein, roti, salad, light curry"),
    ],
    6: [
        ("Breakfast", "7:30 AM", "breakfast foods: eggs, oats, toast, smoothie, fruits, paratha, idli"),
        ("Mid-Morning Snack", "10:00 AM", "light snack: fruit, nuts, yogurt, shake"),
        ("Lunch", "12:30 PM", "full meal: rice/roti, dal/curry, sabzi, protein dish"),
        ("Afternoon Snack", "3:30 PM", "light snack: protein bar, sprouts, chaat"),
        ("Dinner", "7:00 PM", "lighter meal: soup, grilled protein, roti, salad"),
        ("Bedtime Snack", "9:30 PM", "very light: warm milk, nuts, casein shake"),
    ],
}


def _build_diet_prompt(request, cal, allergies, conditions):
    per_meal = round(cal / request.meals_per_day)
    n = request.meals_per_day
    # Get meal structure or fall back to evenly named meals
    structure = MEAL_STRUCTURES.get(n, MEAL_STRUCTURES[4] if n == 4 else MEAL_STRUCTURES.get(min(n, 6), MEAL_STRUCTURES[4]))
    if n not in MEAL_STRUCTURES:
        structure = structure[:n] if len(structure) >= n else structure

    meal_instructions = "\n".join(
        f"  - {name} at {time}: use {foods}" for name, time, foods in structure
    )
    meal_json_example = ",".join(
        f'{{"name":"{name}","time":"{time}","items":["..."],"macros":{{"protein":0,"carbs":0,"fat":0}},"total":{per_meal},"prepTime":"10 min"}}'
        for name, time, _ in structure
    )

    return f"""/no_think
STRICT RULES:
1. Total calories MUST be between {int(cal * 0.9)} and {int(cal * 1.1)} kcal. Target: {cal} kcal.
2. Each meal should be ~{per_meal} kcal. You have {n} meals.
3. Cuisine: {request.cuisine}. Diet: {request.diet_preference}. STRICTLY follow this.
4. Cooking: {request.cooking_time}. Budget: {request.budget}.
5. Avoid: {allergies}. Health: {conditions}.
6. Profile: {request.weight or '?'}kg, {request.height or '?'}cm, age {request.age or '?'}, {request.gender or '?'}, {request.activity_level or 'moderate'}.
{f'7. Notes: {request.additional_notes}' if request.additional_notes else ''}

MEAL STRUCTURE (use EXACTLY these meal names, times, and appropriate food types):
{meal_instructions}

IMPORTANT: Each meal must have food items appropriate for that meal type.
Breakfast = breakfast foods. Lunch = proper lunch. Snacks = light items. Dinner = dinner foods.
Do NOT put lunch/dinner style heavy meals for breakfast or snacks.

Output this JSON:
{{"title":"...","description":"...","totalCalories":{cal},"mealsCount":{n},"macros":{{"protein":0,"carbs":0,"fat":0}},"meals":[{meal_json_example}],"tips":["tip1","tip2"],"waterIntake":"2.5-3L"}}

CRITICAL: The sum of all meal totals MUST equal ~{cal}. Do NOT output less than {int(cal * 0.85)} total."""


def _cache_key(request: DietRequest, cal: int) -> str:
    """Deterministic cache key from diet params."""
    sig = f"{request.goal}:{cal}:{request.meals_per_day}:{request.cuisine}:{request.diet_preference}:{request.cooking_time}:{request.budget}:{','.join(sorted(request.allergies))}:{','.join(sorted(request.health_conditions))}"
    h = hashlib.sha256(sig.encode()).hexdigest()[:16]
    return f"{DIET_CACHE_PREFIX}{h}"


async def _diet_cache_get(key: str):
    """Try to get cached diet plan from Redis."""
    try:
        from app.core.cache import get_redis
        r = await get_redis()
        raw = await r.get(key)
        if raw:
            return json.loads(raw)
    except Exception:
        pass
    return None


async def _diet_cache_set(key: str, plan: dict, total: int):
    """Store diet plan in Redis cache."""
    try:
        from app.core.cache import get_redis
        r = await get_redis()
        data = json.dumps({"plan": plan, "total_calories": total, "ts": int(time.time())})
        await r.setex(key, DIET_CACHE_TTL, data)
    except Exception:
        pass


def _parse_and_fix(raw: str, cal: int) -> tuple[dict, int]:
    """Clean LLM output, parse JSON, fix calorie totals."""
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    # Strip markdown fences
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
    if cleaned.startswith("json"):
        cleaned = cleaned[4:].strip()
    # Extract JSON object
    m = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if m:
        cleaned = m.group(0)
    plan = json.loads(cleaned)

    # Calculate actual total from meals
    actual_total = sum(ml.get("total", 0) for ml in plan.get("meals", []))
    if not actual_total:
        actual_total = plan.get("totalCalories", 0)

    # Scale if too far from target
    if actual_total and actual_total < cal * 0.85:
        scale = cal / actual_total
        log.info(f"[DIET] Scaling plan: {actual_total} → {cal} (x{scale:.2f})")
        for meal in plan.get("meals", []):
            meal["total"] = round(meal.get("total", 0) * scale)
            if meal.get("macros"):
                meal["macros"]["protein"] = round(meal["macros"].get("protein", 0) * scale)
                meal["macros"]["carbs"] = round(meal["macros"].get("carbs", 0) * scale)
                meal["macros"]["fat"] = round(meal["macros"].get("fat", 0) * scale)
        actual_total = sum(ml.get("total", 0) for ml in plan["meals"])
        if plan.get("macros"):
            plan["macros"]["protein"] = round(plan["macros"].get("protein", 0) * scale)
            plan["macros"]["carbs"] = round(plan["macros"].get("carbs", 0) * scale)
            plan["macros"]["fat"] = round(plan["macros"].get("fat", 0) * scale)

    plan["totalCalories"] = actual_total
    plan["mealsCount"] = len(plan.get("meals", []))
    return plan, actual_total


@router.post("/generate", response_model=DietResponse)
async def generate_diet(request: DietRequest):
    try:
        allergies = ', '.join(request.allergies) if request.allergies else 'none'
        conditions = ', '.join(request.health_conditions) if request.health_conditions else 'none'
        cal = request.calorie_target or 2000
        t0 = time.time()

        # ── Cache check ──
        key = _cache_key(request, cal)
        cached = await _diet_cache_get(key)
        if cached:
            log.info(f"[DIET] Cache HIT | {cached['total_calories']} kcal | {time.time()-t0:.1f}s")
            return DietResponse(plan=cached["plan"], total_calories=cached["total_calories"], source="cache")

        # ── Generate with JSON-enforced output ──
        prompt = _build_diet_prompt(request, cal, allergies, conditions)
        log.info(f"[DIET] Generating {request.cuisine} {request.diet_preference} plan | goal={request.goal} meals={request.meals_per_day} cal={cal}")

        raw = await ollama.generate_json(prompt, system=DIET_SYSTEM, model="evaluator")
        log.info(f"[DIET] LLM response received | {len(raw)} chars | {time.time()-t0:.1f}s")

        try:
            plan, actual_total = _parse_and_fix(raw, cal)
        except json.JSONDecodeError:
            raise HTTPException(status_code=502, detail="LLM returned invalid JSON")

        # ── Cache the result ──
        await _diet_cache_set(key, plan, actual_total)

        log.info(f"[DIET] Plan ready | {actual_total} kcal | {len(plan.get('meals',[]))} meals | {time.time()-t0:.1f}s")
        return DietResponse(plan=plan, total_calories=actual_total, source="llm")

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"[DIET] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Diet generation error: {str(e)}")
