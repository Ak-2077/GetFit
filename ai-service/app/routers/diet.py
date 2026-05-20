import json
import re
import logging
from fastapi import APIRouter, HTTPException
from app.models.schemas import DietRequest, DietResponse
from app.core.llm import ollama

log = logging.getLogger(__name__)

router = APIRouter()

DIET_SYSTEM = """/no_think
You are a sports nutritionist. Output ONLY valid JSON. No markdown, no extra text."""


def _build_diet_prompt(request, cal, allergies, conditions):
    per_meal = round(cal / request.meals_per_day)
    return f"""/no_think
STRICT RULES:
1. Total calories MUST be between {int(cal * 0.9)} and {int(cal * 1.1)} kcal. Target: {cal} kcal.
2. Each meal should be ~{per_meal} kcal. You have {request.meals_per_day} meals.
3. Cuisine: {request.cuisine}. Diet: {request.diet_preference}. STRICTLY follow this.
4. Cooking: {request.cooking_time}. Budget: {request.budget}.
5. Avoid: {allergies}. Health: {conditions}.
6. Profile: {request.weight or '?'}kg, {request.height or '?'}cm, age {request.age or '?'}, {request.gender or '?'}, {request.activity_level or 'moderate'}.
{f'7. Notes: {request.additional_notes}' if request.additional_notes else ''}

Output this JSON (fill in real foods with real calories, each item must show kcal):
{{"title":"...","description":"...","totalCalories":{cal},"mealsCount":{request.meals_per_day},"macros":{{"protein":0,"carbs":0,"fat":0}},"meals":[{{"name":"Meal 1","time":"8:00 AM","items":["Food (portion) — {per_meal // 3} kcal","Food2 (portion) — {per_meal // 3} kcal"],"macros":{{"protein":0,"carbs":0,"fat":0}},"total":{per_meal},"prepTime":"10 min"}}],"tips":["tip1","tip2"],"waterIntake":"2.5-3L"}}

CRITICAL: The sum of all meal totals MUST equal ~{cal}. Do NOT output less than {int(cal * 0.85)} total."""


@router.post("/generate", response_model=DietResponse)
async def generate_diet(request: DietRequest):
    try:
        allergies = ', '.join(request.allergies) if request.allergies else 'none'
        conditions = ', '.join(request.health_conditions) if request.health_conditions else 'none'
        cal = request.calorie_target or 2000

        prompt = _build_diet_prompt(request, cal, allergies, conditions)
        messages = [
            {"role": "system", "content": DIET_SYSTEM},
            {"role": "user", "content": prompt},
        ]
        log.info(f"[DIET] Generating {request.cuisine} {request.diet_preference} plan | goal={request.goal} meals={request.meals_per_day} cal={cal}")
        raw = await ollama.chat(messages, temperature=0.4, model="evaluator", num_ctx=4096)
        log.info(f"[DIET] LLM response received | {len(raw)} chars")

        # Clean and parse
        cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
        # Strip markdown fences
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].strip()
        # Extract JSON object if surrounded by text
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            cleaned = m.group(0)
        try:
            plan = json.loads(cleaned)
        except json.JSONDecodeError:
            raise HTTPException(status_code=502, detail="LLM returned invalid JSON")

        # Calculate actual total from meals
        actual_total = sum(m.get("total", 0) for m in plan.get("meals", []))
        if not actual_total:
            actual_total = plan.get("totalCalories", 0)

        # If LLM output is too far from target, scale proportionally
        if actual_total and actual_total < cal * 0.85:
            scale = cal / actual_total
            log.info(f"[DIET] Scaling plan: {actual_total} → {cal} (x{scale:.2f})")
            for meal in plan.get("meals", []):
                meal["total"] = round(meal.get("total", 0) * scale)
                if meal.get("macros"):
                    meal["macros"]["protein"] = round(meal["macros"].get("protein", 0) * scale)
                    meal["macros"]["carbs"] = round(meal["macros"].get("carbs", 0) * scale)
                    meal["macros"]["fat"] = round(meal["macros"].get("fat", 0) * scale)
            actual_total = sum(m.get("total", 0) for m in plan["meals"])
            if plan.get("macros"):
                plan["macros"]["protein"] = round(plan["macros"].get("protein", 0) * scale)
                plan["macros"]["carbs"] = round(plan["macros"].get("carbs", 0) * scale)
                plan["macros"]["fat"] = round(plan["macros"].get("fat", 0) * scale)

        plan["totalCalories"] = actual_total
        plan["mealsCount"] = len(plan.get("meals", []))

        log.info(f"[DIET] Plan ready | {actual_total} kcal | {len(plan.get('meals',[]))} meals")
        return DietResponse(plan=plan, total_calories=actual_total, source="llm")

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"[DIET] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Diet generation error: {str(e)}")
