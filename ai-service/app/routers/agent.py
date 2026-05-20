from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from app.core.llm import ollama
import json

router = APIRouter()

# ═══════════════════════════════════════════════════════════════
# TOOL ROUTING — LLM decides which tools to use
# ═══════════════════════════════════════════════════════════════

TOOL_ROUTER_PROMPT = """/no_think
You are a tool-routing AI for a fitness coaching system. Given a user message and intent, decide which tools to call.

AVAILABLE TOOLS:
1. bmr_tdee_calculator — Calculate BMR and TDEE. Params: {weight_kg, height_cm, age, gender, activity_level}
2. macro_calculator — Calculate macro targets. Params: {calories, goal, diet_preference}
3. food_search — Search food database for nutrition info. Params: {query}
4. exercise_lookup — Look up exercises by muscle group. Params: {muscle_group}
5. calorie_summary — Get user's daily calorie intake/burn. Params: {}
6. progress_analytics — Analyze user's progress trends. Params: {}
7. workout_generator — Generate workout plan. Params: {level, goal}
8. meal_planner — Plan meals for calorie target. Params: {calories, diet_preference, meals_per_day}
9. none — No tool needed, answer from knowledge.

RULES:
- Pick ONLY tools genuinely needed. Don't over-tool simple questions.
- For "how many calories in X" → food_search
- For "create a meal plan" → macro_calculator + meal_planner
- For "what should I eat" → calorie_summary + macro_calculator
- For "give me a workout" → exercise_lookup + workout_generator
- For greeting/motivation/casual → none
- Maximum 3 tools per request.

RESPOND WITH ONLY JSON (no markdown):
{"tools": [{"name": "tool_name", "params": {...}, "reason": "why"}], "reasoning": {"intent": "...", "user_state_relevant": true/false, "needs_calculation": true/false}}"""


class ToolRouteRequest(BaseModel):
    message: str
    intent: str = "coaching"
    user_profile: Optional[dict] = None  # weight, height, age, gender, etc.
    user_state: Optional[dict] = None    # energy, recovery, etc.


class ToolCall(BaseModel):
    name: str
    params: dict = {}
    reason: str = ""


class StructuredReasoning(BaseModel):
    intent: str
    user_state_relevant: bool = False
    needs_calculation: bool = False


class ToolRouteResponse(BaseModel):
    tools: List[ToolCall]
    reasoning: StructuredReasoning


@router.post("/route-tools", response_model=ToolRouteResponse)
async def route_tools(request: ToolRouteRequest):
    """LLM decides which tools to use for a given message."""
    try:
        profile_str = ""
        if request.user_profile:
            profile_str = "\n\nUser profile: " + ", ".join(
                f"{k}={v}" for k, v in request.user_profile.items() if v is not None
            )

        state_str = ""
        if request.user_state:
            state_str = "\n\nUser state: " + ", ".join(
                f"{k}={v}" for k, v in request.user_state.items() if v is not None
            )

        response = await ollama.generate_json(
            prompt=f"Intent: {request.intent}{profile_str}{state_str}\n\nUser message: \"{request.message}\"",
            system=TOOL_ROUTER_PROMPT,
            model="fast",
        )

        result = json.loads(response)
        tools = []
        for t in result.get("tools", []):
            if t.get("name") and t["name"] != "none":
                tools.append(ToolCall(
                    name=t["name"],
                    params=t.get("params", {}),
                    reason=t.get("reason", ""),
                ))

        reasoning = result.get("reasoning", {})
        return ToolRouteResponse(
            tools=tools[:3],  # max 3 tools
            reasoning=StructuredReasoning(
                intent=reasoning.get("intent", request.intent),
                user_state_relevant=reasoning.get("user_state_relevant", False),
                needs_calculation=reasoning.get("needs_calculation", False),
            ),
        )

    except Exception:
        # Fallback: no tools needed
        return ToolRouteResponse(
            tools=[],
            reasoning=StructuredReasoning(intent=request.intent),
        )


# ═══════════════════════════════════════════════════════════════
# STRUCTURED REASONING — Generate reasoning state before response
# ═══════════════════════════════════════════════════════════════

REASONING_PROMPT = """/no_think
You are generating a structured reasoning state for a fitness AI coach. Given the context, produce a JSON reasoning object that will guide the final response.

USER CONTEXT:
{context}

TOOL RESULTS:
{tool_results}

USER STATE:
{user_state}

Produce a JSON reasoning state:
{"recommended_strategy": "...", "key_facts": ["..."], "safety_warnings": ["..."], "confidence": 0.85, "should_ask_clarification": false, "clarification_question": null, "response_approach": "..."}

confidence: 0.0-1.0 — how confident are you in the answer?
- If < 0.5: set should_ask_clarification=true and provide clarification_question
- If < 0.3: definitely ask for clarification before answering
safety_warnings: list anything dangerous (injury risk, extreme calories, etc.)"""


class ReasonRequest(BaseModel):
    message: str
    intent: str
    user_context: Optional[dict] = None
    tool_results: List[dict] = []
    user_state: Optional[dict] = None
    memories: List[str] = []


class ReasonResponse(BaseModel):
    recommended_strategy: str = ""
    key_facts: List[str] = []
    safety_warnings: List[str] = []
    confidence: float = 0.8
    should_ask_clarification: bool = False
    clarification_question: Optional[str] = None
    response_approach: str = ""


@router.post("/reason", response_model=ReasonResponse)
async def structured_reason(request: ReasonRequest):
    """Generate structured reasoning state before response generation."""
    try:
        context_parts = [f"Message: \"{request.message}\"", f"Intent: {request.intent}"]
        if request.user_context:
            context_parts.append("Profile: " + ", ".join(f"{k}={v}" for k, v in request.user_context.items() if v))
        if request.memories:
            context_parts.append("Memories: " + "; ".join(request.memories[:10]))

        tool_str = json.dumps(request.tool_results[:5], default=str) if request.tool_results else "None"
        state_str = json.dumps(request.user_state, default=str) if request.user_state else "None"

        prompt = REASONING_PROMPT.replace("{context}", "\n".join(context_parts))
        prompt = prompt.replace("{tool_results}", tool_str)
        prompt = prompt.replace("{user_state}", state_str)

        response = await ollama.generate_json(
            prompt="Generate the structured reasoning state:",
            system=prompt,
        )

        result = json.loads(response)
        return ReasonResponse(
            recommended_strategy=result.get("recommended_strategy", ""),
            key_facts=result.get("key_facts", []),
            safety_warnings=result.get("safety_warnings", []),
            confidence=max(0.0, min(1.0, float(result.get("confidence", 0.8)))),
            should_ask_clarification=result.get("should_ask_clarification", False),
            clarification_question=result.get("clarification_question"),
            response_approach=result.get("response_approach", ""),
        )

    except Exception:
        return ReasonResponse(confidence=0.7, response_approach="direct_answer")


# ═══════════════════════════════════════════════════════════════
# CONFIDENCE-AWARE REFLECTION (upgrades existing reflect)
# ═══════════════════════════════════════════════════════════════

CONFIDENCE_PROMPT = """/no_think
Rate the confidence of this AI fitness coach response.

User asked: "{question}"
AI responded: "{response}"
Tool data used: {tool_data}

Score each dimension 0.0-1.0:
- factual_confidence: Are facts/numbers correct and verifiable?
- hallucination_risk: How likely is hallucinated content? (0=no risk, 1=high risk)
- personalization: Is it tailored to this specific user?
- completeness: Does it fully answer the question?
- safety: Is the advice safe for the user?

RESPOND WITH ONLY JSON:
{"factual_confidence": 0.8, "hallucination_risk": 0.2, "personalization": 0.7, "completeness": 0.8, "safety": 1.0, "overall": 0.8, "issues": []}"""


class ConfidenceRequest(BaseModel):
    question: str
    response: str
    tool_data_used: bool = False
    user_facts: List[str] = []


class ConfidenceResponse(BaseModel):
    factual_confidence: float = 0.8
    hallucination_risk: float = 0.2
    personalization: float = 0.5
    completeness: float = 0.8
    safety: float = 1.0
    overall: float = 0.8
    issues: List[str] = []


@router.post("/confidence", response_model=ConfidenceResponse)
async def estimate_confidence(request: ConfidenceRequest):
    """Estimate response confidence across multiple dimensions."""
    try:
        prompt = CONFIDENCE_PROMPT.replace("{question}", request.question[:200])
        prompt = prompt.replace("{response}", request.response[:500])
        prompt = prompt.replace("{tool_data}", "yes" if request.tool_data_used else "no")

        response = await ollama.generate_json(
            prompt="Rate confidence:",
            system=prompt,
            model="fast",
        )

        result = json.loads(response)

        def clamp(v, lo=0.0, hi=1.0):
            return max(lo, min(hi, float(v)))

        return ConfidenceResponse(
            factual_confidence=clamp(result.get("factual_confidence", 0.8)),
            hallucination_risk=clamp(result.get("hallucination_risk", 0.2)),
            personalization=clamp(result.get("personalization", 0.5)),
            completeness=clamp(result.get("completeness", 0.8)),
            safety=clamp(result.get("safety", 1.0)),
            overall=clamp(result.get("overall", 0.8)),
            issues=result.get("issues", []),
        )

    except Exception:
        return ConfidenceResponse()


# ═══════════════════════════════════════════════════════════════
# BEHAVIORAL PREDICTION
# ═══════════════════════════════════════════════════════════════

PREDICTION_PROMPT = """/no_think
Analyze this fitness user's behavioral data and predict likely outcomes.

USER STATE:
{state}

SESSION HISTORY:
{history}

Predict (true/false with confidence 0-1):
- burnout_likely: user showing overtraining/exhaustion signs
- inconsistency_likely: user frequently missing workouts/meals
- plan_abandonment_likely: user losing interest in current plan
- motivation_dropping: declining engagement
- ready_for_progression: user is consistent and should increase difficulty
- needs_plan_simplification: plan is too complex for user's adherence

Also suggest ONE coaching adjustment.

RESPOND WITH ONLY JSON:
{"predictions": {"burnout_likely": false, "inconsistency_likely": false, "plan_abandonment_likely": false, "motivation_dropping": false, "ready_for_progression": false, "needs_plan_simplification": false}, "coaching_adjustment": "...", "failure_analysis": "..."}"""


class PredictionRequest(BaseModel):
    user_state: dict = {}
    session_summaries: List[str] = []
    adherence_data: Optional[dict] = None


class PredictionResponse(BaseModel):
    predictions: dict = {}
    coaching_adjustment: str = ""
    failure_analysis: str = ""


@router.post("/predict", response_model=PredictionResponse)
async def predict_behavior(request: PredictionRequest):
    """Predict user behavioral trends and suggest coaching adjustments."""
    try:
        prompt = PREDICTION_PROMPT.replace("{state}", json.dumps(request.user_state, default=str))
        history = "\n".join(f"- {s}" for s in request.session_summaries[-10:]) if request.session_summaries else "No history"
        prompt = prompt.replace("{history}", history)

        response = await ollama.generate_json(
            prompt="Predict user behavior:",
            system=prompt,
            model="fast",
        )

        result = json.loads(response)
        return PredictionResponse(
            predictions=result.get("predictions", {}),
            coaching_adjustment=result.get("coaching_adjustment", ""),
            failure_analysis=result.get("failure_analysis", ""),
        )

    except Exception:
        return PredictionResponse()
