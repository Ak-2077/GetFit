import json
from fastapi import APIRouter, HTTPException
from app.models.schemas import DietRequest, DietResponse
from app.core.llm import ollama

router = APIRouter()

DIET_SYSTEM = """You are a certified nutritionist AI. Generate personalized diet plans.
Always respond with valid JSON only — no markdown, no explanation outside JSON."""


@router.post("/generate", response_model=DietResponse)
async def generate_diet(request: DietRequest):
    try:
        prompt = f"""Create a detailed daily meal plan for this user:
- Goal: {request.goal}
- Weight: {request.weight or 'unknown'} kg
- Target weight: {request.target_weight or 'unknown'} kg
- Height: {request.height or 'unknown'} cm
- Age: {request.age or 'unknown'}
- Gender: {request.gender or 'unknown'}
- Activity level: {request.activity_level or 'moderate'}
- Diet preference: {request.diet_preference}
- Calorie target: {request.calorie_target or 'calculate based on profile'}
- Allergies: {', '.join(request.allergies) if request.allergies else 'none'}

Return strict JSON with this exact shape:
{{
  "title": "Plan name",
  "description": "One sentence summary",
  "totalCalories": 2000,
  "mealsCount": 5,
  "macros": {{ "protein": 150, "carbs": 200, "fat": 60 }},
  "meals": [
    {{
      "time": "Breakfast (8 AM)",
      "items": ["Food item — XXX kcal", "Food item — XXX kcal"],
      "total": 400
    }}
  ]
}}

Rules:
- Meals should total close to the calorie target
- Include 4-6 meals
- Each item must show calories
- Respect diet preference strictly
- Use common, accessible foods"""

        raw = await ollama.generate_json(prompt, system=DIET_SYSTEM)

        try:
            plan = json.loads(raw)
        except json.JSONDecodeError:
            raise HTTPException(status_code=502, detail="LLM returned invalid JSON")

        total_cal = plan.get("totalCalories", 0)
        if not total_cal and "meals" in plan:
            total_cal = sum(m.get("total", 0) for m in plan["meals"])

        return DietResponse(plan=plan, total_calories=total_cal, source="llm")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diet generation error: {str(e)}")
