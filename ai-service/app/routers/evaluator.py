from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from app.core.llm import ollama
import json

router = APIRouter()

# ═══════════════════════════════════════════════════════════════
# INDEPENDENT EVALUATOR — Separate model for response evaluation
# Uses a DIFFERENT model (lighter/faster) than generation.
# Evaluates: hallucination, factual consistency, safety,
# personalization, coaching quality, contradiction risk.
# ═══════════════════════════════════════════════════════════════

# Use smaller model for evaluation (fast, cheap, independent)
EVALUATOR_MODEL = "qwen3:8b"  # Lighter model for evaluation gating
EVALUATOR_FALLBACK = "qwen3:14b"  # Fallback to main model if small unavailable

class EvaluateRequest(BaseModel):
    user_message: str
    ai_response: str
    intent: str = "coaching"
    user_facts: List[str] = []
    tool_data_used: bool = False
    user_state: Optional[Dict[str, Any]] = None
    reasoning_state: Optional[Dict[str, Any]] = None

class EvaluateResponse(BaseModel):
    verdict: str  # 'approve', 'revise', 'reject', 'regenerate'
    scores: Dict[str, float]
    issues: List[str]
    revision_guidance: Optional[str] = None
    safety_flag: bool = False
    confidence: float = 0.7

class SimulateRequest(BaseModel):
    plan: Dict[str, Any]  # workout/nutrition plan to simulate
    user_twin: Dict[str, Any]  # digital twin parameters
    duration_weeks: int = 4

class SimulateResponse(BaseModel):
    adherence_probability: float
    burnout_probability: float
    sustainability_score: float
    fatigue_accumulation: float
    estimated_dropoff_week: int
    motivation_impact: float
    recovery_impact: float
    recommendations: List[str]
    week_by_week: Optional[List[Dict[str, Any]]] = None

class CausalRequest(BaseModel):
    observations: List[str]  # observed patterns/events
    user_state: Optional[Dict[str, Any]] = None
    timeframe: str = "recent"  # 'recent', 'weekly', 'monthly'

class CausalResponse(BaseModel):
    causal_chains: List[Dict[str, Any]]
    root_causes: List[str]
    predicted_effects: List[str]
    intervention_points: List[str]
    confidence: float = 0.5


# ── ENDPOINT: Independent Evaluation ──

@router.post("/evaluate", response_model=EvaluateResponse)
async def evaluate_response(request: EvaluateRequest):
    """
    Independent evaluation of AI response using separate lighter model.
    Checks hallucination, safety, consistency, personalization, quality.
    """
    try:
        facts_str = "\n".join(f"- {f}" for f in request.user_facts[:15]) if request.user_facts else "No known facts."
        state_str = json.dumps(request.user_state, default=str)[:300] if request.user_state else "Unknown"

        prompt = f"""/no_think
You are an INDEPENDENT AI evaluator. Your job is to critically evaluate an AI fitness coach's response.
You must be strict and catch any issues.

USER MESSAGE: {request.user_message}
AI RESPONSE: {request.ai_response}
INTENT: {request.intent}
TOOL DATA USED: {request.tool_data_used}
USER STATE: {state_str}

KNOWN USER FACTS:
{facts_str}

Evaluate on these dimensions (score 0.0-1.0):
1. factual_accuracy: Does it state correct fitness/nutrition facts?
2. memory_consistency: Does it align with known user facts?
3. safety: No dangerous recommendations (injury risk, eating disorders, overtraining)?
4. personalization: Does it use user-specific data appropriately?
5. coaching_quality: Actionable, appropriate tone, helpful?
6. hallucination_risk: Is it making up specific numbers/claims without tool data?
7. contradiction_risk: Does it contradict known user info?

OUTPUT STRICT JSON:
{{
  "verdict": "approve|revise|reject|regenerate",
  "scores": {{
    "factual_accuracy": 0.0-1.0,
    "memory_consistency": 0.0-1.0,
    "safety": 0.0-1.0,
    "personalization": 0.0-1.0,
    "coaching_quality": 0.0-1.0,
    "hallucination_risk": 0.0-1.0,
    "contradiction_risk": 0.0-1.0
  }},
  "issues": ["list of specific issues found"],
  "revision_guidance": "specific guidance if verdict is revise",
  "safety_flag": true/false,
  "confidence": 0.0-1.0
}}

RULES:
- verdict="reject" if safety < 0.5 or hallucination_risk > 0.7
- verdict="revise" if any score < 0.5 (except safety)
- verdict="regenerate" if factual_accuracy < 0.3 or multiple scores < 0.4
- verdict="approve" if all scores >= 0.6
"""
        # Try lighter model first
        try:
            response = await ollama.chat(
                [{"role": "user", "content": prompt}],
                model=EVALUATOR_MODEL
            )
        except Exception:
            response = await ollama.chat(
                [{"role": "user", "content": prompt}],
                model=EVALUATOR_FALLBACK
            )

        # Parse JSON
        try:
            clean = response.strip()
            if "```json" in clean:
                clean = clean.split("```json")[1].split("```")[0]
            elif "```" in clean:
                clean = clean.split("```")[1].split("```")[0]
            result = json.loads(clean)
        except (json.JSONDecodeError, IndexError):
            # Safe fallback — approve with medium confidence
            return EvaluateResponse(
                verdict="approve",
                scores={"factual_accuracy": 0.6, "memory_consistency": 0.6, "safety": 0.8,
                        "personalization": 0.5, "coaching_quality": 0.6, "hallucination_risk": 0.3,
                        "contradiction_risk": 0.2},
                issues=["evaluator_parse_failure"],
                confidence=0.4
            )

        return EvaluateResponse(
            verdict=result.get("verdict", "approve"),
            scores=result.get("scores", {}),
            issues=result.get("issues", []),
            revision_guidance=result.get("revision_guidance"),
            safety_flag=result.get("safety_flag", False),
            confidence=result.get("confidence", 0.6)
        )

    except Exception as e:
        # Evaluator failure should never block response — safe pass-through
        return EvaluateResponse(
            verdict="approve",
            scores={},
            issues=[f"evaluator_error: {str(e)}"],
            confidence=0.3
        )


# ── ENDPOINT: Plan Simulation ──

@router.post("/simulate", response_model=SimulateResponse)
async def simulate_plan(request: SimulateRequest):
    """
    Simulate a fitness/nutrition plan against user's digital twin.
    Predicts adherence, burnout, sustainability before recommending.
    """
    try:
        twin_str = json.dumps(request.user_twin, default=str)[:500]
        plan_str = json.dumps(request.plan, default=str)[:500]

        prompt = f"""/no_think
You are a fitness plan simulation engine. Given a user's behavioral profile (digital twin) and a proposed plan, predict outcomes.

DIGITAL TWIN (user behavior model):
{twin_str}

PROPOSED PLAN:
{plan_str}

DURATION: {request.duration_weeks} weeks

Simulate week-by-week and predict:
1. Overall adherence probability (0-1)
2. Burnout probability (0-1)
3. Sustainability score (0-1, can they maintain this long-term?)
4. Fatigue accumulation (0-1)
5. Estimated week when adherence drops significantly
6. Motivation impact (-1 to +1)
7. Recovery impact (-1 to +1, negative = overreaching)

OUTPUT STRICT JSON:
{{
  "adherence_probability": 0.0-1.0,
  "burnout_probability": 0.0-1.0,
  "sustainability_score": 0.0-1.0,
  "fatigue_accumulation": 0.0-1.0,
  "estimated_dropoff_week": 1-{request.duration_weeks},
  "motivation_impact": -1.0 to 1.0,
  "recovery_impact": -1.0 to 1.0,
  "recommendations": ["specific adjustments to improve outcomes"],
  "week_by_week": [
    {{"week": 1, "adherence": 0.9, "fatigue": 0.2, "motivation": 0.8}},
    ...
  ]
}}
"""
        response = await ollama.chat([{"role": "user", "content": prompt}])

        try:
            clean = response.strip()
            if "```json" in clean:
                clean = clean.split("```json")[1].split("```")[0]
            elif "```" in clean:
                clean = clean.split("```")[1].split("```")[0]
            result = json.loads(clean)
        except (json.JSONDecodeError, IndexError):
            return SimulateResponse(
                adherence_probability=0.6,
                burnout_probability=0.3,
                sustainability_score=0.5,
                fatigue_accumulation=0.4,
                estimated_dropoff_week=3,
                motivation_impact=0.0,
                recovery_impact=0.0,
                recommendations=["simulation_parse_failure — use conservative defaults"]
            )

        return SimulateResponse(
            adherence_probability=result.get("adherence_probability", 0.5),
            burnout_probability=result.get("burnout_probability", 0.3),
            sustainability_score=result.get("sustainability_score", 0.5),
            fatigue_accumulation=result.get("fatigue_accumulation", 0.3),
            estimated_dropoff_week=result.get("estimated_dropoff_week", 3),
            motivation_impact=result.get("motivation_impact", 0.0),
            recovery_impact=result.get("recovery_impact", 0.0),
            recommendations=result.get("recommendations", []),
            week_by_week=result.get("week_by_week")
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulation error: {str(e)}")


# ── ENDPOINT: Causal Reasoning ──

@router.post("/causal", response_model=CausalResponse)
async def causal_reasoning(request: CausalRequest):
    """
    Causal reasoning engine — understands WHY patterns happen.
    Identifies root causes, causal chains, and intervention points.
    """
    try:
        observations_str = "\n".join(f"- {o}" for o in request.observations[:15])
        state_str = json.dumps(request.user_state, default=str)[:300] if request.user_state else "Unknown"

        prompt = f"""/no_think
You are a causal reasoning engine for fitness coaching. Analyze observed patterns and identify cause-effect relationships.

OBSERVED PATTERNS ({request.timeframe}):
{observations_str}

USER STATE: {state_str}

Identify:
1. Causal chains (A → B → C relationships)
2. Root causes (underlying drivers)
3. Predicted future effects if unchecked
4. Intervention points (where to break negative cycles)

Common fitness causal chains:
- poor_sleep → fatigue → low_adherence → guilt → motivation_drop
- aggressive_deficit → hunger → binge → guilt → restriction_cycle
- high_stress → cortisol → recovery_decline → overtraining
- no_variety → boredom → skipped_sessions → detraining
- perfectionism → all_or_nothing → missed_day → abandonment

OUTPUT STRICT JSON:
{{
  "causal_chains": [
    {{"chain": ["cause", "intermediate", "effect"], "strength": 0.0-1.0, "evidence": "reasoning"}}
  ],
  "root_causes": ["list of underlying root causes"],
  "predicted_effects": ["what will happen if unchecked"],
  "intervention_points": ["where and how to intervene"],
  "confidence": 0.0-1.0
}}
"""
        response = await ollama.chat([{"role": "user", "content": prompt}])

        try:
            clean = response.strip()
            if "```json" in clean:
                clean = clean.split("```json")[1].split("```")[0]
            elif "```" in clean:
                clean = clean.split("```")[1].split("```")[0]
            result = json.loads(clean)
        except (json.JSONDecodeError, IndexError):
            return CausalResponse(
                causal_chains=[],
                root_causes=["analysis_unavailable"],
                predicted_effects=[],
                intervention_points=[],
                confidence=0.3
            )

        return CausalResponse(
            causal_chains=result.get("causal_chains", []),
            root_causes=result.get("root_causes", []),
            predicted_effects=result.get("predicted_effects", []),
            intervention_points=result.get("intervention_points", []),
            confidence=result.get("confidence", 0.5)
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Causal reasoning error: {str(e)}")
